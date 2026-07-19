# Changelog

## 0.5.1

Registry catch-up release: publishes the 0.5.0 security-hardening work to npm,
which was tagged but never reached the registry. No code changes since 0.5.0.

## 0.5.0

Security-hardening and presentation pass to bring the package in line with the
rest of the extension.dev open source stack.

Security and trust model:

- The archive is now inspected entirely in memory. It is no longer extracted
  to disk, which removes the zip-slip path traversal, malicious-symlink, and
  zip-bomb disk-exhaustion surface that came with extraction (and the temp-dir
  leak). The manifest check is now stricter too: it must parse as JSON and
  declare `manifest_version` 2 or 3.
- Content integrity can fail closed. A provided-but-malformed `expectedSha256`
  is a hard error instead of a silent fallback to a registry-declared digest,
  and the new `requireDigest` option fails the check when no digest can be
  resolved from any source.
- Downloads are size-capped (default 256 MiB) so a hostile origin cannot
  exhaust the runner, and the bearer token is sent only over HTTPS.
- The `browser` value is validated against the supported set and encoded
  before it reaches a URL, and the gate result is defined by severity so a
  `warn` check can never silently become a hard failure.
- CI now blocks on high and critical dependency advisories, and the repository
  ships a `SECURITY.md`.

Presentation and plumbing:

- Source files now carry the shared ANSI wordmark banner and MIT attribution
  header, matching the sibling packages.
- README rebuilt around a hero, a plain-English "why a release gate" section,
  and the stack cross-links, with the internal build notes moved out.
- Release workflow now gates on a `## <version>` CHANGELOG section, extracts it
  into an annotated tag, and cuts a matching GitHub release.
- LICENSE and README attribution aligned to "Cezar Augusto and the
  extension.dev collaborators".
- Security and dependency hardening: `adm-zip` moved to `^0.6.0` (fixes the
  crafted-zip memory allocation advisory), the dev toolchain (eslint, vitest,
  rslib, typescript-eslint) bumped to current majors, the unused `np` release
  helper dropped, and patched transitive versions pinned. `pnpm audit` is now
  clean.
- Build split into a dedicated `tsconfig.build.json` so declaration output
  stays free of test and config files under the newer toolchain.

## 0.4.0

Version reconciliation release. npm had drifted ahead of this repository
(an out-of-band 0.2.0, plus a 0.3.0-0.3.53 publish/unpublish series whose
version numbers npm permanently reserves), so this release jumps past the
burned range and realigns npm latest with the repository.

- MIT license (package.json, LICENSE, README).
- Fix lint error in bin/runner.cjs that kept CI red since April.
- DevRel pass: audience-led description, keywords, README hero, and the
  extension.dev open source stack cross-links.

## 0.1.1

- Honor `EXTENSION_DEV_TOKEN` for token-gated registry reads.
- Bump node engines to `>=20.18`.

## 0.1.0

Initial release.

- `runArtifacts()` library API and `extension-artifact-integrity` CLI:
  download a browser extension artifact and its metadata, validate zip
  structure and manifest presence, and emit a deterministic JSON report for
  CI gating (exit 0 on pass, 1 on failure).
