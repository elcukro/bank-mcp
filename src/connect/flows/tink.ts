/**
 * Tink connect flow — one-time access via Tink Link:
 *
 *   1. Collect client_secret + client_id
 *   2. Verify credentials via client_credentials grant
 *   3. Select market (country)
 *   4. Build Tink Link URL (direct — no user creation needed)
 *   5. User connects bank via Tink Link
 *   6. User pastes redirect URL → extract authorization code
 *   7. POST /api/v1/oauth/token (authorization_code grant) → access token
 *   8. GET /data/v2/accounts → account details
 */

import type { Interface as ReadlineInterface } from "node:readline/promises";
import { httpFetch } from "../../utils/http.js";
import { openBrowser } from "../browser.js";

const TINK_API = "https://api.tink.com";
const REDIRECT_URI = "https://console.tink.com/callback";

const POPULAR_MARKETS = [
  { code: "PL", name: "Poland" },
  { code: "SE", name: "Sweden" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "FI", name: "Finland" },
  { code: "NO", name: "Norway" },
] as const;

export interface TinkConnectResult {
  provider: "tink";
  label: string;
  config: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    tokenExpiresAt: string;
    accounts: Array<{ uid: string; iban: string; name: string; currency: string }>;
  };
}

/**
 * Run the interactive Tink connect flow.
 */
export async function tinkConnectFlow(
  rl: ReadlineInterface,
  existingConfig?: Record<string, unknown>,
): Promise<TinkConnectResult> {
  // ── Step 1: Credentials ─────────────────────────────────────
  console.log("  First, log in to your Tink Console at https://console.tink.com");
  console.log("  You'll need your Client ID and Client Secret from your app.\n");

  const openDash = await rl.question("? Press 'o' to open Tink Console, or Enter if ready: ");
  if (openDash.toLowerCase() === "o") {
    openBrowser("https://console.tink.com/");
    console.log("\n  Opened https://console.tink.com/");
    await rl.question("? Press Enter once you're logged in...");
  }

  let clientId: string;
  let clientSecret: string;

  if (existingConfig?.clientId && existingConfig?.clientSecret) {
    const reuse = await rl.question(
      `\n  Found existing credentials (Client ID: ${String(existingConfig.clientId).slice(0, 8)}...)\n? Reuse them? (Y/n): `,
    );
    if (reuse.toLowerCase() !== "n") {
      clientId = existingConfig.clientId as string;
      clientSecret = existingConfig.clientSecret as string;
    } else {
      clientSecret = await rl.question("\n? Tink Client Secret: ");
      clientId = await rl.question("? Tink Client ID: ");
    }
  } else {
    clientSecret = await rl.question("\n? Tink Client Secret: ");
    clientId = await rl.question("? Tink Client ID: ");
  }

  if (!clientId || !clientSecret) {
    throw new Error("Client ID and Client Secret are required.");
  }

  // ── Step 2: Verify credentials ──────────────────────────────
  console.log("\n  Authenticating with Tink...");
  await getClientToken(clientId, clientSecret, "authorization:grant");
  console.log("  Client authenticated.\n");

  // ── Step 3: Market selection ────────────────────────────────
  console.log("  Select your bank's market:");
  POPULAR_MARKETS.forEach((m, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${m.name} (${m.code})`);
  });
  console.log(`    ${POPULAR_MARKETS.length + 1}. Other (enter code)`);

  const marketInput = await rl.question("\n? Market: ");
  let market: string;
  const idx = parseInt(marketInput, 10);
  if (idx >= 1 && idx <= POPULAR_MARKETS.length) {
    market = POPULAR_MARKETS[idx - 1].code;
  } else if (idx === POPULAR_MARKETS.length + 1) {
    market = (await rl.question("? Market code (e.g. AT, CZ): ")).toUpperCase();
  } else {
    market = marketInput.toUpperCase();
  }

  if (!market || market.length !== 2) {
    throw new Error("Invalid market code. Use a 2-letter code (e.g. PL, SE).");
  }

  return transactionsFlow(rl, clientId, clientSecret, market, existingConfig);
}

// ── Transactions flow (one-time access, no user creation) ─────

async function transactionsFlow(
  rl: ReadlineInterface,
  clientId: string,
  clientSecret: string,
  market: string,
  _existingConfig?: Record<string, unknown>,
): Promise<TinkConnectResult> {
  // Build Tink Link URL — direct, no delegate auth needed
  const tinkLinkUrl = [
    "https://link.tink.com/1.0/transactions/connect-accounts",
    `?client_id=${encodeURIComponent(clientId)}`,
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    `&market=${market}`,
    `&locale=en_US`,
  ].join("");

  console.log("\n  Opening Tink Link in your browser...\n");
  console.log(`  URL: ${tinkLinkUrl}\n`);
  openBrowser(tinkLinkUrl);

  console.log("  Connect to a bank in the Tink Link window.");
  console.log("  For sandbox, pick 'Demo Bank' and use test credentials:");
  console.log("    Username: u11577912  Password: uvj476\n");
  console.log("  After connecting, you'll be redirected to a URL like:");
  console.log("    https://console.tink.com/callback?code=...\n");

  const redirectUrl = await rl.question("? Paste the redirect URL: ");

  // Extract code from redirect URL
  const code = extractCode(redirectUrl);
  console.log(`\n  Authorization code: ${code.slice(0, 16)}...`);

  // Exchange code for access token
  console.log("  Exchanging code for access token...");
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
  }).toString();

  const tokenResult = (await httpFetch(`${TINK_API}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  })) as { access_token: string; expires_in: number };

  console.log(`  Access token obtained (expires in ${Math.round((tokenResult.expires_in || 7200) / 60)} minutes)`);

  // Fetch accounts
  console.log("  Fetching account details...");
  const accountsResult = (await httpFetch(`${TINK_API}/data/v2/accounts`, {
    headers: { Authorization: `Bearer ${tokenResult.access_token}` },
  })) as {
    accounts?: Array<{
      id: string;
      name: string;
      identifiers?: { iban?: { iban: string } };
      balances?: { booked?: { amount: { currencyCode: string } } };
    }>;
  };

  const accounts = (accountsResult.accounts || []).map((a) => ({
    uid: a.id,
    iban: a.identifiers?.iban?.iban || a.id,
    name: a.name || a.id,
    currency: a.balances?.booked?.amount?.currencyCode || "EUR",
  }));

  if (accounts.length > 0) {
    console.log(`  Found ${accounts.length} account(s):`);
    for (const acc of accounts) {
      console.log(`    - ${acc.iban} (${acc.name}, ${acc.currency})`);
    }
  } else {
    console.log("  No accounts found yet — they may take a moment to sync.");
  }

  const defaultLabel = `Tink (${market})`;
  const label =
    (await rl.question(`\n? Connection label [${defaultLabel}]: `)) || defaultLabel;

  const tokenExpiresAt = new Date(
    Date.now() + (tokenResult.expires_in || 7200) * 1000,
  ).toISOString();

  return {
    provider: "tink",
    label,
    config: {
      clientId,
      clientSecret,
      accessToken: tokenResult.access_token,
      tokenExpiresAt,
      accounts,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Get a client access token via client_credentials grant.
 */
async function getClientToken(
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  }).toString();

  const result = (await httpFetch(`${TINK_API}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })) as { access_token: string };

  if (!result.access_token) {
    throw new Error("Failed to get client token — check your credentials.");
  }

  return result.access_token;
}

/**
 * Extract authorization code from Tink Link redirect URL.
 */
function extractCode(urlStr: string): string {
  let url: URL;
  try {
    url = new URL(urlStr.trim());
  } catch {
    // Maybe they pasted just the code
    if (urlStr.trim().length > 10 && !urlStr.includes(" ")) {
      return urlStr.trim();
    }
    throw new Error("Invalid URL. Copy the full URL from the browser address bar.");
  }

  const code = url.searchParams.get("code");
  if (code) return code;

  // Check for error
  const error = url.searchParams.get("error");
  if (error) {
    const msg = url.searchParams.get("message") || error;
    throw new Error(`Tink Link failed: ${msg}`);
  }

  throw new Error(
    "No authorization code found in the URL. Make sure you copied the complete redirect URL.",
  );
}

