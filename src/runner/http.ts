// ██╗███╗   ██╗████████╗███████╗ ██████╗ ██████╗ ██╗████████╗██╗   ██╗
// ██║████╗  ██║╚══██╔══╝██╔════╝██╔════╝ ██╔══██╗██║╚══██╔══╝╚██╗ ██╔╝
// ██║██╔██╗ ██║   ██║   █████╗  ██║  ███╗██████╔╝██║   ██║    ╚████╔╝
// ██║██║╚██╗██║   ██║   ██╔══╝  ██║   ██║██╔══██╗██║   ██║     ╚██╔╝
// ██║██║ ╚████║   ██║   ███████╗╚██████╔╝██║  ██║██║   ██║      ██║
// ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) Cezar Augusto and the extension.dev collaborators

function authHeaders(token?: string): Record<string, string> {
  const trimmed = String(token || "").trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

async function request<T>(
  url: string,
  timeoutMs: number,
  token: string | undefined,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: authHeaders(token),
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
): Promise<Buffer> {
  return request(url, timeoutMs, token, async (res) =>
    Buffer.from(await res.arrayBuffer()),
  );
}

export function fetchJson(
  url: string,
  timeoutMs: number,
  token?: string,
): Promise<unknown> {
  return request(url, timeoutMs, token, (res) => res.json());
}
