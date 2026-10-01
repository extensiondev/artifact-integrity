//  █████╗ ██████╗ ████████╗██╗███████╗ █████╗  ██████╗████████╗   ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██╔══██╗██╔══██╗╚══██╔══╝██║██╔════╝██╔══██╗██╔════╝╚══██╔══╝   ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ███████║██████╔╝   ██║   ██║█████╗  ███████║██║        ██║█████╗██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██╔══██║██╔══██╗   ██║   ██║██╔══╝  ██╔══██║██║        ██║╚════╝██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║  ██║██║  ██║   ██║   ██║██║     ██║  ██║╚██████╗   ██║      ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═╝      ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

export type DeclaredDigest = { hex?: string; b64?: string };

export function parseExpectedHex(value?: string): DeclaredDigest | null {
  const v = (value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(v) ? { hex: v } : null;
}

function hexDigest(value: string, source: string): DeclaredDigest {
  const v = value.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(v)) return { hex: v };
  throw new Error(
    `${source} is present but is not a 64-character hex SHA-256; refusing to fall back to a weaker source.`,
  );
}

export function parseDeclaredDigest(meta: unknown): DeclaredDigest | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const nested = (key: string) => {
    const obj = m[key];
    return obj && typeof obj === "object"
      ? (obj as Record<string, unknown>).sha256
      : undefined;
  };
  for (const [source, c] of [
    ["sha256", m.sha256],
    ["checksum", m.checksum],
    ["artifact.sha256", nested("artifact")],
    ["package.sha256", nested("package")],
  ] as const) {
    if (typeof c === "string") return hexDigest(c, `Metadata ${source}`);
  }
  if (typeof m.integrity === "string") {
    const match = m.integrity.trim().match(/^sha256-([A-Za-z0-9+/=]+)$/);
    if (match && match[1]) return { b64: match[1] };
  }
  return null;
}

export function parseManifestDigest(manifest: unknown): DeclaredDigest | null {
  if (!manifest || typeof manifest !== "object") return null;
  const files = (manifest as Record<string, unknown>).files;
  const zip =
    files && typeof files === "object"
      ? (files as Record<string, unknown>).zip
      : undefined;
  const sha =
    zip && typeof zip === "object"
      ? (zip as Record<string, unknown>).sha256
      : undefined;
  return typeof sha === "string"
    ? hexDigest(sha, "Artifact manifest files.zip.sha256")
    : null;
}
