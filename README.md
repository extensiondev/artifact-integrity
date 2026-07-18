[npm-version-image]: https://img.shields.io/npm/v/@extension.dev/artifact-integrity?color=26FFB8
[npm-version-url]: https://www.npmjs.com/package/@extension.dev/artifact-integrity
[action-image]: https://github.com/extensiondev/artifact-integrity/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/extensiondev/artifact-integrity/actions

[![Version][npm-version-image]][npm-version-url] [![workflow][action-image]][action-url]

# @extension.dev/artifact-integrity

The release gate for browser extensions. Download an artifact, verify its zip
structure, manifest, metadata, and content digest, and emit a deterministic
JSON report your CI can gate on: exit 0 ships, exit 1 does not.

Content integrity is the check that makes this a trust boundary and not just a
well-formedness lint: the downloaded bytes are hashed with SHA-256 and compared
against a declared digest, so a registry or CDN that serves tampered but valid
looking bytes fails the gate. The digest is resolved, in order, from an explicit
`expectedSha256` you pin in CI, then the artifact manifest's `files.zip.sha256`,
then a `sha256` or SRI `integrity` field in the co-published metadata. When none
is declared the check is informational and reports the computed hash so you can
record or pin it.

Verification tooling is only worth trusting when you can read it; this
package is open source for exactly that reason.

## Install

```bash
npm install @extension.dev/artifact-integrity
```

## Local Development

```bash
pnpm install
pnpm lint
pnpm build
pnpm test
```

## CI

The `CI` workflow runs on pushes to `main`, pull requests, and manual dispatch.
It performs the same steps used locally:

```bash
pnpm install --no-frozen-lockfile
pnpm lint
pnpm build
pnpm test
```

## Release

This repository publishes through the `Release` GitHub Actions workflow.

Prerequisites:

- Add an `NPM_TOKEN` repository secret with publish access for `@extension.dev/artifact-integrity`
- Trigger the `Release` workflow from GitHub Actions with a plain semver like `0.1.1`

What the workflow does:

1. Validates that the requested version and git tag do not already exist
2. Installs dependencies, then runs lint, build, and test
3. Updates `package.json`
4. Creates commit `release: v<version>` and tag `v<version>`
5. Pushes the commit and tag
6. Publishes the package to npm

## Usage

### Library usage

```ts
import { runArtifacts } from "@extension.dev/artifact-integrity";

const result = await runArtifacts({
  artifactsBaseUrl: "https://registry.extension.land",
  owner: "my-org",
  repo: "my-extension",
  sha: "abc123",
  browser: "chrome",
  // Optional. Pin the expected package digest to make content integrity a hard
  // gate; without it the check falls back to the manifest/metadata digest.
  expectedSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  // Optional bearer token for token-gated (private/unlisted) projects.
  token: process.env.EXTENSION_DEV_TOKEN,
});
```

### CLI usage

```bash
extension-artifact-integrity \
  --base-url https://registry.extension.land \
  --owner my-org \
  --repo my-extension \
  --sha abc123 \
  --browser chrome \
  --expected-sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 \
  --token "$EXTENSION_DEV_TOKEN" \
  --out /abs/path/to/artifact-integrity.json
```

`--expected-sha256` and `--token` are optional and also read from the
`EXTENSIONDEV_EXPECTED_SHA256` and `EXTENSION_DEV_TOKEN` environment variables.

## Output

- **stdout**: `Wrote <OUTPUT_PATH>`
- **side effect**: writes a JSON result file (default: `./artifact-integrity.json`)
- **exit code**: `0` when all checks pass, `1` on failure or error

### Schema

Top-level shape (public-safe):

```ts
type ArtifactIntegrityReport = {
  ok: boolean;
  browser: string;
  // SHA-256 (hex) of the downloaded package archive, when bytes were retrieved.
  // Always reported so you can record or pin it even if no digest was declared.
  sha256?: string;
  urls: {
    package: string;
    metadata: string;
    manifest?: string;
  };
  checks: Array<{
    id:
      | "download-package"
      | "zip-structure"
      | "manifest-present"
      | "download-metadata"
      | "package-integrity";
    ok: boolean;
    detail?: string;
    title?: string;
    level?: "info" | "warn" | "fail";
    summary?: string;
    remediation?: string;
    expected?: string;
    actual?: string;
    docsUrl?: string;
  }>;
};
```

Checks may include optional metadata fields (`title`, `level`, `summary`,
`remediation`, `expected`, `actual`, `docsUrl`) to make reports more actionable.

Maxed-out JSON example:

```json
{
  "ok": false,
  "browser": "chrome",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "urls": {
    "package": "https://artifacts.extension.land/my-org/my-extension/abc123/chrome.zip",
    "metadata": "https://artifacts.extension.land/my-org/my-extension/abc123/chrome.json",
    "manifest": "https://artifacts.extension.land/my-org/my-extension/abc123/artifact-manifest/chrome.json"
  },
  "checks": [
    {
      "id": "download-package",
      "ok": true,
      "title": "Download package",
      "level": "fail",
      "summary": "Package archive is reachable and downloadable.",
      "remediation": "Ensure the build artifact exists and the URL is correct.",
      "expected": "HTTP 200 and valid bytes",
      "actual": "Downloaded"
    },
    {
      "id": "zip-structure",
      "ok": true,
      "title": "Zip structure",
      "level": "fail",
      "summary": "Package is a valid zip archive.",
      "remediation": "Ensure the artifact is a valid zip file.",
      "expected": "Valid zip archive",
      "actual": "Zip parsed"
    },
    {
      "id": "manifest-present",
      "ok": false,
      "detail": "Missing /tmp/artifact-integrity-XXXX/manifest.json",
      "title": "Manifest present",
      "level": "fail",
      "summary": "manifest.json exists at the archive root.",
      "remediation": "Place manifest.json at the root of the extension package.",
      "expected": "/manifest.json at zip root",
      "actual": "Missing /manifest.json"
    },
    {
      "id": "download-metadata",
      "ok": true,
      "title": "Download metadata",
      "level": "fail",
      "summary": "Browser metadata JSON is reachable and valid JSON.",
      "remediation": "Publish <browser>.json with build metadata.",
      "expected": "HTTP 200 and valid JSON",
      "actual": "Downloaded"
    },
    {
      "id": "package-integrity",
      "ok": false,
      "title": "Package integrity",
      "level": "fail",
      "summary": "Package bytes match the declared SHA-256.",
      "remediation": "Republish the artifact, or fix the declared digest in metadata.",
      "expected": "abc0...def",
      "actual": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "detail": "Package digest mismatch: expected abc0...def, got e3b0c442...b855."
    }
  ]
}
```

## The extension.dev open source stack

| Package | Use it to |
| --- | --- |
| [`@extension.dev/mcp`](https://github.com/extensiondev/mcp) | Give AI agents tools to build, run, and debug extensions |
| [`@extension.dev/skill`](https://github.com/extensiondev/skill) | Teach agents the cross-browser rules and silent-failure gotchas |
| [`@extension.dev/compiler`](https://github.com/extensiondev/compiler) | Build extensions in the browser with esbuild-wasm |
| [`@extension.dev/core`](https://github.com/extensiondev/core) | Authenticate and publish to the extension.dev platform |

All of it rides on [Extension.js](https://github.com/extension-js/extension.js), the open-source cross-browser extension framework.

## License

MIT
