import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import AdmZip from "adm-zip";
import type { RunArtifactsInput, RunArtifactsResult } from "./types";

type DeclaredDigest = { hex?: string; b64?: string };

function parseExpectedHex(value?: string): DeclaredDigest | null {
  const v = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(v) ? { hex: v } : null;
}

function parseDeclaredDigest(meta: unknown): DeclaredDigest | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const nested = (key: string) => {
    const obj = m[key];
    return obj && typeof obj === "object"
      ? (obj as Record<string, unknown>).sha256
      : undefined;
  };
  for (const c of [m.sha256, m.checksum, nested("artifact"), nested("package")]) {
    if (typeof c === "string" && /^[a-f0-9]{64}$/i.test(c.trim())) {
      return { hex: c.trim().toLowerCase() };
    }
  }
  if (typeof m.integrity === "string") {
    const match = m.integrity.trim().match(/^sha256-([A-Za-z0-9+/=]+)$/);
    if (match && match[1]) return { b64: match[1] };
  }
  return null;
}

function parseManifestDigest(manifest: unknown): DeclaredDigest | null {
  if (!manifest || typeof manifest !== "object") return null;
  const files = (manifest as Record<string, unknown>).files;
  const zip =
    files && typeof files === "object"
      ? (files as Record<string, unknown>).zip
      : undefined;
  const sha =
    zip && typeof zip === "object"
      ? (zip as Record<string, unknown>).sha256
      : undefined;
  return typeof sha === "string" && /^[a-f0-9]{64}$/i.test(sha.trim())
    ? { hex: sha.trim().toLowerCase() }
    : null;
}

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

function enrichCheck(
  check: RunArtifactsResult["checks"][number],
): RunArtifactsResult["checks"][number] {
  switch (check.id) {
    case "download-package":
      return {
        ...check,
        title: "Download package",
        level: "fail",
        summary: "Package archive is reachable and downloadable.",
        remediation: "Ensure the build artifact exists and the URL is correct.",
        expected: "HTTP 200 and valid bytes",
        actual: check.ok ? "Downloaded" : check.detail,
      };
    case "zip-structure":
      return {
        ...check,
        title: "Zip structure",
        level: "fail",
        summary: "Package is a valid zip archive.",
        remediation: "Ensure the artifact is a valid zip file.",
        expected: "Valid zip archive",
        actual: check.ok ? "Zip parsed" : check.detail,
      };
    case "manifest-present":
      return {
        ...check,
        title: "Manifest present",
        level: "fail",
        summary: "manifest.json exists at the archive root.",
        remediation:
          "Place manifest.json at the root of the extension package.",
        expected: "/manifest.json at zip root",
        actual: check.ok ? "Found" : check.detail,
      };
    case "download-metadata":
      return {
        ...check,
        title: "Download metadata",
        level: "fail",
        summary: "Browser metadata JSON is reachable and valid JSON.",
        remediation: "Publish <browser>.json with build metadata.",
        expected: "HTTP 200 and valid JSON",
        actual: check.ok ? "Downloaded" : check.detail,
      };
    case "package-integrity":
      return {
        title: "Package integrity",
        summary: "Package bytes match the declared SHA-256.",
        remediation:
          "Republish the artifact, or fix the declared digest in metadata.",
        level: check.level ?? "fail",
        ...check,
      };
    default:
      return check;
  }
}

function authHeaders(token?: string): Record<string, string> {
  const trimmed = String(token || "").trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

async function fetchBytes(url: string, timeoutMs: number, token?: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: authHeaders(token),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());

    return buf;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url: string, timeoutMs: number, token?: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: authHeaders(token),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function runArtifacts(
  input: RunArtifactsInput,
): Promise<RunArtifactsResult> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const base = normalizeBaseUrl(input.artifactsBaseUrl);
  const ext = extForBrowser(input.browser);
  const packageUrl = `${base}/${encodeURIComponent(input.owner)}/${encodeURIComponent(
    input.repo,
  )}/${encodeURIComponent(input.sha)}/${input.browser}.${ext}`;
  const metadataUrl = `${base}/${encodeURIComponent(input.owner)}/${encodeURIComponent(
    input.repo,
  )}/${encodeURIComponent(input.sha)}/${input.browser}.json`;

  const manifestUrl = `${base}/${encodeURIComponent(input.owner)}/${encodeURIComponent(
    input.repo,
  )}/${encodeURIComponent(input.sha)}/artifact-manifest/${input.browser}.json`;

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

  let extractedDir: string | null = null;
  if (zip) {
    try {
      extractedDir = fs.mkdtempSync(
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
