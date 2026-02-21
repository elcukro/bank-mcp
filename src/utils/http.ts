/**
 * Minimal fetch wrapper with timeout and retry for banking APIs.
 */

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

export async function httpFetch(
  url: string,
  opts: FetchOptions = {},
): Promise<unknown> {
  const { method = "GET", headers, body, timeoutMs = 30000, retries = 1 } = opts;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
        );
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on 4xx (client errors)
      if (lastError.message.includes("HTTP 4")) break;
    }
  }

  throw lastError!;
}
