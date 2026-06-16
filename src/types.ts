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
  checks: Array<
    | {
        id: "download-package";
        ok: boolean;
        detail?: string;
        title?: string;
        level?: "info" | "warn" | "fail";
        summary?: string;
        remediation?: string;
        expected?: string;
        actual?: string;
        docsUrl?: string;
      }
    | {
        id: "zip-structure";
        ok: boolean;
        detail?: string;
        title?: string;
        level?: "info" | "warn" | "fail";
        summary?: string;
        remediation?: string;
        expected?: string;
        actual?: string;
        docsUrl?: string;
      }
    | {
        id: "manifest-present";
        ok: boolean;
        detail?: string;
        title?: string;
        level?: "info" | "warn" | "fail";
        summary?: string;
        remediation?: string;
        expected?: string;
        actual?: string;
        docsUrl?: string;
      }
    | {
        id: "download-metadata";
        ok: boolean;
        detail?: string;
        title?: string;
        level?: "info" | "warn" | "fail";
        summary?: string;
        remediation?: string;
        expected?: string;
        actual?: string;
        docsUrl?: string;
      }
    | {
        id: "package-integrity";
        ok: boolean;
        detail?: string;
        title?: string;
        level?: "info" | "warn" | "fail";
        summary?: string;
        remediation?: string;
        expected?: string;
        actual?: string;
        docsUrl?: string;
      }
  >;
};
