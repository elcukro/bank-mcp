/**
 * Guided Plaid setup flow — walks the user through connecting a bank via Plaid.
 *
 * Steps:
 *  1. Welcome + prerequisites
 *  2. Open Plaid dashboard for API keys
 *  3. Collect client_id + secret (with credential reuse)
 *  4. Environment selection (sandbox / development / production)
 *  5. Sandbox: auto-create token; Dev/Prod: paste access token
 *  6. Validate via /accounts/get
 *  7. Connection label
 */

import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { BankAccount } from "../../types.js";
import { httpFetch } from "../../utils/http.js";
import { printSection, printAccounts, askWithBrowserOpen } from "../ui.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaidInitResult {
  provider: "plaid";
  label: string;
  config: {
    clientId: string;
    secret: string;
    accessToken: string;
    environment: string;
    accounts?: BankAccount[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAID_ENVS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

const SANDBOX_INSTITUTIONS = [
  { id: "ins_109508", name: "First Platypus Bank" },
  { id: "ins_109509", name: "Tartan Bank" },
];

const DASHBOARD_URL = "https://dashboard.plaid.com/developers/keys";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function plaidHeaders(clientId: string, secret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "PLAID-CLIENT-ID": clientId,
    "PLAID-SECRET": secret,
  };
}

async function plaidPost(
  baseUrl: string,
  path: string,
  clientId: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return httpFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: plaidHeaders(clientId, secret),
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

export async function plaidInitFlow(
  rl: ReadlineInterface,
  existingConfig?: Record<string, unknown>,
): Promise<PlaidInitResult> {
  // ── Step 1: Welcome ──────────────────────────────────────────────────
  printSection("Plaid Setup");
  console.log("  Prerequisites:");
  console.log("    - A Plaid account (https://plaid.com)");
  console.log("    - Your client_id and secret from the Plaid dashboard\n");

  // ── Step 2: Open dashboard ───────────────────────────────────────────
  await askWithBrowserOpen(rl, DASHBOARD_URL);

  // ── Step 3: Credentials ──────────────────────────────────────────────
  let clientId: string;
  let secret: string;

  if (existingConfig?.clientId && existingConfig?.secret) {
    const reuse = await rl.question(
      `  Reuse existing credentials (client_id: ${String(existingConfig.clientId).slice(0, 8)}...)? [Y/n]: `,
    );
    if (!reuse || reuse.toLowerCase() !== "n") {
      clientId = String(existingConfig.clientId);
      secret = String(existingConfig.secret);
    } else {
      clientId = await rl.question("  Plaid client_id: ");
      secret = await rl.question("  Plaid secret: ");
    }
  } else {
    clientId = await rl.question("  Plaid client_id: ");
    secret = await rl.question("  Plaid secret: ");
  }

  if (!clientId.trim()) {
    throw new Error("client_id is required");
  }
  if (!secret.trim()) {
    throw new Error("secret is required");
  }

  clientId = clientId.trim();
  secret = secret.trim();

  // ── Step 4: Environment ──────────────────────────────────────────────
  printSection("Environment");
  console.log("  1) sandbox   — test data, no real bank needed");
  console.log("  2) development — real banks, limited users");
  console.log("  3) production — full access\n");

  const envChoice = (await rl.question("  Choose environment [1]: ")) || "1";
  const envMap: Record<string, string> = { "1": "sandbox", "2": "development", "3": "production" };
  const environment = envMap[envChoice] || "sandbox";
  const baseUrl = PLAID_ENVS[environment];

  let accessToken: string;

  // ── Step 5: Token creation ───────────────────────────────────────────
  if (environment === "sandbox") {
    printSection("Sandbox Setup");
    console.log("  Available test institutions:");
    for (let i = 0; i < SANDBOX_INSTITUTIONS.length; i++) {
      console.log(`    ${i + 1}) ${SANDBOX_INSTITUTIONS[i].name}`);
    }
    const instChoice = (await rl.question("\n  Choose institution [1]: ")) || "1";
    const instIdx = Math.max(0, Math.min(parseInt(instChoice, 10) - 1, SANDBOX_INSTITUTIONS.length - 1));
    const institution = SANDBOX_INSTITUTIONS[instIdx];

    console.log(`\n  Creating sandbox token for ${institution.name}...`);

    const createResp = (await plaidPost(baseUrl, "/sandbox/public_token/create", clientId, secret, {
      institution_id: institution.id,
      initial_products: ["transactions"],
    })) as { public_token?: string };

    if (!createResp.public_token) {
      throw new Error("Sandbox token creation failed — no public_token returned");
    }

    const exchangeResp = (await plaidPost(baseUrl, "/item/public_token/exchange", clientId, secret, {
      public_token: createResp.public_token,
    })) as { access_token?: string };

    if (!exchangeResp.access_token) {
      throw new Error("Token exchange failed — no access_token returned");
    }

    accessToken = exchangeResp.access_token;
    console.log("  Sandbox access token obtained.\n");
  } else {
    // ── Step 6: Dev/Prod — paste token ─────────────────────────────────
    printSection("Access Token");
    console.log("  For development/production, paste an existing access token.");
    console.log("  (Create one via Plaid Link in your app first)\n");
    accessToken = await rl.question("  Access token: ");
    if (!accessToken.trim()) {
      throw new Error("Access token is required for non-sandbox environments");
    }
    accessToken = accessToken.trim();
  }

  // ── Step 7: Validate via /accounts/get ───────────────────────────────
  printSection("Validating");
  console.log("  Fetching accounts...\n");

  const accountsResp = (await plaidPost(baseUrl, "/accounts/get", clientId, secret, {
    access_token: accessToken,
  })) as {
    accounts?: Array<{
      account_id: string;
      name: string;
      mask: string;
      type: string;
      subtype: string;
      balances: { iso_currency_code: string };
    }>;
  };

  if (!accountsResp.accounts || accountsResp.accounts.length === 0) {
    throw new Error("No accounts returned — check your credentials and access token");
  }

  const accounts: BankAccount[] = accountsResp.accounts.map((a) => ({
    uid: a.account_id,
    iban: a.mask ? `****${a.mask}` : a.account_id,
    name: a.name,
    currency: a.balances.iso_currency_code,
    connectionId: "",
  }));

  printAccounts(accounts);

  // ── Step 8: Label ────────────────────────────────────────────────────
  const defaultLabel = `Plaid (${environment})`;
  const label = (await rl.question(`\n  Connection label [${defaultLabel}]: `)) || defaultLabel;

  return {
    provider: "plaid",
    label,
    config: {
      clientId,
      secret,
      accessToken,
      environment,
      accounts,
    },
  };
}
