[npm-version-image]: https://img.shields.io/npm/v/@extension.dev/artifact-integrity?color=26FFB8
[npm-version-url]: https://www.npmjs.com/package/@extension.dev/artifact-integrity
[action-image]: https://github.com/extensiondev/artifact-integrity/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/extensiondev/artifact-integrity/actions

[![Version][npm-version-image]][npm-version-url] [![workflow][action-image]][action-url]

# @extension.dev/artifact-integrity

The release gate for browser extensions. Download an artifact, verify its zip
structure, manifest, and metadata, and emit a deterministic JSON report your
CI can gate on: exit 0 ships, exit 1 does not.

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
  --out /abs/path/to/artifact-integrity.json
```

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
  urls: {
    package: string;
    metadata: string;
  };
  checks: Array<{
    id:
      | "download-package"
      | "zip-structure"
      | "manifest-present"
      | "download-metadata";
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
  "urls": {
    "package": "https://artifacts.extension.land/my-org/my-extension/abc123/chrome.zip",
    "metadata": "https://artifacts.extension.land/my-org/my-extension/abc123/chrome.json"
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
