import { afterEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { runArtifacts } from "./src/runner";

const RUNNER = path.resolve(__dirname, "bin/runner.cjs");
const { parseArgs } = require(RUNNER);

function response(
  bytes: Buffer,
  contentType: string,
  body: ReadableStream<Uint8Array> | null = null,
  declareLength = true,
) {
  const headers = new Map<string, string>([["content-type", contentType]]);
  if (declareLength) headers.set("content-length", String(bytes.length));
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body,
    arrayBuffer: async () => bytes,
    text: async () => bytes.toString("utf8"),
    json: async () => JSON.parse(bytes.toString("utf8")),
  } as unknown as Response;
}

function bytesResponse(bytes: Buffer) {
  return response(bytes, "application/zip");
}

function streamedResponse(bytes: Buffer, chunkSize: number) {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return response(bytes, "application/zip", body, false);
}

function jsonResponse(body: unknown) {
  return response(
    Buffer.from(JSON.stringify(body), "utf8"),
    "application/json",
  );
}

function mockFetch(
  zipBytes: Buffer,
  metadata: unknown,
  manifest: unknown = {},
) {
  return async (url: string) => {
    const u = String(url);
    if (u.endsWith(".zip") || u.endsWith(".xpi"))
      return bytesResponse(zipBytes);
    return jsonResponse(u.includes("artifact-manifest") ? manifest : metadata);
  };
}

function sampleZip() {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from('{"manifest_version":3}', "utf8"));
  return zip.toBuffer();
}

describe("extension-artifact-integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an unsupported browser instead of building a URL from it", async () => {
    await expect(
      runArtifacts({
        artifactsBaseUrl: "https://artifacts.extension.land",
        owner: "o",
        repo: "r",
        sha: "s",
        browser: "../../../secret" as unknown as "chrome",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/Unsupported browser/);
  });

  it("fails gracefully when remote is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const res = await runArtifacts({
      artifactsBaseUrl: "https://invalid.example.local",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 250,
    });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.id === "download-package")?.ok).toBe(false);
  });

  it("sends Authorization: Bearer when a token is provided", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      return String(url).endsWith(".zip")
        ? bytesResponse(zipBytes)
        : jsonResponse({});
    });

    await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      token: "tok_abc",
    });

    expect(seenHeaders.length).toBeGreaterThan(0);
    for (const h of seenHeaders) {
      expect(h.Authorization).toBe("Bearer tok_abc");
    }
  });

  it("omits Authorization when no token is provided", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      return String(url).endsWith(".zip")
        ? bytesResponse(zipBytes)
        : jsonResponse({});
    });

    await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    for (const h of seenHeaders) {
      expect(h.Authorization).toBeUndefined();
    }
  });

  it("points a 401 at the refusal instead of at a missing artifact", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        ({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          headers: { get: () => null },
          body: null,
          arrayBuffer: async () => Buffer.alloc(0),
        }) as unknown as Response,
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/401/);
    expect(c?.remediation).toMatch(/declared public/i);
    expect(c?.remediation).toMatch(/reserves/i);
  });

  it("refuses to send a bearer token over a non-HTTPS URL", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "http://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      token: "tok_abc",
    });

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/non-HTTPS/i);
  });

  it("caps an oversized download instead of buffering it", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      maxBytes: 1,
    });

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/cap/i);
  });

  it("reports a friendly error when metadata is not JSON", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.endsWith(".zip")) return bytesResponse(zipBytes);
      return response(
        Buffer.from("<html>Not Found</html>", "utf8"),
        "text/html",
      );
    });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "download-metadata");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/Expected JSON|soft-404/i);
  });

  it("validates a zip structure from a mocked fetch", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from('{"manifest_version":3}', "utf8"));
    const zipBytes = zip.toBuffer();

    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.checks.find((c) => c.id === "zip-structure")?.ok).toBe(true);
    expect(out.checks.find((c) => c.id === "manifest-present")?.ok).toBe(true);
    expect(out.checks.find((c) => c.id === "download-metadata")?.ok).toBe(true);
  });

  it("fails manifest-present when manifest.json is missing from the zip", async () => {
    const zip = new AdmZip();
    zip.addFile("popup.js", Buffer.from("console.log(1)", "utf8"));
    const zipBytes = zip.toBuffer();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "manifest-present");
    expect(c?.ok).toBe(false);
    expect(out.checks.find((x) => x.id === "zip-structure")?.ok).toBe(true);
  });

  it("fails manifest-present when manifest.json is not valid JSON", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from("{ not json", "utf8"));
    const zipBytes = zip.toBuffer();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.checks.find((x) => x.id === "manifest-present")?.ok).toBe(false);
  });

  it("fails manifest-present when manifest_version is not 2 or 3", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from('{"manifest_version":1}', "utf8"));
    const zipBytes = zip.toBuffer();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.checks.find((x) => x.id === "manifest-present")?.ok).toBe(false);
  });

  it("passes content-integrity when metadata declares a matching sha256", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal("fetch", mockFetch(zipBytes, { sha256: digest }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(true);
    expect(out.sha256).toBe(digest);
    expect(out.ok).toBe(true);
  });

  it("accepts an SRI sha256-<base64> integrity field", async () => {
    const zipBytes = sampleZip();
    const b64 = crypto.createHash("sha256").update(zipBytes).digest("base64");
    vi.stubGlobal(
      "fetch",
      mockFetch(zipBytes, {
        integrity: `sha256-${b64}`,
      }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
  });

  it("FAILS content-integrity when the declared sha256 does not match", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { sha256: "0".repeat(64) }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(
      false,
    );
    expect(out.ok).toBe(false);
  });

  it("reports the computed sha256 as info when no digest is declared", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(true);
    expect(c?.level).toBe("info");
    expect(out.sha256).toBeDefined();
    expect(out.ok).toBe(true);
  });

  it("verifies against the artifact manifest files.zip.sha256", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal(
      "fetch",
      mockFetch(zipBytes, { ok: true }, { files: { zip: { sha256: digest } } }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
    expect(out.urls.manifest).toContain("artifact-manifest");
  });

  it("manifest digest takes priority over a metadata digest", async () => {
    const zipBytes = sampleZip();
    const realDigest = crypto
      .createHash("sha256")
      .update(zipBytes)
      .digest("hex");

    vi.stubGlobal(
      "fetch",
      mockFetch(
        zipBytes,
        { sha256: realDigest },
        { files: { zip: { sha256: "0".repeat(64) } } },
      ),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(
      false,
    );
  });

  it("records a warn check with the error when the manifest fetch fails", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("artifact-manifest"))
        throw new Error("manifest origin down");
      if (u.endsWith(".zip")) return bytesResponse(zipBytes);
      return jsonResponse({ sha256: digest });
    });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "download-manifest");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("warn");
    expect(c?.detail).toMatch(/manifest origin down/);
    expect(c?.detail).toMatch(/weaker/i);
    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
    expect(out.ok).toBe(true);
  });

  it("reports the manifest fetch as a passing check when it succeeds", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal(
      "fetch",
      mockFetch(zipBytes, { ok: true }, { files: { zip: { sha256: digest } } }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "download-manifest");
    expect(c?.ok).toBe(true);
    expect(c?.level).toBe("warn");
  });

  it("keeps requireDigest failing closed when the manifest fetch fails", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("artifact-manifest"))
        throw new Error("manifest origin down");
      if (u.endsWith(".zip")) return bytesResponse(zipBytes);
      return jsonResponse({ ok: true });
    });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      requireDigest: true,
    });

    expect(out.checks.find((x) => x.id === "download-manifest")?.ok).toBe(
      false,
    );
    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("fail");
    expect(out.ok).toBe(false);
  });

  it("fails content-integrity when requireDigest is set and none is declared", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { ok: true }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      requireDigest: true,
    });

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("fail");
    expect(out.ok).toBe(false);
  });

  it("throws on a malformed expectedSha256 instead of falling back", async () => {
    const zipBytes = sampleZip();
    const realDigest = crypto
      .createHash("sha256")
      .update(zipBytes)
      .digest("hex");

    vi.stubGlobal("fetch", mockFetch(zipBytes, { sha256: realDigest }));

    await expect(
      runArtifacts({
        artifactsBaseUrl: "https://artifacts.extension.land",
        owner: "o",
        repo: "r",
        sha: "s",
        browser: "chrome",
        timeoutMs: 1000,
        expectedSha256: "a".repeat(63),
      }),
    ).rejects.toThrow(/expectedSha256/);
  });

  it("enforces expectedSha256 over a (correct) metadata digest", async () => {
    const zipBytes = sampleZip();
    const realDigest = crypto
      .createHash("sha256")
      .update(zipBytes)
      .digest("hex");

    vi.stubGlobal("fetch", mockFetch(zipBytes, { sha256: realDigest }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      expectedSha256: "f".repeat(64),
    });

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(
      false,
    );
    expect(out.ok).toBe(false);
  });

  it("names the timeout budget when a fetch is aborted", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 10,
    });

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toBe("Timed out after 10ms");
    expect(out.ok).toBe(false);
  });

  it("fails closed on a malformed manifest digest instead of falling back", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal(
      "fetch",
      mockFetch(
        zipBytes,
        { sha256: digest },
        { files: { zip: { sha256: "abc" } } },
      ),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("fail");
    expect(c?.detail).toMatch(/files\.zip\.sha256/);
    expect(c?.actual).toBe(digest);
    expect(out.ok).toBe(false);
  });

  it("fails closed on a malformed metadata digest instead of passing as undeclared", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", mockFetch(zipBytes, { sha256: "not-a-digest" }));

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("fail");
    expect(c?.detail).toMatch(/Metadata sha256/);
    expect(out.ok).toBe(false);
  });

  it("does not claim a weaker fallback when expectedSha256 is pinned and the manifest fetch fails", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("artifact-manifest"))
        throw new Error("manifest origin down");
      if (u.endsWith(".zip")) return bytesResponse(zipBytes);
      return jsonResponse({ ok: true });
    });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      expectedSha256: digest,
    });

    const c = out.checks.find((x) => x.id === "download-manifest");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("warn");
    expect(c?.detail).toMatch(/manifest origin down/);
    expect(c?.detail).toMatch(/pinned/);
    expect(c?.detail).not.toMatch(/weaker/i);
    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
    expect(out.ok).toBe(true);
  });

  it("caps a streamed download that declares no content-length", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith(".zip")
        ? streamedResponse(zipBytes, 16)
        : jsonResponse({ ok: true }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      maxBytes: 32,
    });

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/exceeds the 32-byte cap/);
  });

  it("caps a buffered download that declares no content-length", async () => {
    const zipBytes = sampleZip();
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith(".zip")
        ? response(zipBytes, "application/zip", null, false)
        : jsonResponse({ ok: true }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      maxBytes: 1,
    });

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/over the 1-byte cap/);
  });

  it("reads a streamed download in full and hashes the same bytes", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith(".zip")
        ? streamedResponse(zipBytes, 7)
        : jsonResponse({ sha256: digest }),
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    expect(out.sha256).toBe(digest);
    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
    expect(out.ok).toBe(true);
  });
});

describe("extension-artifact-integrity cli", () => {
  it("parses the documented flags", () => {
    const args = parseArgs([
      "node",
      RUNNER,
      "--owner",
      "o",
      "--repo",
      "r",
      "--sha",
      "s",
      "--browser",
      "chrome",
      "--timeout-ms",
      "250",
      "--require-digest",
    ]);
    expect(args).toEqual({
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 250,
      requireDigest: true,
    });
  });

  it("rejects a flag it does not understand instead of dropping it", () => {
    expect(() =>
      parseArgs(["node", RUNNER, "--owner", "o", "--require-digets"]),
    ).toThrow(/Unknown flag: --require-digets/);
  });

  it("rejects a --timeout-ms that is not a positive number", () => {
    expect(() => parseArgs(["node", RUNNER, "--timeout-ms", "abc"])).toThrow(
      /--timeout-ms must be a positive number/,
    );
    expect(() => parseArgs(["node", RUNNER, "--timeout-ms", "-5"])).toThrow(
      /--timeout-ms must be a positive number/,
    );
    expect(() => parseArgs(["node", RUNNER, "--timeout-ms"])).toThrow(
      /--timeout-ms must be a positive number/,
    );
  });

  it("exits 1 and names the flag when run with an unknown flag", () => {
    const r = spawnSync(
      process.execPath,
      [
        RUNNER,
        "--owner",
        "o",
        "--repo",
        "r",
        "--sha",
        "s",
        "--browser",
        "chrome",
        "--require-digets",
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown flag: --require-digets/);
  });

  it("exits 1 and names the flag when a required flag is missing", () => {
    const r = spawnSync(process.execPath, [RUNNER, "--owner", "o"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Missing required flag: --repo/);
  });
});
