//  █████╗ ██████╗ ████████╗██╗███████╗ █████╗  ██████╗████████╗   ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██╔══██╗██╔══██╗╚══██╔══╝██║██╔════╝██╔══██╗██╔════╝╚══██╔══╝   ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ███████║██████╔╝   ██║   ██║█████╗  ███████║██║        ██║█████╗██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██╔══██║██╔══██╗   ██║   ██║██╔══╝  ██╔══██║██║        ██║╚════╝██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║  ██║██║  ██║   ██║   ██║██║     ██║  ██║╚██████╗   ██║      ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝      ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

export const SUPPORTED_BROWSERS = ["chrome", "firefox", "edge"] as const;

export type Browser = (typeof SUPPORTED_BROWSERS)[number];

export type RunArtifactsInput = {
  artifactsBaseUrl: string;
  owner: string;
  repo: string;
  sha: string;
  browser: Browser;
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
  | "download-manifest"
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
