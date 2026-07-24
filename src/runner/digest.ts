// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

export type DeclaredDigest = { hex?: string; b64?: string };

export function parseExpectedHex(value?: string): DeclaredDigest | null {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(v) ? { hex: v } : null;
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
  for (const c of [
    m.sha256,
    m.checksum,
    nested("artifact"),
    nested("package"),
  ]) {
    if (typeof c === "string" && /^[a-f0-9]{64}$/i.test(c.trim())) {
      return { hex: c.trim().toLowerCase() };
    }
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
  return typeof sha === "string" && /^[a-f0-9]{64}$/i.test(sha.trim())
    ? { hex: sha.trim().toLowerCase() }
    : null;
}
