// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

export type Browser = "chrome" | "firefox" | "edge" | "safari";

export type RunArtifactsInput = {
  artifactsBaseUrl: string;
  owner: string;
  repo: string;
  sha: string;
  browser: Exclude<Browser, "safari">;
  timeoutMs?: number;

  token?: string;

  expectedSha256?: string;

  requireDigest?: boolean;

  maxBytes?: number;
};

export type CheckId =
  | "download-package"
  | "zip-structure"
  | "manifest-present"
  | "download-metadata"
  | "package-integrity";

export type Check = {
  id: CheckId;
  ok: boolean;
  detail?: string;
  title?: string;

  level?: "info" | "warn" | "fail";
  summary?: string;
  remediation?: string;
  expected?: string;
  actual?: string;
};

export type RunArtifactsResult = {
  ok: boolean;
  browser: string;

  sha256?: string;
  urls: {
    package: string;
    metadata: string;
    manifest?: string;
  };
  checks: Check[];
};
