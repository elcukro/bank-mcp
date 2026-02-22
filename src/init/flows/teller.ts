/**
 * Guided Teller setup flow — walks the user through connecting a bank
 * account via Teller Connect (embedded widget served locally).
 */

import type { Interface as ReadlineInterface } from "node:readline/promises";
import { createServer, type Server } from "node:http";
import { openBrowser } from "../../connect/browser.js";
import { printSection, printAccounts, askWithBrowserOpen } from "../ui.js";
import type { BankAccount } from "../../types.js";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface TellerInitResult {
  provider: "teller";
  label: string;
  config: {
    accessToken: string;
    certificatePath?: string;
    privateKeyPath?: string;
    accounts?: BankAccount[];
  };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TELLER_CONNECT_JS = "https://cdn.teller.io/connect/connect.js";
const TELLER_ACCOUNTS_URL = "https://api.teller.io/accounts";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const ENVIRONMENTS = ["sandbox", "development", "production"] as const;
type TellerEnvironment = (typeof ENVIRONMENTS)[number];

/* ------------------------------------------------------------------ */
/*  HTML templates (matching existing dark theme)                      */
/* ------------------------------------------------------------------ */

function connectPage(applicationId: string, environment: string, callbackUrl: string): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp — Teller Connect</title>
<style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px; background: #1e293b; }
  .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #334155; border-top-color: #22c55e; border-radius: 50%; animation: spin .8s linear infinite; margin-right: .5rem; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
<script src="${escapeHtml(TELLER_CONNECT_JS)}"></script>
</head><body>
<div class="card">
  <h1><span class="spinner"></span> Connecting to Teller...</h1>
  <p>The Teller Connect widget should open automatically.<br>If it doesn't, please allow popups for this page.</p>
</div>
<script>
  const handler = TellerConnect.setup({
    applicationId: ${JSON.stringify(applicationId)},
    environment: ${JSON.stringify(environment)},
    onSuccess: function(enrollment) {
      window.location.href = ${JSON.stringify(callbackUrl)} + "?token=" + encodeURIComponent(enrollment.accessToken);
    },
    onFailure: function(failure) {
      document.querySelector(".card").innerHTML =
        '<h1 style="color:#ef4444">Connection failed</h1><p>' + (failure.message || "Unknown error") + '</p><p>Return to the terminal.</p>';
    },
    onExit: function() {
      document.querySelector(".card").innerHTML =
        '<h1>Connection cancelled</h1><p>Return to the terminal to try again.</p>';
    }
  });
  handler.open();
</script>
</body></html>`;
}

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp</title><style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px; background: #1e293b; }
  h1 { color: #22c55e; }
</style></head><body>
<div class="card">
  <h1>Bank connected successfully</h1>
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
  <h1>Connection failed</h1>
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

/* ------------------------------------------------------------------ */
/*  Local server for Teller Connect                                    */
/* ------------------------------------------------------------------ */

interface TokenResult {
  accessToken: string;
}

function serveTellerConnect(
  applicationId: string,
  environment: string,
): Promise<TokenResult> {
  return new Promise<TokenResult>((resolve, reject) => {
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
      value: TokenResult | Error,
    ): void {
      if (settled) return;
      settled = true;
      cleanup();
      (fn as (v: unknown) => void)(value);
    }

    server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        if (token) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(successPage());
          settle(resolve, { accessToken: token });
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(errorPage("No access token received."));
          settle(reject, new Error("No access token in Teller callback"));
        }
        return;
      }

      // Serve the Teller Connect page on root
      if (url.pathname === "/" || url.pathname === "") {
        const addr = server!.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const callbackUrl = `http://127.0.0.1:${port}/callback`;

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(connectPage(applicationId, environment, callbackUrl));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      settle(reject, err);
    });

    // Port 0 = OS-assigned ephemeral port
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      console.log(`\n  Teller Connect server listening on http://127.0.0.1:${port}`);
      openBrowser(`http://127.0.0.1:${port}`);

      timer = setTimeout(() => {
        settle(reject, new Error(`Teller Connect timed out after ${CALLBACK_TIMEOUT_MS / 1000}s`));
      }, CALLBACK_TIMEOUT_MS);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Account validation                                                 */
/* ------------------------------------------------------------------ */

interface TellerAccount {
  id: string;
  name: string;
  currency: string;
  last_four: string;
  status: string;
  type: string;
  subtype: string;
  institution: { name: string };
  enrollment_id: string;
}

async function fetchTellerAccounts(accessToken: string): Promise<BankAccount[]> {
  const credentials = Buffer.from(`${accessToken}:`).toString("base64");
  const res = await fetch(TELLER_ACCOUNTS_URL, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Teller API error ${res.status}: ${body}`);
  }

  const accounts: TellerAccount[] = await res.json() as TellerAccount[];

  return accounts
    .filter((a) => a.status === "open")
    .map((a) => ({
      uid: a.id,
      iban: `****${a.last_four}`,
      name: `${a.institution.name} ${a.name}`,
      currency: a.currency,
      connectionId: a.enrollment_id,
    }));
}

/* ------------------------------------------------------------------ */
/*  Main flow                                                          */
/* ------------------------------------------------------------------ */

export async function tellerInitFlow(
  rl: ReadlineInterface,
  existingConfig?: Record<string, unknown>,
): Promise<TellerInitResult> {
  // ── Step 1: Welcome ──────────────────────────────────────────────
  printSection("Teller — Connect your bank");
  console.log("  Prerequisites:");
  console.log("    1. A Teller account at https://teller.io");
  console.log("    2. Your Application ID from the Teller dashboard");
  console.log("");

  // ── Step 2: Open dashboard ───────────────────────────────────────
  await askWithBrowserOpen(rl, "https://teller.io/dashboard");

  // ── Step 3: Application ID ──────────────────────────────────────
  printSection("Step 1: Application ID");
  const existingAppId = existingConfig?.applicationId as string | undefined;
  let applicationId: string;

  if (existingAppId) {
    const reuse = await rl.question(
      `  Found existing Application ID (${existingAppId.slice(0, 8)}...). Use it? [Y/n] `,
    );
    applicationId = reuse.toLowerCase() === "n" ? "" : existingAppId;
  } else {
    applicationId = "";
  }

  if (!applicationId) {
    applicationId = (await rl.question("  Application ID: ")).trim();
  }

  if (!applicationId) {
    throw new Error("Application ID is required");
  }

  // ── Step 4: Environment ─────────────────────────────────────────
  printSection("Step 2: Environment");
  console.log("  1) sandbox    — test data, no real bank");
  console.log("  2) development — real banks, development credentials");
  console.log("  3) production  — live data");
  console.log("");
  const envChoice = (await rl.question("  Select environment [1]: ")).trim() || "1";
  const envIndex = parseInt(envChoice, 10) - 1;
  const environment: TellerEnvironment = ENVIRONMENTS[envIndex] ?? "sandbox";
  console.log(`  Using: ${environment}`);

  // ── Step 5: mTLS certs (dev/prod only) ──────────────────────────
  let certificatePath: string | undefined;
  let privateKeyPath: string | undefined;

  if (environment !== "sandbox") {
    printSection("Step 3: mTLS Certificates");
    console.log("  Development and production environments require mTLS certificates.");
    console.log("  Download them from the Teller dashboard.\n");

    certificatePath = (await rl.question("  Certificate path (.pem): ")).trim();
    privateKeyPath = (await rl.question("  Private key path (.pem): ")).trim();
  }

  // ── Step 6-8: Teller Connect (local server) ─────────────────────
  printSection("Step 3: Connect your bank");
  console.log("  Opening Teller Connect in your browser...");
  console.log("  Complete the bank linking process, then return here.\n");

  const { accessToken } = await serveTellerConnect(applicationId, environment);
  console.log("\n  Access token received.");

  // ── Step 9: Validate accounts ───────────────────────────────────
  printSection("Step 4: Verify connection");
  console.log("  Fetching accounts from Teller...\n");
  const accounts = await fetchTellerAccounts(accessToken);

  if (accounts.length === 0) {
    console.log("  Warning: No open accounts found. The connection may still be valid.");
  } else {
    printAccounts(accounts);
  }

  // ── Step 10: Label ──────────────────────────────────────────────
  console.log("");
  const label = (
    await rl.question("  Label for this connection [My Bank]: ")
  ).trim() || "My Bank";

  return {
    provider: "teller",
    label,
    config: {
      accessToken,
      ...(certificatePath ? { certificatePath } : {}),
      ...(privateKeyPath ? { privateKeyPath } : {}),
      ...(accounts.length > 0 ? { accounts } : {}),
    },
  };
}
