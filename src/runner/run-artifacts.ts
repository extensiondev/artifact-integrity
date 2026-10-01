//  █████╗ ██████╗ ████████╗██╗███████╗ █████╗  ██████╗████████╗   ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██╔══██╗██╔══██╗╚══██╔══╝██║██╔════╝██╔══██╗██╔════╝╚══██╔══╝   ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ███████║██████╔╝   ██║   ██║█████╗  ███████║██║        ██║█████╗██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██╔══██║██╔══██╗   ██║   ██║██╔══╝  ██╔══██║██║        ██║╚════╝██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║  ██║██║  ██║   ██║   ██║██║     ██║  ██║╚██████╗   ██║      ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝      ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

import * as crypto from "node:crypto";
import AdmZip from "adm-zip";
import type { Check, RunArtifactsInput, RunArtifactsResult } from "../types";
import { SUPPORTED_BROWSERS } from "../types";
import type { DeclaredDigest } from "./digest";
import {
  parseExpectedHex,
  parseDeclaredDigest,
  parseManifestDigest,
} from "./digest";
import { fetchBytes, fetchJson } from "./http";
import { enrichCheck } from "./checks";

function normalizeBaseUrl(u: string) {
  return u.replace(/\/+$/, "");
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

function inspectManifest(zip: AdmZip): Check {
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
  if (
    String(input.expectedSha256 ?? "").trim() !== "" &&
    parseExpectedHex(input.expectedSha256) === null
  ) {
    throw new Error(
      "expectedSha256 must be a 64-character hex SHA-256; refusing to fall back to a registry-declared digest.",
    );
  }

  if (!SUPPORTED_BROWSERS.includes(input.browser)) {
    throw new Error(
      `Unsupported browser "${input.browser}". Expected one of: ${SUPPORTED_BROWSERS.join(
        ", ",
      )}.`,
    );
  }

  const pinned = parseExpectedHex(input.expectedSha256) !== null;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const base = normalizeBaseUrl(input.artifactsBaseUrl);
  const ext = extForBrowser(input.browser);
  const browserSeg = encodeURIComponent(input.browser);

  const buildBase = `${base}/${encodeURIComponent(input.owner)}/${encodeURIComponent(
    input.repo,
  )}/builds/${encodeURIComponent(input.sha)}`;
  const packageUrl = `${buildBase}/${browserSeg}.${ext}`;
  const metadataUrl = `${buildBase}/${browserSeg}.json`;

  const manifestUrl = `${buildBase}/artifact-manifest/${browserSeg}.json`;

  const checks: RunArtifactsResult["checks"] = [];

  const token = input.token;

  let zipBuf: Buffer | null = null;
  try {
    zipBuf = await fetchBytes(packageUrl, timeoutMs, token, input.maxBytes);
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
    checks.push(enrichCheck({ id: "download-manifest", ok: true }));
  } catch (e: unknown) {
    checks.push(
      enrichCheck({
        id: "download-manifest",
        ok: false,
        detail: pinned
          ? `Artifact manifest could not be fetched; expectedSha256 is pinned, so digest resolution does not depend on it: ${errorMessage(e)}`
          : `Artifact manifest could not be fetched; digest resolution falls back to a weaker source: ${errorMessage(e)}`,
      }),
    );
  }

  let sha256: string | undefined;
  if (zipBuf) {
    sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex");
    let declared: DeclaredDigest | null = null;
    let unusable: string | undefined;
    try {
      declared =
        parseExpectedHex(input.expectedSha256) ??
        parseManifestDigest(manifestJson) ??
        parseDeclaredDigest(metadataJson);
    } catch (e: unknown) {
      unusable = errorMessage(e);
    }
    if (unusable) {
      checks.push(
        enrichCheck({
          id: "package-integrity",
          ok: false,
          actual: sha256,
          detail: `Declared digest is unusable: ${unusable}`,
        }),
      );
    } else if (declared) {
      const computedB64 = Buffer.from(sha256, "hex").toString("base64");
      const expectedStr = declared.hex ?? `sha256-${declared.b64}`;
      const actualStr = declared.hex ? sha256 : `sha256-${computedB64}`;
      const match = declared.hex
        ? declared.hex === sha256
        : declared.b64 === computedB64;
      checks.push(
        enrichCheck({
          id: "package-integrity",
          ok: match,
          expected: expectedStr,
          actual: actualStr,
          detail: match
            ? undefined
            : `Package digest mismatch: expected ${expectedStr}, got ${actualStr}.`,
        }),
      );
    } else if (input.requireDigest) {
      checks.push(
        enrichCheck({
          id: "package-integrity",
          ok: false,
          actual: sha256,
          detail: `No declared digest to verify against and requireDigest is set; computed sha256=${sha256}.`,
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

  const ok = checks.every((c) => c.ok || c.level !== "fail");
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
