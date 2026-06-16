# Changelog

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
