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
import * as p from "@clack/prompts";
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

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

/**
 * Run the interactive Enable Banking connect flow.
 *
 * @param existingConfig - existing EB config to reuse credentials from
 */
export async function enableBankingConnectFlow(
  existingConfig?: Record<string, unknown>,
): Promise<EnableBankingConnectResult> {
  // ── Step 1: Log in to Enable Banking ──────────────────────────
  p.log.step("Enable Banking Setup");
  p.log.info(
    "You'll need your App ID and private key from the dashboard.\n" +
    "Don't have an account yet? Sign up at https://enablebanking.com",
  );

  const openDash = await p.confirm({
    message: "Open enablebanking.com in your browser?",
    initialValue: false,
  });
  handleCancel(openDash);

  if (openDash) {
    openBrowser("https://enablebanking.com/cp/applications/");
    p.log.info("Opened https://enablebanking.com/cp/applications/");

    const ready = await p.confirm({ message: "Ready to continue?", initialValue: true });
    handleCancel(ready);
  }

  // ── Step 2: Credentials ───────────────────────────────────────
  let appId: string;
  let privateKeyPath: string;

  if (existingConfig?.appId && existingConfig?.privateKeyPath) {
    const reuse = await p.confirm({
      message: `Reuse existing credentials (App ID: ${String(existingConfig.appId).slice(0, 8)}...)?`,
      initialValue: true,
    });
    handleCancel(reuse);

    if (reuse) {
      appId = existingConfig.appId as string;
      privateKeyPath = existingConfig.privateKeyPath as string;
    } else {
      const id = await p.text({ message: "Enable Banking App ID", placeholder: "from the dashboard" });
      handleCancel(id);
      appId = id as string;

      const keyPath = await p.text({ message: "Path to RSA private key (.pem)", placeholder: "downloaded when app was created" });
      handleCancel(keyPath);
      privateKeyPath = keyPath as string;
    }
  } else {
    const id = await p.text({ message: "Enable Banking App ID", placeholder: "from the dashboard" });
    handleCancel(id);
    appId = id as string;

    const keyPath = await p.text({ message: "Path to RSA private key (.pem)", placeholder: "downloaded when app was created" });
    handleCancel(keyPath);
    privateKeyPath = keyPath as string;
  }

  if (!appId || !privateKeyPath) {
    throw new Error("App ID and private key path are required.");
  }

  // Verify the key is readable — retry on failure
  for (;;) {
    try {
      generateJwt(appId, privateKeyPath);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Cannot read private key: ${msg}`);

      const retry = await p.confirm({
        message: "Try a different path?",
        initialValue: true,
      });
      handleCancel(retry);

      if (!retry) {
        throw new Error(`Cannot read private key: ${msg}`);
      }

      const newPath = await p.text({ message: "Path to RSA private key (.pem)" });
      handleCancel(newPath);
      privateKeyPath = (newPath as string).trim();

      if (!privateKeyPath) {
        throw new Error("Private key path is required.");
      }
    }
  }

  p.log.success("Credentials verified.");

  // ── Step 3: Redirect URI setup (one-time) ─────────────────────
  await ensureRedirectUri(appId);

  // ── Step 4: Country selection ─────────────────────────────────
  const countryOptions = [
    ...POPULAR_COUNTRIES.map((c) => ({
      value: c.code,
      label: `${c.name} (${c.code})`,
    })),
    { value: "__other__", label: "Other (enter code)" },
  ];

  const countryChoice = await p.select({
    message: "Select your bank's country",
    options: countryOptions,
  });
  handleCancel(countryChoice);

  let countryCode: string;
  if (countryChoice === "__other__") {
    const custom = await p.text({ message: "Country code", placeholder: "e.g. AT, CZ" });
    handleCancel(custom);
    countryCode = (custom as string).toUpperCase();
  } else {
    countryCode = countryChoice as string;
  }

  if (!countryCode || countryCode.length !== 2) {
    throw new Error("Invalid country code. Use a 2-letter ISO code (e.g. PL, DE).");
  }

  // ── Step 5: Fetch banks (ASPSPs) ──────────────────────────────
  const bankSpinner = p.spinner();
  bankSpinner.start(`Fetching banks for ${countryCode}...`);

  const token = generateJwt(appId, privateKeyPath);
  const aspsps = (await httpFetch(`${API_BASE}/aspsps?country=${countryCode}`, {
    headers: authHeaders(token),
  })) as { aspsps: ASPSP[] };

  const banks = aspsps.aspsps;
  if (!banks || banks.length === 0) {
    bankSpinner.stop("No banks found.");
    throw new Error(`No banks found for country ${countryCode}.`);
  }

  bankSpinner.stop(`Found ${banks.length} bank(s).`);

  // ── Step 6: Bank selection ────────────────────────────────────
  let selectedBank: ASPSP;

  if (banks.length > 20) {
    // Search filter for long lists
    const search = await p.text({ message: "Search by bank name" });
    handleCancel(search);

    const filtered = banks.filter((b) =>
      b.name.toLowerCase().includes((search as string).toLowerCase()),
    );

    if (filtered.length === 0) {
      throw new Error(`No banks matching "${search as string}".`);
    }

    const bankChoice = await p.select({
      message: "Select bank",
      options: filtered.map((b, i) => ({
        value: i,
        label: b.name,
      })),
    });
    handleCancel(bankChoice);
    selectedBank = filtered[bankChoice as number];
  } else {
    const bankChoice = await p.select({
      message: "Select bank",
      options: banks.map((b, i) => ({
        value: i,
        label: b.name,
      })),
    });
    handleCancel(bankChoice);
    selectedBank = banks[bankChoice as number];
  }

  if (!selectedBank) {
    throw new Error("Invalid bank selection.");
  }

  // ── Step 7: POST /auth → get bank login URL ──────────────────
  const state = randomBytes(16).toString("hex");
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19) + "Z";

  const authSpinner = p.spinner();
  authSpinner.start("Requesting bank authorization...");

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
    authSpinner.stop("Failed");
    throw new Error("Enable Banking API did not return an authorization URL.");
  }

  authSpinner.stop("Authorization URL received.");

  // ── Step 8: Open browser → user logs in at bank ───────────────
  p.log.info(`Opening your bank's login page...\nURL: ${authResponse.url}`);
  openBrowser(authResponse.url);

  p.note(
    "After logging in, your browser will redirect to a page\n" +
    "that won't load — that's expected!\n\n" +
    "Copy the full URL from your browser's address bar and paste it below.\n" +
    "It will look like: https://localhost:13579/callback?code=...&state=...",
    "Next step",
  );

  // ── Step 9: User pastes redirect URL → extract code ───────────
  const redirectInput = await p.text({ message: "Paste the redirect URL" });
  handleCancel(redirectInput);

  const code = extractCodeFromUrl(redirectInput as string, state);

  const sessionSpinner = p.spinner();
  sessionSpinner.start("Creating session...");

  const sessionToken = generateJwt(appId, privateKeyPath);
  const sessionResponse = (await httpFetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ code }),
  })) as { session_id: string };

  const sessionId = sessionResponse.session_id;
  if (!sessionId) {
    sessionSpinner.stop("Failed");
    throw new Error("Failed to create session — no session_id returned.");
  }

  sessionSpinner.stop("Authorization received!");

  // ── Step 10: Fetch accounts (with retry for rate limits) ──────
  let accounts: EnableBankingConnectResult["config"]["accounts"] = [];
  let actualValidUntil = validUntil;

  const accSpinner = p.spinner();
  try {
    accSpinner.start("Fetching account details...");

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

    accSpinner.stop(`Found ${accounts.length} account(s) (valid until ${actualValidUntil.slice(0, 10)})`);

    for (const acc of accounts) {
      p.log.info(`  ${acc.iban} (${acc.name}, ${acc.currency})`);
    }
  } catch (err) {
    accSpinner.stop("Could not fetch account details.");

    let reason = err instanceof Error ? err.message : String(err);
    // Extract clean message from HTTP JSON errors
    const jsonMatch = reason.match(/\{.*"message"\s*:\s*"([^"]+)"/);
    if (jsonMatch) {
      reason = jsonMatch[1];
    }

    p.log.warn(`${reason}\nThe session is still valid — accounts will be fetched on first use.`);
  }

  // ── Label ─────────────────────────────────────────────────────
  const label = await p.text({
    message: "Connection label",
    placeholder: selectedBank.name,
    defaultValue: selectedBank.name,
  });
  handleCancel(label);

  return {
    provider: "enable-banking",
    label: label as string,
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
async function ensureRedirectUri(appId: string): Promise<void> {
  const dashboardUrl = `https://enablebanking.com/cp/applications/${appId}/edit`;

  p.note(
    "bank-mcp needs a redirect URI registered in your\n" +
    "Enable Banking app so the bank can send you back here.\n\n" +
    "Add this URI to your app's allowed redirect URIs:\n\n" +
    `  ${REDIRECT_URL}`,
    "Redirect URI (one-time setup)",
  );

  const action = await p.confirm({
    message: "Already done? (No = open dashboard to add it now)",
    initialValue: true,
  });
  handleCancel(action);

  if (!action) {
    p.log.info(`Opening: ${dashboardUrl}`);
    openBrowser(dashboardUrl);

    p.log.info(
      "Steps:\n" +
      "  1. Find your app in the dashboard\n" +
      `  2. Add redirect URI:  ${REDIRECT_URL}\n` +
      "  3. Save changes",
    );

    const done = await p.confirm({ message: "Done?", initialValue: true });
    handleCancel(done);
  }
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
      p.log.warn(`Rate limited by bank — waiting ${delaySec}s before retry...`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  throw new Error("Unexpected: retry loop exited without return or throw");
}
