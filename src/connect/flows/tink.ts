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

import * as p from "@clack/prompts";
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

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

/**
 * Run the interactive Tink connect flow.
 */
export async function tinkConnectFlow(
  existingConfig?: Record<string, unknown>,
): Promise<TinkConnectResult> {
  // ── Step 1: Credentials ─────────────────────────────────────
  p.log.step("Tink Setup");
  p.log.info(
    "You'll need your Client ID and Client Secret from the Tink Console.\n" +
    "Sign up at https://console.tink.com if you don't have an account.",
  );

  const openDash = await p.confirm({
    message: "Open Tink Console in your browser?",
    initialValue: false,
  });
  handleCancel(openDash);

  if (openDash) {
    openBrowser("https://console.tink.com/");
    p.log.info("Opened https://console.tink.com/");

    const ready = await p.confirm({ message: "Ready to continue?", initialValue: true });
    handleCancel(ready);
  }

  let clientId: string;
  let clientSecret: string;

  if (existingConfig?.clientId && existingConfig?.clientSecret) {
    const reuse = await p.confirm({
      message: `Reuse existing credentials (Client ID: ${String(existingConfig.clientId).slice(0, 8)}...)?`,
      initialValue: true,
    });
    handleCancel(reuse);

    if (reuse) {
      clientId = existingConfig.clientId as string;
      clientSecret = existingConfig.clientSecret as string;
    } else {
      const sec = await p.password({ message: "Tink Client Secret" });
      handleCancel(sec);
      clientSecret = sec as string;

      const id = await p.text({ message: "Tink Client ID" });
      handleCancel(id);
      clientId = id as string;
    }
  } else {
    const sec = await p.password({ message: "Tink Client Secret" });
    handleCancel(sec);
    clientSecret = sec as string;

    const id = await p.text({ message: "Tink Client ID" });
    handleCancel(id);
    clientId = id as string;
  }

  if (!clientId || !clientSecret) {
    throw new Error("Client ID and Client Secret are required.");
  }

  // ── Step 2: Verify credentials ──────────────────────────────
  const authSpinner = p.spinner();
  authSpinner.start("Authenticating with Tink...");
  await getClientToken(clientId, clientSecret, "authorization:grant");
  authSpinner.stop("Client authenticated.");

  // ── Step 3: Market selection ────────────────────────────────
  const marketOptions = [
    ...POPULAR_MARKETS.map((m) => ({
      value: m.code,
      label: `${m.name} (${m.code})`,
    })),
    { value: "__other__", label: "Other (enter code)" },
  ];

  const marketChoice = await p.select({
    message: "Select your bank's market",
    options: marketOptions,
  });
  handleCancel(marketChoice);

  let market: string;
  if (marketChoice === "__other__") {
    const custom = await p.text({ message: "Market code", placeholder: "e.g. AT, CZ" });
    handleCancel(custom);
    market = (custom as string).toUpperCase();
  } else {
    market = marketChoice as string;
  }

  if (!market || market.length !== 2) {
    throw new Error("Invalid market code. Use a 2-letter code (e.g. PL, SE).");
  }

  return transactionsFlow(clientId, clientSecret, market);
}

// ── Transactions flow (one-time access, no user creation) ─────

async function transactionsFlow(
  clientId: string,
  clientSecret: string,
  market: string,
): Promise<TinkConnectResult> {
  // Build Tink Link URL — direct, no delegate auth needed
  const tinkLinkUrl = [
    "https://link.tink.com/1.0/transactions/connect-accounts",
    `?client_id=${encodeURIComponent(clientId)}`,
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    `&market=${market}`,
    `&locale=en_US`,
  ].join("");

  p.log.info(`Opening Tink Link in your browser...\nURL: ${tinkLinkUrl}`);
  openBrowser(tinkLinkUrl);

  p.note(
    "Connect to a bank in the Tink Link window.\n" +
    "For sandbox, pick 'Demo Bank' and use test credentials:\n" +
    "  Username: u11577912  Password: uvj476\n\n" +
    "After connecting, you'll be redirected to a URL like:\n" +
    "  https://console.tink.com/callback?code=...",
    "Tink Link",
  );

  const redirectUrl = await p.text({ message: "Paste the redirect URL" });
  handleCancel(redirectUrl);

  // Extract code from redirect URL
  const code = extractCode(redirectUrl as string);
  p.log.info(`Authorization code: ${code.slice(0, 16)}...`);

  // Exchange code for access token
  const tokenSpinner = p.spinner();
  tokenSpinner.start("Exchanging code for access token...");

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

  tokenSpinner.stop(`Access token obtained (expires in ${Math.round((tokenResult.expires_in || 7200) / 60)} minutes)`);

  // Fetch accounts
  const accSpinner = p.spinner();
  accSpinner.start("Fetching account details...");

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
    accSpinner.stop(`Found ${accounts.length} account(s).`);
    for (const acc of accounts) {
      p.log.info(`  ${acc.iban} (${acc.name}, ${acc.currency})`);
    }
  } else {
    accSpinner.stop("No accounts found yet — they may take a moment to sync.");
  }

  const defaultLabel = `Tink (${market})`;
  const label = await p.text({
    message: "Connection label",
    placeholder: defaultLabel,
    defaultValue: defaultLabel,
  });
  handleCancel(label);

  const tokenExpiresAt = new Date(
    Date.now() + (tokenResult.expires_in || 7200) * 1000,
  ).toISOString();

  return {
    provider: "tink",
    label: label as string,
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
