// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) Cezar Augusto and the extension.dev collaborators

import * as crypto from "node:crypto";
import AdmZip from "adm-zip";
import type { RunArtifactsInput, RunArtifactsResult } from "../types";
import {
  parseExpectedHex,
  parseDeclaredDigest,
  parseManifestDigest,
} from "./digest";
import { fetchBytes, fetchJson } from "./http";
import { enrichCheck } from "./checks";

function normalizeBaseUrl(u: string) {
  return String(u || "").replace(/\/+$/, "");
}

function extForBrowser(browser: string) {
  return browser === "firefox" ? "xpi" : "zip";
}

function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }

  return String(e);
}

const MANIFEST_MAX_BYTES = 1024 * 1024;

type ManifestCheck = { id: "manifest-present"; ok: boolean; detail?: string };

function inspectManifest(zip: AdmZip): ManifestCheck {
  const entry = zip.getEntries().find((e) => e.entryName === "manifest.json");
  if (!entry) {
    return {
      id: "manifest-present",
      ok: false,
      detail: "No manifest.json at the archive root",
    };
  }
  if (entry.header.size > MANIFEST_MAX_BYTES) {
    return {
      id: "manifest-present",
      ok: false,
      detail: `manifest.json is implausibly large (${entry.header.size} bytes)`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(entry.getData().toString("utf8"));
  } catch (e: unknown) {
    return {
      id: "manifest-present",
      ok: false,
      detail: `manifest.json is not valid JSON: ${errorMessage(e)}`,
    };
  }
  const mv =
    json && typeof json === "object"
      ? (json as { manifest_version?: unknown }).manifest_version
      : undefined;
  if (mv !== 2 && mv !== 3) {
    return {
      id: "manifest-present",
      ok: false,
      detail: `manifest_version must be 2 or 3 (found ${JSON.stringify(mv)})`,
    };
  }
  return { id: "manifest-present", ok: true };
}

export async function runArtifacts(
  input: RunArtifactsInput,
): Promise<RunArtifactsResult> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const base = normalizeBaseUrl(input.artifactsBaseUrl);
  const ext = extForBrowser(input.browser);

  const buildBase = `${base}/${encodeURIComponent(input.owner)}/${encodeURIComponent(
    input.repo,
  )}/builds/${encodeURIComponent(input.sha)}`;
  const packageUrl = `${buildBase}/${input.browser}.${ext}`;
  const metadataUrl = `${buildBase}/${input.browser}.json`;

  const manifestUrl = `${buildBase}/artifact-manifest/${input.browser}.json`;

  const checks: RunArtifactsResult["checks"] = [];

  const token = input.token;

  let zipBuf: Buffer | null = null;
  try {
    zipBuf = await fetchBytes(packageUrl, timeoutMs, token);
    checks.push(enrichCheck({ id: "download-package", ok: true }));
  } catch (e: unknown) {
    checks.push(
      enrichCheck({
        id: "download-package",
        ok: false,
        detail: errorMessage(e),
      }),
    );
  }

  let zip: AdmZip | null = null;

  if (zipBuf) {
    try {
      zip = new AdmZip(zipBuf);
      checks.push(enrichCheck({ id: "zip-structure", ok: true }));
    } catch (e: unknown) {
      checks.push(
        enrichCheck({
          id: "zip-structure",
          ok: false,
          detail: errorMessage(e),
        }),
      );
    }
  } else {
    checks.push(
      enrichCheck({
        id: "zip-structure",
        ok: false,
        detail: "No package bytes",
      }),
    );
  }

  if (zip) {
    try {
      checks.push(enrichCheck(inspectManifest(zip)));
    } catch (e: unknown) {
      checks.push(
        enrichCheck({
          id: "manifest-present",
          ok: false,
          detail: errorMessage(e),
        }),
      );
    }
  } else {
    checks.push(
      enrichCheck({
        id: "manifest-present",
        ok: false,
        detail: "No zip to inspect",
      }),
    );
  }

  let metadataJson: unknown = null;
  try {
    metadataJson = await fetchJson(metadataUrl, timeoutMs, token);
    checks.push(enrichCheck({ id: "download-metadata", ok: true }));
  } catch (e: unknown) {
    checks.push(
      enrichCheck({
        id: "download-metadata",
        ok: false,
        detail: errorMessage(e),
      }),
    );
  }

  let manifestJson: unknown = null;
  try {
    manifestJson = await fetchJson(manifestUrl, timeoutMs, token);
  } catch {
  }

  let sha256: string | undefined;
  if (zipBuf) {
    sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex");
    const declared =
      parseExpectedHex(input.expectedSha256) ??
      parseManifestDigest(manifestJson) ??
      parseDeclaredDigest(metadataJson);
    if (declared) {
      const computedB64 = crypto
        .createHash("sha256")
        .update(zipBuf)
        .digest("base64");
      const expectedStr = declared.hex ?? `sha256-${declared.b64}`;
      const match = declared.hex
        ? declared.hex === sha256
        : declared.b64 === computedB64;
      checks.push(
        enrichCheck({
          id: "package-integrity",
          ok: match,
          expected: expectedStr,
          actual: declared.hex ? sha256 : `sha256-${computedB64}`,
          detail: match
            ? undefined
            : `Package digest mismatch: expected ${expectedStr}, got ${
                declared.hex ? sha256 : `sha256-${computedB64}`
              }.`,
        }),
      );
    } else {
      checks.push(
        enrichCheck({
          id: "package-integrity",
          ok: true,
          level: "info",
          actual: sha256,
          detail: `No declared digest to verify against; computed sha256=${sha256}.`,
        }),
      );
    }
  } else {
    checks.push(
      enrichCheck({
        id: "package-integrity",
        ok: false,
        detail: "No package bytes to hash",
      }),
    );
  }

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    browser: input.browser,
    sha256,
    urls: {
      package: packageUrl,
      metadata: metadataUrl,
      manifest: manifestUrl,
    },
    checks,
  };
}
