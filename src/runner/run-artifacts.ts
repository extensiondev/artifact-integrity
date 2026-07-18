// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) Cezar Augusto and the extension.dev collaborators

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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
      const extractedDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "artifact-integrity-"),
      );
      zip.extractAllTo(extractedDir, true);

      const manifestPath = path.join(extractedDir, "manifest.json");
      const ok = fs.existsSync(manifestPath);
      checks.push(
        enrichCheck({
          id: "manifest-present",
          ok,
          detail: ok ? undefined : `Missing ${manifestPath}`,
        }),
      );
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
