/**
 * Local OAuth callback server — receives the authorization code from the
 * bank's redirect after the user logs in. Binds to 127.0.0.1 only (not
 * externally reachable). Self-destructs after the first callback or timeout.
 */

import { createServer, type Server } from "node:http";

const DEFAULT_PORT = 13579;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface CallbackResult {
  code: string;
}

export interface CallbackServerOptions {
  port?: number;
  timeoutMs?: number;
  state: string; // Expected CSRF state token
}

/**
 * Start a local HTTP server and wait for the OAuth callback.
 *
 * Returns a promise that resolves with the authorization code, or rejects
 * on timeout / state mismatch / bank error.
 */
export function waitForCallback(
  opts: CallbackServerOptions,
): Promise<CallbackResult> {
  const port = opts.port ?? DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expectedState = opts.state;

  return new Promise<CallbackResult>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let server: Server | undefined;

    function cleanup(): void {
      if (timer) clearTimeout(timer);
      if (server) {
        server.close();
        server = undefined;
      }
    }

    function settle(
      fn: typeof resolve | typeof reject,
      value: CallbackResult | Error,
    ): void {
      if (settled) return;
      settled = true;
      cleanup();
      (fn as (v: unknown) => void)(value);
    }

    server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

      // Only handle the callback path
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      // Check for bank-side error (e.g. user denied access)
      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") || error;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorPage(desc));
        settle(reject, new Error(`Bank authorization failed: ${desc}`));
        return;
      }

      // Validate CSRF state
      const state = url.searchParams.get("state");
      if (state !== expectedState) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorPage("State mismatch — possible CSRF attack. Please try again."));
        settle(reject, new Error("State mismatch (CSRF validation failed)"));
        return;
      }

      // Extract authorization code
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorPage("No authorization code received from bank."));
        settle(reject, new Error("No authorization code in callback"));
        return;
      }

      // Success!
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successPage());
      settle(resolve, { code });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        settle(
          reject,
          new Error(
            `Port ${port} is already in use. Close the other process or try again.`,
          ),
        );
      } else {
        settle(reject, err);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      // Start timeout — if the user doesn't authorize in time, give up
      timer = setTimeout(() => {
        settle(reject, new Error(`Authorization timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
  });
}

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp</title><style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px; background: #1e293b; }
  h1 { color: #22c55e; }
</style></head><body>
<div class="card">
  <h1>Authorization successful</h1>
  <p>You can close this tab and return to the terminal.</p>
</div>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp</title><style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px; background: #1e293b; }
  h1 { color: #ef4444; }
</style></head><body>
<div class="card">
  <h1>Authorization failed</h1>
  <p>${escapeHtml(message)}</p>
  <p>Return to the terminal for details.</p>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
