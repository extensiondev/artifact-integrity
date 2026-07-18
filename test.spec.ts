import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import * as crypto from "node:crypto";
import { runArtifacts } from "./src/runner";

function response(bytes: Buffer, contentType: string) {
  const headers = new Map<string, string>([
    ["content-type", contentType],
    ["content-length", String(bytes.length)],
  ]);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: null,
    arrayBuffer: async () => bytes,
    text: async () => bytes.toString("utf8"),
    json: async () => JSON.parse(bytes.toString("utf8")),
  } as unknown as Response;
}

function bytesResponse(bytes: Buffer) {
  return response(bytes, "application/zip");
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
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      return String(url).endsWith(".zip")
        ? bytesResponse(zipBytes)
        : jsonResponse({});
    };

    await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      token: "tok_abc",
    });

    (globalThis as any).fetch = originalFetch;

    expect(seenHeaders.length).toBeGreaterThan(0);
    for (const h of seenHeaders) {
      expect(h.Authorization).toBe("Bearer tok_abc");
    }
  });

  it("omits Authorization when no token is provided", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      return String(url).endsWith(".zip")
        ? bytesResponse(zipBytes)
        : jsonResponse({});
    };

    await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    (globalThis as any).fetch = originalFetch;

    for (const h of seenHeaders) {
      expect(h.Authorization).toBeUndefined();
    }
  });

  it("refuses to send a bearer token over a non-HTTPS URL", async () => {
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "http://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      token: "tok_abc",
    });
    (globalThis as any).fetch = originalFetch;

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/non-HTTPS/i);
  });

  it("caps an oversized download instead of buffering it", async () => {
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      maxBytes: 1,
    });
    (globalThis as any).fetch = originalFetch;

    const c = out.checks.find((x) => x.id === "download-package");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/cap/i);
  });

  it("reports a friendly error when metadata is not JSON", async () => {
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      const u = String(url);
      if (u.endsWith(".zip")) return bytesResponse(zipBytes);
      return response(
        Buffer.from("<html>Not Found</html>", "utf8"),
        "text/html",
      );
    };

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    const c = out.checks.find((x) => x.id === "download-metadata");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/Expected JSON|soft-404/i);
  });

  it("validates a zip structure from a mocked fetch", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from('{"manifest_version":3}', "utf8"));
    const zipBytes = zip.toBuffer();

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });

    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((c) => c.id === "zip-structure")?.ok).toBe(true);
    expect(out.checks.find((c) => c.id === "manifest-present")?.ok).toBe(true);
    expect(out.checks.find((c) => c.id === "download-metadata")?.ok).toBe(true);
  });

  it("fails manifest-present when manifest.json is missing from the zip", async () => {
    const zip = new AdmZip();
    zip.addFile("popup.js", Buffer.from("console.log(1)", "utf8"));
    const zipBytes = zip.toBuffer();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    const c = out.checks.find((x) => x.id === "manifest-present");
    expect(c?.ok).toBe(false);
    expect(out.checks.find((x) => x.id === "zip-structure")?.ok).toBe(true);
  });

  it("fails manifest-present when manifest.json is not valid JSON", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from("{ not json", "utf8"));
    const zipBytes = zip.toBuffer();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((x) => x.id === "manifest-present")?.ok).toBe(false);
  });

  it("fails manifest-present when manifest_version is not 2 or 3", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from('{"manifest_version":1}', "utf8"));
    const zipBytes = zip.toBuffer();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((x) => x.id === "manifest-present")?.ok).toBe(false);
  });

  it("passes content-integrity when metadata declares a matching sha256", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { sha256: digest });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(true);
    expect(out.sha256).toBe(digest);
    expect(out.ok).toBe(true);
  });

  it("accepts an SRI sha256-<base64> integrity field", async () => {
    const zipBytes = sampleZip();
    const b64 = crypto.createHash("sha256").update(zipBytes).digest("base64");
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, {
      integrity: `sha256-${b64}`,
    });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;
    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
  });

  it("FAILS content-integrity when the declared sha256 does not match", async () => {
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { sha256: "0".repeat(64) });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(
      false,
    );
    expect(out.ok).toBe(false);
  });

  it("reports the computed sha256 as info when no digest is declared", async () => {
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    const c = out.checks.find((x) => x.id === "package-integrity");
    expect(c?.ok).toBe(true);
    expect(c?.level).toBe("info");
    expect(out.sha256).toBeDefined();
    expect(out.ok).toBe(true);
  });

  it("verifies against the artifact manifest files.zip.sha256", async () => {
    const zipBytes = sampleZip();
    const digest = crypto.createHash("sha256").update(zipBytes).digest("hex");
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(
      zipBytes,
      { ok: true },
      { files: { zip: { sha256: digest } } },
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(true);
    expect(out.urls.manifest).toContain("artifact-manifest");
  });

  it("manifest digest takes priority over a metadata digest", async () => {
    const zipBytes = sampleZip();
    const realDigest = crypto
      .createHash("sha256")
      .update(zipBytes)
      .digest("hex");
    const originalFetch = globalThis.fetch;

    (globalThis as any).fetch = mockFetch(
      zipBytes,
      { sha256: realDigest },
      { files: { zip: { sha256: "0".repeat(64) } } },
    );

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
    });
    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(
      false,
    );
  });

  it("fails content-integrity when requireDigest is set and none is declared", async () => {
    const zipBytes = sampleZip();
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = mockFetch(zipBytes, { ok: true });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      requireDigest: true,
    });
    (globalThis as any).fetch = originalFetch;

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
    const originalFetch = globalThis.fetch;

    (globalThis as any).fetch = mockFetch(zipBytes, { sha256: realDigest });

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
    (globalThis as any).fetch = originalFetch;
  });

  it("enforces expectedSha256 over a (correct) metadata digest", async () => {
    const zipBytes = sampleZip();
    const realDigest = crypto
      .createHash("sha256")
      .update(zipBytes)
      .digest("hex");
    const originalFetch = globalThis.fetch;

    (globalThis as any).fetch = mockFetch(zipBytes, { sha256: realDigest });

    const out = await runArtifacts({
      artifactsBaseUrl: "https://artifacts.extension.land",
      owner: "o",
      repo: "r",
      sha: "s",
      browser: "chrome",
      timeoutMs: 1000,
      expectedSha256: "f".repeat(64),
    });
    (globalThis as any).fetch = originalFetch;

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(
      false,
    );
    expect(out.ok).toBe(false);
  });
});
