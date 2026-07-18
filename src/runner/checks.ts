// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) Cezar Augusto and the extension.dev collaborators

import type { RunArtifactsResult } from "../types";

type Check = RunArtifactsResult["checks"][number];

export function enrichCheck(check: Check): Check {
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
