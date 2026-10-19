//  █████╗ ██████╗ ████████╗██╗███████╗ █████╗  ██████╗████████╗   ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██╔══██╗██╔══██╗╚══██╔══╝██║██╔════╝██╔══██╗██╔════╝╚══██╔══╝   ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ███████║██████╔╝   ██║   ██║█████╗  ███████║██║        ██║█████╗██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██╔══██║██╔══██╗   ██║   ██║██╔══╝  ██╔══██║██║        ██║╚════╝██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║  ██║██║  ██║   ██║   ██║██║     ██║  ██║╚██████╗   ██║      ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝      ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

import * as crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  readIntegrityReport,
  verifyUploadReceipt,
} from "./src/upload-receipt";

const bytes = Buffer.from("extension bytes");
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
const md5 = crypto.createHash("md5").update(bytes).digest("hex");
const record = { bytes: bytes.length, sha256, md5 };

describe("verifyUploadReceipt", () => {
  it("passes a receipt carrying the same bytes and sha256", () => {
    expect(
      verifyUploadReceipt({
        name: "chrome.zip",
        expected: record,
        received: { bytes: bytes.length, sha256, etag: sha256 },
      }),
    ).toEqual({
      name: "chrome.zip",
      verification: "upload-receipt",
      receipt: "sha256",
      ok: true,
      expected: { bytes: bytes.length, sha256 },
      received: { bytes: bytes.length, sha256, etag: sha256 },
    });
  });

  it("passes an ETag receipt that is the md5 of the bytes", () => {
    const result = verifyUploadReceipt({
      name: "chrome.zip",
      expected: record,
      received: { etag: `"${md5}"` },
    });
    expect(result.receipt).toBe("etag-md5");
    expect(result.ok).toBe(true);
  });

  it("fails a receipt naming other bytes and says which value differed", () => {
    const result = verifyUploadReceipt({
      name: "chrome.json",
      expected: record,
      received: { bytes: 3, sha256: "0".repeat(64) },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("sha256");
    expect(result.reason).toContain("bytes");
  });

  it("fails an ETag that is not the md5 of the bytes", () => {
    const result = verifyUploadReceipt({
      name: "chrome.zip",
      expected: record,
      received: { etag: "f".repeat(32) },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("md5");
  });

  it("fails when no receipt came back at all", () => {
    const result = verifyUploadReceipt({
      name: "chrome.zip",
      expected: record,
      received: null,
    });
    expect(result).toMatchObject({ ok: false, receipt: "none" });
  });

  it("fails a multipart ETag it cannot compare", () => {
    const result = verifyUploadReceipt({
      name: "chrome.zip",
      expected: record,
      received: { etag: `${md5}-3` },
    });
    expect(result).toMatchObject({ ok: false, receipt: "none" });
  });
});

describe("readIntegrityReport", () => {
  it("reads a receipt report with its artifacts", () => {
    const report = readIntegrityReport({
      verification: "upload-receipt",
      ok: false,
      browser: "firefox",
      sha256,
      artifacts: [
        { name: "firefox.zip", ok: true, receipt: "etag-md5" },
        { name: "firefox.json", ok: false, reason: "sha256 differs" },
      ],
      checks: [],
    });
    expect(report).toMatchObject({
      verification: "upload-receipt",
      ok: false,
      browser: "firefox",
      sha256,
    });
    expect(report?.artifacts.map((a) => a.name)).toEqual([
      "firefox.zip",
      "firefox.json",
    ]);
    expect(report?.failures).toEqual(["firefox.json: sha256 differs"]);
  });

  it("keeps a report written before receipts readable as a registry download", () => {
    const report = readIntegrityReport({
      ok: true,
      browser: "chrome",
      sha256,
      urls: { package: "https://example.test/chrome.zip", metadata: "x" },
      checks: [{ id: "download-package", ok: true }],
    });
    expect(report).toMatchObject({
      verification: "registry-download",
      ok: true,
      browser: "chrome",
      artifacts: [],
      failures: [],
    });
  });

  it("names a failed check of an old report as its failure", () => {
    const report = readIntegrityReport({
      ok: false,
      browser: "edge",
      checks: [
        { id: "download-package", ok: false, detail: "HTTP 401 Unauthorized" },
      ],
    });
    expect(report?.failures).toEqual(["download-package: HTTP 401 Unauthorized"]);
  });

  it("refuses what is not a report", () => {
    expect(readIntegrityReport(null)).toBeNull();
    expect(readIntegrityReport("ok")).toBeNull();
    expect(readIntegrityReport({ browser: "chrome" })).toBeNull();
  });
});
