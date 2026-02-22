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

import * as p from "@clack/prompts";
import type { BankAccount } from "../../types.js";
import { httpFetch } from "../../utils/http.js";
import { printSection, printAccounts, askWithBrowserOpen, handleCancel } from "../ui.js";

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
  existingConfig?: Record<string, unknown>,
): Promise<PlaidInitResult> {
  // ── Step 1: Welcome ──────────────────────────────────────────────────
  printSection("Plaid Setup");
  p.log.info(
    "Prerequisites:\n" +
    "  - A Plaid account (https://plaid.com)\n" +
    "  - Your client_id and secret from the Plaid dashboard",
  );

  // ── Step 2: Open dashboard ───────────────────────────────────────────
  await askWithBrowserOpen(DASHBOARD_URL);

  // ── Step 3: Credentials ──────────────────────────────────────────────
  let clientId: string;
  let secret: string;

  if (existingConfig?.clientId && existingConfig?.secret) {
    const reuse = await p.confirm({
      message: `Reuse existing credentials (client_id: ${String(existingConfig.clientId).slice(0, 8)}...)?`,
      initialValue: true,
    });
    handleCancel(reuse);

    if (reuse) {
      clientId = String(existingConfig.clientId);
      secret = String(existingConfig.secret);
    } else {
      const id = await p.text({ message: "Plaid client_id", placeholder: "from dashboard.plaid.com/developers/keys" });
      handleCancel(id);
      const sec = await p.password({ message: "Plaid secret" });
      handleCancel(sec);
      clientId = id as string;
      secret = sec as string;
    }
  } else {
    const id = await p.text({ message: "Plaid client_id", placeholder: "from dashboard.plaid.com/developers/keys" });
    handleCancel(id);
    const sec = await p.password({ message: "Plaid secret" });
    handleCancel(sec);
    clientId = id as string;
    secret = sec as string;
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
  const environment = await p.select({
    message: "Environment",
    options: [
      { value: "sandbox", label: "Sandbox", hint: "test data, no real bank needed" },
      { value: "development", label: "Development", hint: "real banks, limited users" },
      { value: "production", label: "Production", hint: "full access" },
    ],
  });
  handleCancel(environment);

  const baseUrl = PLAID_ENVS[environment as string];
  let accessToken: string;

  // ── Step 5: Token creation ───────────────────────────────────────────
  if (environment === "sandbox") {
    printSection("Sandbox Setup");

    const institutionId = await p.select({
      message: "Test institution",
      options: SANDBOX_INSTITUTIONS.map((inst) => ({
        value: inst.id,
        label: inst.name,
      })),
    });
    handleCancel(institutionId);

    const institution = SANDBOX_INSTITUTIONS.find((i) => i.id === institutionId)!;

    const s = p.spinner();
    s.start(`Creating sandbox token for ${institution.name}...`);

    const createResp = (await plaidPost(baseUrl, "/sandbox/public_token/create", clientId, secret, {
      institution_id: institution.id,
      initial_products: ["transactions"],
    })) as { public_token?: string };

    if (!createResp.public_token) {
      s.stop("Failed");
      throw new Error("Sandbox token creation failed — no public_token returned");
    }

    const exchangeResp = (await plaidPost(baseUrl, "/item/public_token/exchange", clientId, secret, {
      public_token: createResp.public_token,
    })) as { access_token?: string };

    if (!exchangeResp.access_token) {
      s.stop("Failed");
      throw new Error("Token exchange failed — no access_token returned");
    }

    accessToken = exchangeResp.access_token;
    s.stop("Sandbox access token obtained.");
  } else {
    // ── Step 6: Dev/Prod — paste token ─────────────────────────────────
    printSection("Access Token");
    p.log.info(
      "For development/production, paste an existing access token.\n" +
      "(Create one via Plaid Link in your app first)",
    );

    const token = await p.text({ message: "Access token" });
    handleCancel(token);
    accessToken = (token as string).trim();

    if (!accessToken) {
      throw new Error("Access token is required for non-sandbox environments");
    }
  }

  // ── Step 7: Validate via /accounts/get ───────────────────────────────
  const vs = p.spinner();
  vs.start("Fetching accounts...");

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
    vs.stop("No accounts found");
    throw new Error("No accounts returned — check your credentials and access token");
  }

  vs.stop(`Found ${accountsResp.accounts.length} account(s).`);

  const accounts: BankAccount[] = accountsResp.accounts.map((a) => ({
    uid: a.account_id,
    iban: a.mask ? `****${a.mask}` : a.account_id,
    name: a.name,
    currency: a.balances.iso_currency_code,
    connectionId: "",
  }));

  printAccounts(accounts);

  // ── Step 8: Label ────────────────────────────────────────────────────
  const env = environment as string;
  const defaultLabel = `Plaid (${env})`;
  const label = await p.text({
    message: "Connection label",
    placeholder: defaultLabel,
    defaultValue: defaultLabel,
  });
  handleCancel(label);

  return {
    provider: "plaid",
    label: label as string,
    config: {
      clientId,
      secret,
      accessToken,
      environment: env,
      accounts,
    },
  };
}
