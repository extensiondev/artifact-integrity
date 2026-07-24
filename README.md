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

[extension.dev](https://extension.dev) · [Templates](https://templates.extension.dev) · [Discord](https://discord.gg/v9h2RgeTSN)

## Why a release gate

An extension artifact is the exact bytes your users install. Between the build that produced it and the store that publishes it sit a registry, a CDN, and a release pipeline, any of which can serve the wrong bytes. This package downloads the artifact your release is about to promote and verifies it end to end:

- **Download** the packaged artifact and its co-published metadata over a token-aware fetch with a hard timeout and a size cap, so private and unlisted projects gate the same way public ones do and a hostile origin cannot exhaust the runner
- **Structure** the archive as a valid zip, inspected in memory (never extracted to disk), with a root `manifest.json` that parses and declares `manifest_version` 2 or 3
- **Integrity**: hash the downloaded bytes with SHA-256 and compare them against a declared digest
- **Report** every check as a deterministic JSON file your CI can gate on, archive, or diff release over release

Content integrity is the check that turns this from a well-formedness lint into a trust boundary, but be precise about which threat each digest source defends against. The digest is resolved, in order, from an explicit `expectedSha256` you pin in CI, then the artifact manifest's `files.zip.sha256`, then a `sha256` or SRI `integrity` field in the co-published metadata.

- The **manifest and metadata digests come from the same origin that serves the bytes.** They catch accidental corruption and partial tampering, but a _fully compromised_ registry can serve tampered bytes together with a matching digest, and the check would pass.
- Only a **pinned `expectedSha256`** (established out of band, never fetched) defends against a compromised registry. Set it in CI whenever the guarantee matters, and set `requireDigest` to fail closed when no digest can be resolved at all, so an unverifiable artifact never slips through green.

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
  // gate. When set it is the source of truth; a malformed value is a hard error,
  // never a silent fallback to a registry-declared digest.
  expectedSha256:
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  // Optional. Fail closed when no digest can be resolved from any source,
  // instead of passing the integrity check informationally.
  requireDigest: true,
  // Optional bearer token for token-gated (private/unlisted) projects. Sent
  // only over HTTPS; a non-HTTPS base URL with a token is refused.
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
  --require-digest \
  --token "$EXTENSION_DEV_TOKEN" \
  --out /abs/path/to/artifact-integrity.json
```

`--expected-sha256`, `--require-digest`, and `--token` are optional. `--expected-sha256` and `--token` also read from the `EXTENSIONDEV_EXPECTED_SHA256` and `EXTENSION_DEV_TOKEN` environment variables, and `--require-digest` from `EXTENSIONDEV_REQUIRE_DIGEST=1`.

## Output

- **stdout**: `Wrote <OUTPUT_PATH>`
- **side effect**: writes a JSON result file (default: `./artifact-integrity.json`)
- **exit code**: `0` when the gate passes, `1` on failure or error

The gate is defined by severity, not by a raw boolean: a run is `ok: false` only when a `fail`-level check fails. `info` and `warn` checks are reported but never block, so a warning can never silently become a hard failure.

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
    // Severity class the check carries WHEN IT FAILS, not its current status:
    // a passing check can still read `level: "fail"`. Only a failing
    // `fail`-level check blocks the gate.
    level?: "info" | "warn" | "fail";
    summary?: string;
    remediation?: string;
    expected?: string;
    actual?: string;
  }>;
};
```

Checks may include optional metadata fields (`title`, `level`, `summary`, `remediation`, `expected`, `actual`) to make reports more actionable.

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
      "detail": "manifest_version must be 2 or 3 (found 1)",
      "title": "Manifest present",
      "level": "fail",
      "summary": "manifest.json exists at the archive root and declares manifest_version 2 or 3.",
      "remediation": "Place a valid manifest.json (manifest_version 2 or 3) at the root of the extension package.",
      "expected": "Valid /manifest.json at zip root",
      "actual": "manifest_version must be 2 or 3 (found 1)"
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
| [`@extension.dev/mcp`](https://www.npmjs.com/package/@extension.dev/mcp) | Give AI agents tools to build, run, debug, and publish extensions |
| [`@extension.dev/skill`](https://www.npmjs.com/package/@extension.dev/skill) | Teach AI agents the judgment half: cross-browser rules, gotchas, playbooks |

## Community

- Join the [Discord](https://discord.gg/v9h2RgeTSN) for help and feedback
- Report a bug or request a feature on [GitHub](https://github.com/extensiondev/artifact-integrity/issues)

## License

Apache-2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators. See [LICENSE](LICENSE).
