[npm-version-image]: https://img.shields.io/npm/v/%40extension.dev%2Fartifact-integrity.svg?color=26FFB8
[npm-version-url]: https://www.npmjs.com/package/@extension.dev/artifact-integrity
[npm-downloads-image]: https://img.shields.io/npm/dm/%40extension.dev%2Fartifact-integrity.svg?color=26FFB8
[npm-downloads-url]: https://www.npmjs.com/package/@extension.dev/artifact-integrity
[discord-image]: https://img.shields.io/discord/1253608412890271755?label=Discord&logo=discord&style=flat&color=26FFB8
[discord-url]: https://discord.gg/v9h2RgeTSN

# @extension.dev/artifact-integrity [![Version][npm-version-image]][npm-version-url] [![Downloads][npm-downloads-image]][npm-downloads-url] [![Discord][discord-image]][discord-url]

> The release gate for browser extensions. Download an artifact, verify it, and fail CI on tampered bytes before they ship.

<img alt="Logo" align="right" src="https://media.extension.land/brand/extension-dev/logo-dock.png" width="15.5%" />

```bash
npm install @extension.dev/artifact-integrity
```

Runs as a library call or a one-line CLI in any CI. Exit 0 ships, exit 1 does not.

[extension.dev](https://extension.dev) · [Documentation](https://extension.js.org) · [Templates](https://templates.extension.dev) · [Examples](https://github.com/extension-js/examples) · [Discord](https://discord.gg/v9h2RgeTSN)

## Why a release gate

An extension artifact is the exact bytes your users install. Between the build that produced it and the store that publishes it sit a registry, a CDN, and a release pipeline, any of which can serve the wrong bytes. This package downloads the artifact your release is about to promote and verifies it end to end:

- **Download** the packaged artifact and its co-published metadata over a token-aware fetch with a hard timeout, so private and unlisted projects gate the same way public ones do
- **Structure** the archive as a valid zip with `manifest.json` at its root, the minimum shape every browser store rejects without
- **Integrity**: hash the downloaded bytes with SHA-256 and compare them against a declared digest, so a registry or CDN that serves tampered but valid looking bytes fails the gate
- **Report** every check as a deterministic JSON file your CI can gate on, archive, or diff release over release

Content integrity is the check that turns this from a well-formedness lint into a trust boundary. The digest is resolved, in order, from an explicit `expectedSha256` you pin in CI, then the artifact manifest's `files.zip.sha256`, then a `sha256` or SRI `integrity` field in the co-published metadata. When none is declared the check is informational and reports the computed hash so you can record or pin it.

Verification tooling is only worth trusting when you can read it; this package is open source for exactly that reason.

## Usage

### Library

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

### CLI

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

`--expected-sha256` and `--token` are optional and also read from the `EXTENSIONDEV_EXPECTED_SHA256` and `EXTENSION_DEV_TOKEN` environment variables.

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

Checks may include optional metadata fields (`title`, `level`, `summary`, `remediation`, `expected`, `actual`, `docsUrl`) to make reports more actionable.

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

## The extension.dev stack

| Package | Use it to |
| --- | --- |
| [`@extension.dev/mcp`](https://github.com/extensiondev/mcp) | Give AI agents tools to build, run, and debug extensions |
| [`@extension.dev/skill`](https://github.com/extensiondev/skill) | Teach agents the cross-browser rules and silent-failure gotchas |
| [`@extension.dev/compiler`](https://github.com/extensiondev/compiler) | Build extensions in the browser with esbuild-wasm |
| [`@extension.dev/core`](https://github.com/extensiondev/core) | Authenticate and publish to the extension.dev platform |

All of it rides on [Extension.js](https://github.com/extension-js/extension.js), the open-source cross-browser extension framework.

## Community

- Join the [Discord](https://discord.gg/v9h2RgeTSN) for help and feedback
- Browse production-ready [examples](https://github.com/extension-js/examples)
- Report Extension.js framework issues on [GitHub](https://github.com/extension-js/extension.js/issues)

## License

MIT (c) Cezar Augusto and the extension.dev collaborators
