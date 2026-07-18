import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import * as crypto from "node:crypto";
import { runArtifacts } from "./src/runner";

function mockFetch(zipBytes: Buffer, metadata: unknown, manifest: unknown = {}) {
  return async (url: string) => {
    if (String(url).endsWith(".zip")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => zipBytes,
      } as unknown as Response;
    }
    const body = String(url).includes("artifact-manifest")
      ? manifest
      : metadata;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    } as unknown as Response;
  };
}

function sampleZip() {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from('{"manifest_version":3}', "utf8"));
  return zip.toBuffer();
}

describe("extension-artifact-integrity", () => {
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
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      if (String(url).endsWith(".zip")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => new Uint8Array().buffer,
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      };
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
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array().buffer,
        json: async () => ({}),
      };
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

  it("validates a zip structure from a mocked fetch", async () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from('{"manifest_version":3}', "utf8"));
    const zipBytes = zip.toBuffer();

    const originalFetch = globalThis.fetch;

    (globalThis as any).fetch = async (url: string) => {
      if (url.endsWith(".zip")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => zipBytes,
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true }),
      };
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
    (globalThis as any).fetch = mockFetch(zipBytes, { integrity: `sha256-${b64}` });

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

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(false);
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
    const realDigest = crypto.createHash("sha256").update(zipBytes).digest("hex");
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

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(false);
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
    const realDigest = crypto.createHash("sha256").update(zipBytes).digest("hex");
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
    const realDigest = crypto.createHash("sha256").update(zipBytes).digest("hex");
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

    expect(out.checks.find((x) => x.id === "package-integrity")?.ok).toBe(false);
    expect(out.ok).toBe(false);
  });
});
