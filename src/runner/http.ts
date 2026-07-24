// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// Apache License 2.0 (c) 2026 Cezar Augusto and the extension.dev collaborators

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const JSON_MAX_BYTES = 16 * 1024 * 1024;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function authHeaders(
  url: string,
  token: string | undefined,
): Record<string, string> {
  const trimmed = String(token || "").trim();
  if (!trimmed) return {};

  if (!isHttps(url)) {
    throw new Error("Refusing to send a bearer token over a non-HTTPS URL.");
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(
      `Response body is ${declared} bytes, over the ${maxBytes}-byte cap.`,
    );
  }

  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== "function") {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(
        `Response body is ${buf.length} bytes, over the ${maxBytes}-byte cap.`,
      );
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeds the ${maxBytes}-byte cap.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function request<T>(
  url: string,
  timeoutMs: number,
  token: string | undefined,
  accept: string,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept, ...authHeaders(url, token) },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    return await read(res);
  } finally {
    clearTimeout(t);
  }
}

export function fetchBytes(
  url: string,
  timeoutMs: number,
  token?: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<Buffer> {
  return request(
    url,
    timeoutMs,
    token,
    "application/zip, application/octet-stream",
    (res) => readCapped(res, maxBytes),
  );
}

export function fetchJson(
  url: string,
  timeoutMs: number,
  token?: string,
): Promise<unknown> {
  return request(url, timeoutMs, token, "application/json", async (res) => {
    const text = (await readCapped(res, JSON_MAX_BYTES)).toString("utf8");
    try {
      return JSON.parse(text);
    } catch {
      const ct = res.headers?.get?.("content-type") || "unknown content-type";
      throw new Error(
        `Expected JSON but received ${ct} (likely a soft-404 or error page).`,
      );
    }
  });
}
