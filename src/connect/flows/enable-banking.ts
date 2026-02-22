/**
 * Enable Banking connect flow — automates the PSD2 OAuth authorization.
 *
 * Steps:
 *   1. Log in to Enable Banking dashboard
 *   2. Collect appId + privateKeyPath (reuse from config if available)
 *   3. Ensure redirect URI is registered (one-time guided setup)
 *   4. Country selection
 *   5. GET /aspsps?country=X - list banks
 *   6. User picks bank
 *   7. POST /auth - get bank login URL
 *   8. Open browser - user logs in at bank
 *   9. User pastes redirect URL containing auth code
 *  10. POST /sessions with code - get session_id
 *  11. GET /sessions, /accounts/{uid}/details - fetch account info
 */

import { randomBytes } from "node:crypto";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { generateJwt } from "../../providers/enable-banking/auth.js";
import { httpFetch } from "../../utils/http.js";
import { openBrowser } from "../browser.js";

const API_BASE = "https://api.enablebanking.com";
const REDIRECT_URL = "https://localhost:13579/callback";

// Popular PSD2 countries shown first
const POPULAR_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "SE", name: "Sweden" },
  { code: "FI", name: "Finland" },
] as const;

interface ASPSP {
  name: string;
  country: string;
  // Enable Banking returns more fields, but we only need these
  [key: string]: unknown;
}

export interface EnableBankingConnectResult {
  provider: "enable-banking";
  label: string;
  config: {
    appId: string;
    privateKeyPath: string;
    sessionId: string;
    validUntil: string;
    accounts: Array<{ uid: string; iban: string; name: string; currency: string }>;
  };
}

/**
 * Run the interactive Enable Banking connect flow.
 *
 * @param rl - readline interface (passed from parent orchestrator)
 * @param existingConfig - existing EB config to reuse credentials from
 */
export async function enableBankingConnectFlow(
  rl: ReadlineInterface,
  existingConfig?: Record<string, unknown>,
): Promise<EnableBankingConnectResult> {
  // ── Step 1: Log in to Enable Banking ──────────────────────────
  console.log("  First, log in to your Enable Banking account.");
  console.log("  You'll need your App ID and private key from the dashboard.\n");
  console.log("  Don't have an account yet? Sign up at https://enablebanking.com\n");

  const openDash = await rl.question("? Press 'o' to open enablebanking.com, or Enter if already logged in: ");
  if (openDash.toLowerCase() === "o") {
    openBrowser("https://enablebanking.com/cp/applications/");
    console.log("\n  Opened https://enablebanking.com/cp/applications/");
    await rl.question("? Press Enter once you're logged in...");
  }

  // ── Step 2: Credentials ───────────────────────────────────────
  let appId: string;
  let privateKeyPath: string;

  if (existingConfig?.appId && existingConfig?.privateKeyPath) {
    const reuse = await rl.question(
      `\n  Found existing credentials (App ID: ${String(existingConfig.appId).slice(0, 8)}...)\n? Reuse them? (Y/n): `,
    );
    if (reuse.toLowerCase() !== "n") {
      appId = existingConfig.appId as string;
      privateKeyPath = existingConfig.privateKeyPath as string;
    } else {
      console.log(`\n  Copy the App ID from your application in the dashboard.`);
      appId = await rl.question("? Enable Banking App ID: ");
      console.log(`  The private key (.pem) was downloaded when you created the app.`);
      privateKeyPath = await rl.question("? Path to RSA private key (.pem): ");
    }
  } else {
    console.log(`\n  Copy the App ID from your application in the dashboard.`);
    appId = await rl.question("? Enable Banking App ID: ");
    console.log(`  The private key (.pem) was downloaded when you created the app.`);
    privateKeyPath = await rl.question("? Path to RSA private key (.pem): ");
  }

  if (!appId || !privateKeyPath) {
    throw new Error("App ID and private key path are required.");
  }

  // Verify the key is readable by attempting JWT generation
  try {
    generateJwt(appId, privateKeyPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read private key: ${msg}`);
  }

  console.log("\n  Credentials verified.\n");

  // ── Step 3: Redirect URI setup (one-time) ─────────────────────
  await ensureRedirectUri(rl, appId);

  // ── Step 4: Country selection ─────────────────────────────────
  console.log("\n  Select your bank's country:");
  POPULAR_COUNTRIES.forEach((c, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${c.name} (${c.code})`);
  });
  console.log(`    ${POPULAR_COUNTRIES.length + 1}. Other (enter code)`);

  const countryInput = await rl.question("\n? Country: ");
  let countryCode: string;

  const idx = parseInt(countryInput, 10);
  if (idx >= 1 && idx <= POPULAR_COUNTRIES.length) {
    countryCode = POPULAR_COUNTRIES[idx - 1].code;
  } else if (idx === POPULAR_COUNTRIES.length + 1) {
    countryCode = (await rl.question("? Country code (e.g. AT, CZ): ")).toUpperCase();
  } else {
    // Allow direct country code input
    countryCode = countryInput.toUpperCase();
  }

  if (!countryCode || countryCode.length !== 2) {
    throw new Error("Invalid country code. Use a 2-letter ISO code (e.g. PL, DE).");
  }

  // ── Step 5: Fetch banks (ASPSPs) ──────────────────────────────
  console.log(`\n  Fetching banks for ${countryCode}...`);
  const token = generateJwt(appId, privateKeyPath);
  const aspsps = (await httpFetch(`${API_BASE}/aspsps?country=${countryCode}`, {
    headers: authHeaders(token),
  })) as { aspsps: ASPSP[] };

  const banks = aspsps.aspsps;
  if (!banks || banks.length === 0) {
    throw new Error(`No banks found for country ${countryCode}.`);
  }

  console.log(`  Found ${banks.length} bank(s).`);

  // ── Step 6: Bank selection ────────────────────────────────────
  let selectedBank: ASPSP;

  if (banks.length > 20) {
    // Search filter for long lists
    const search = await rl.question("\n? Search by name: ");
    const filtered = banks.filter((b) =>
      b.name.toLowerCase().includes(search.toLowerCase()),
    );

    if (filtered.length === 0) {
      throw new Error(`No banks matching "${search}".`);
    }

    filtered.forEach((b, i) => {
      console.log(`    ${i + 1}. ${b.name}`);
    });

    const bankIdx = parseInt(await rl.question("\n? Select bank: "), 10) - 1;
    selectedBank = filtered[bankIdx];
  } else {
    banks.forEach((b, i) => {
      console.log(`    ${i + 1}. ${b.name}`);
    });

    const bankIdx = parseInt(await rl.question("\n? Select bank: "), 10) - 1;
    selectedBank = banks[bankIdx];
  }

  if (!selectedBank) {
    throw new Error("Invalid bank selection.");
  }

  // ── Step 7: POST /auth → get bank login URL ──────────────────
  const state = randomBytes(16).toString("hex");
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19) + "Z";

  const authToken = generateJwt(appId, privateKeyPath);
  const authResponse = (await httpFetch(`${API_BASE}/auth`, {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({
      access: {
        valid_until: validUntil,
      },
      aspsp: {
        name: selectedBank.name,
        country: countryCode,
      },
      state,
      redirect_url: REDIRECT_URL,
      psu_type: "personal",
    }),
  })) as { url: string };

  if (!authResponse.url) {
    throw new Error("Enable Banking API did not return an authorization URL.");
  }

  // ── Step 8: Open browser → user logs in at bank ───────────────
  console.log(`\n  Opening your bank's login page...`);
  console.log(`  URL: ${authResponse.url}\n`);
  openBrowser(authResponse.url);

  console.log("  After logging in, your browser will redirect to a page");
  console.log("  that won't load — that's expected!");
  console.log("");
  console.log("  Copy the full URL from your browser's address bar and paste it below.");
  console.log("  It will look like: https://localhost:13579/callback?code=...&state=...\n");

  // ── Step 9: User pastes redirect URL → extract code ───────────
  const redirectInput = await rl.question("? Paste the redirect URL: ");
  const code = extractCodeFromUrl(redirectInput, state);

  const sessionToken = generateJwt(appId, privateKeyPath);
  const sessionResponse = (await httpFetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ code }),
  })) as { session_id: string };

  const sessionId = sessionResponse.session_id;
  if (!sessionId) {
    throw new Error("Failed to create session — no session_id returned.");
  }

  console.log(`\n  Authorization received!`);

  // ── Step 10: Fetch accounts (with retry for rate limits) ──────
  let accounts: EnableBankingConnectResult["config"]["accounts"] = [];
  let actualValidUntil = validUntil;

  try {
    console.log("  Fetching account details...");
    const sessionDetailToken = generateJwt(appId, privateKeyPath);
    const sessionDetails = (await fetchWithRetry(
      `${API_BASE}/sessions/${sessionId}`,
      { headers: authHeaders(sessionDetailToken) },
    )) as { accounts: string[]; access?: { valid_until?: string } };

    if (sessionDetails.access?.valid_until) {
      actualValidUntil = sessionDetails.access.valid_until;
    }

    for (const uid of sessionDetails.accounts) {
      const detailToken = generateJwt(appId, privateKeyPath);
      const details = (await fetchWithRetry(
        `${API_BASE}/accounts/${uid}/details`,
        { headers: authHeaders(detailToken) },
      )) as {
        uid?: string;
        account_id?: { iban?: string };
        name?: string;
        details?: string;
        product?: string;
        currency?: string;
      };

      accounts.push({
        uid: details.uid || uid,
        iban: details.account_id?.iban || uid,
        name: details.details || details.product || details.name || uid,
        currency: details.currency || "EUR",
      });
    }

    console.log(`  Session created (valid until ${actualValidUntil.slice(0, 10)})`);
    console.log(`  Found ${accounts.length} account(s):`);
    for (const acc of accounts) {
      console.log(`    - ${acc.iban} (${acc.name}, ${acc.currency})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n  Warning: Could not fetch account details (${msg})`);
    console.log("  The session is still valid — accounts will be fetched on first use.\n");
  }

  // ── Label ─────────────────────────────────────────────────────
  const label =
    (await rl.question(`\n? Connection label [${selectedBank.name}]: `)) ||
    selectedBank.name;

  return {
    provider: "enable-banking",
    label,
    config: {
      appId,
      privateKeyPath,
      sessionId,
      validUntil: actualValidUntil,
      accounts,
    },
  };
}

/**
 * Parse the authorization code from the redirect URL pasted by the user.
 * Validates the CSRF state token matches what we sent.
 */
export function extractCodeFromUrl(urlStr: string, expectedState: string): string {
  let url: URL;
  try {
    url = new URL(urlStr.trim());
  } catch {
    throw new Error(
      "Invalid URL. Copy the full URL from the browser address bar, starting with https://",
    );
  }

  const error = url.searchParams.get("error");
  if (error) {
    const desc = url.searchParams.get("error_description") || error;
    throw new Error(`Bank authorization failed: ${desc}`);
  }

  const state = url.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("State mismatch (CSRF validation failed). Please try again.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error(
      "No authorization code found in the URL. Make sure you copied the complete URL.",
    );
  }

  return code;
}

/**
 * Guide the user through registering the redirect URI in Enable Banking.
 * This is a one-time setup — returning users can skip it.
 */
async function ensureRedirectUri(
  rl: ReadlineInterface,
  appId: string,
): Promise<void> {
  const dashboardUrl = `https://enablebanking.com/cp/applications/${appId}/edit`;

  console.log("  ── Redirect URI (one-time setup) ──────────────────────");
  console.log("");
  console.log("  bank-mcp needs a redirect URI registered in your");
  console.log("  Enable Banking app so the bank can send you back here.");
  console.log("");
  console.log("  Add this URI to your app's allowed redirect URIs:");
  console.log("");
  console.log(`    ${REDIRECT_URL}`);
  console.log("");

  const skip = await rl.question("? Already done? Press Enter to skip, or 'o' to open dashboard: ");

  if (skip.toLowerCase() === "o") {
    console.log(`\n  Opening: ${dashboardUrl}`);
    openBrowser(dashboardUrl);
    console.log("");
    console.log("  Steps:");
    console.log("    1. Find your app in the dashboard");
    console.log(`    2. Add redirect URI:  ${REDIRECT_URL}`);
    console.log("    3. Save changes");
    console.log("");
    await rl.question("? Press Enter when done...");
  }

  console.log("");
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Fetch with exponential backoff for 429 (rate limit) responses.
 * Retries up to 3 times with 5s, 15s, 30s delays.
 */
async function fetchWithRetry(
  url: string,
  opts: import("../../utils/http.js").FetchOptions,
): Promise<unknown> {
  const delays = [5000, 15000, 30000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await httpFetch(url, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const isRateLimit = msg.includes("429");

      if (!isRateLimit || attempt >= delays.length) {
        throw err;
      }

      const delaySec = delays[attempt] / 1000;
      console.log(`  Rate limited by bank — waiting ${delaySec}s before retry...`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  throw new Error("Unexpected: retry loop exited without return or throw");
}
