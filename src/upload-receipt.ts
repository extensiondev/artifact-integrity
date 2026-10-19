//  █████╗ ██████╗ ████████╗██╗███████╗ █████╗  ██████╗████████╗   ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██╔══██╗██╔══██╗╚══██╔══╝██║██╔════╝██╔══██╗██╔════╝╚══██╔══╝   ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ███████║██████╔╝   ██║   ██║█████╗  ███████║██║        ██║█████╗██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██╔══██║██╔══██╗   ██║   ██║██╔══╝  ██╔══██║██║        ██║╚════╝██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║  ██║██║  ██║   ██║   ██║██║     ██║  ██║╚██████╗   ██║      ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝      ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

export type IntegrityVerification = "upload-receipt" | "registry-download";

export type ReceiptKind = "sha256" | "etag-md5" | "etag-sha256" | "none";

export type UploadRecord = {
  bytes: number;
  sha256: string;
  md5?: string;
};

export type UploadReceipt = {
  bytes?: number | null;
  sha256?: string | null;
  etag?: string | null;
};

export type ReceiptVerification = {
  name: string;
  verification: "upload-receipt";
  receipt: ReceiptKind;
  ok: boolean;
  expected: { bytes: number; sha256: string };
  received: { bytes: number | null; sha256: string | null; etag: string | null };
  reason?: string;
};

export type IntegrityReportArtifact = {
  name: string;
  ok: boolean;
  receipt?: string;
  reason?: string;
};

export type IntegrityReport = {
  verification: IntegrityVerification;
  ok: boolean;
  browser: string;
  sha256?: string;
  artifacts: IntegrityReportArtifact[];
  failures: string[];
};

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function cleanEtag(raw: unknown): string | null {
  const value = String(raw ?? "")
    .trim()
    .replace(/^W\//, "")
    .replace(/"/g, "")
    .toLowerCase();

  return value || null;
}

function receiptKind(received: UploadReceipt | null): ReceiptKind {
  if (!received) return "none";
  if (typeof received.sha256 === "string" && received.sha256) return "sha256";
  const etag = cleanEtag(received.etag);
  if (etag && HEX32.test(etag)) return "etag-md5";
  if (etag && HEX64.test(etag)) return "etag-sha256";

  return "none";
}

export function verifyUploadReceipt(input: {
  name: string;
  expected: UploadRecord;
  received: UploadReceipt | null;
}): ReceiptVerification {
  const { name, expected } = input;
  const kind = receiptKind(input.received);
  const etag = cleanEtag(input.received?.etag);
  const received = {
    bytes:
      typeof input.received?.bytes === "number" ? input.received.bytes : null,
    sha256:
      typeof input.received?.sha256 === "string"
        ? input.received.sha256.toLowerCase()
        : null,
    etag,
  };
  const problems: string[] = [];

  if (kind === "sha256") {
    if (received.sha256 !== expected.sha256) {
      problems.push(`sha256 ${received.sha256} is not ${expected.sha256}`);
    }
    if (received.bytes !== null && received.bytes !== expected.bytes) {
      problems.push(`bytes ${received.bytes} is not ${expected.bytes}`);
    }
  } else if (kind === "etag-md5") {
    if (!expected.md5 || etag !== expected.md5) {
      problems.push(`etag ${etag} is not the md5 ${expected.md5 ?? "(not recorded)"}`);
    }
  } else if (kind === "etag-sha256") {
    if (etag !== expected.sha256) {
      problems.push(`etag ${etag} is not the sha256 ${expected.sha256}`);
    }
  } else {
    problems.push(`no comparable upload receipt for ${name}`);
  }

  return {
    name,
    verification: "upload-receipt",
    receipt: kind,
    ok: problems.length === 0,
    expected: { bytes: expected.bytes, sha256: expected.sha256 },
    received,
    ...(problems.length > 0 ? { reason: problems.join("; ") } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readIntegrityReport(raw: unknown): IntegrityReport | null {
  const data = asRecord(raw);
  if (!data || typeof data.ok !== "boolean") return null;

  const verification: IntegrityVerification =
    data.verification === "upload-receipt"
      ? "upload-receipt"
      : "registry-download";
  const artifacts: IntegrityReportArtifact[] = Array.isArray(data.artifacts)
    ? data.artifacts
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          name: String(item.name ?? ""),
          ok: item.ok === true,
          ...(typeof item.receipt === "string" ? { receipt: item.receipt } : {}),
          ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
        }))
    : [];
  const checks = Array.isArray(data.checks)
    ? data.checks
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const failures =
    verification === "upload-receipt"
      ? artifacts
          .filter((artifact) => !artifact.ok)
          .map((artifact) => `${artifact.name}: ${artifact.reason ?? "no reason recorded"}`)
      : checks
          .filter((check) => check.ok === false)
          .map(
            (check) =>
              `${String(check.id ?? "check")}: ${String(check.detail ?? check.summary ?? "failed")}`,
          );
  const sha256 = typeof data.sha256 === "string" ? data.sha256 : undefined;

  return {
    verification,
    ok: data.ok,
    browser: String(data.browser ?? ""),
    ...(sha256 ? { sha256 } : {}),
    artifacts,
    failures,
  };
}
