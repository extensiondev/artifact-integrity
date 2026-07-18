# Security Policy

## Supported versions

The latest published version on npm receives security fixes. Older versions
are not maintained; upgrade to the latest release before reporting.

## Reporting a vulnerability

Please report vulnerabilities privately, not through public issues or pull
requests.

- Preferred: open a private advisory through GitHub, under the repository's
  **Security** tab, using "Report a vulnerability".
- Alternatively, email boss@cezaraugusto.net.

Include the affected version, a description of the issue, and a minimal
reproduction if you have one. You will get an acknowledgement, and once a fix
is released we are happy to credit you unless you prefer to stay anonymous.

## Scope

This package is a release gate: it downloads a browser extension artifact and
verifies its structure, manifest, and content digest. Reports that are
especially in scope:

- A tampered or malformed artifact that the gate reports as passing.
- Any way to make the tool process untrusted input unsafely (path traversal,
  resource exhaustion, code execution).
- Leakage of a caller-supplied token.

Note by design: the manifest and metadata digest sources are supplied by the
same origin that serves the bytes, so they defend against corruption, not
against a fully compromised registry. Only a pinned `expectedSha256`
(established out of band) defends against a malicious origin. A run that
"passes" against a self-declared digest from a hostile registry is a
documented limitation, not a vulnerability.
