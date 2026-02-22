/**
 * bank-mcp refresh — re-fetch account details for existing connections.
 *
 * Non-interactive: reads config, calls the provider APIs, updates accounts.
 * Useful when:
 *   - Initial connect was rate-limited and some accounts are missing
 *   - Account details changed (name, currency)
 *   - Verifying a session is still valid
 */

import { loadConfig, saveConfig, expandPaths } from "./config.js";
import { generateJwt } from "./providers/enable-banking/auth.js";
import { httpFetch, type FetchOptions } from "./utils/http.js";
import type { ConnectionConfig } from "./types.js";

const API_BASE = "https://api.enablebanking.com";

export async function runRefresh(): Promise<void> {
  const config = loadConfig();

  if (config.connections.length === 0) {
    console.error("No connections configured. Run: bank-mcp connect");
    process.exit(1);
  }

  console.log(`\nRefreshing ${config.connections.length} connection(s)...\n`);

  let updated = false;

  for (const conn of config.connections) {
    try {
      const changed = await refreshConnection(conn);
      if (changed) updated = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${conn.id}] Failed: ${msg}\n`);
    }
  }

  if (updated) {
    saveConfig(config);
    console.log("\nConfig updated.");
  } else {
    console.log("\nNo changes needed.");
  }
}

async function refreshConnection(conn: ConnectionConfig): Promise<boolean> {
  if (conn.provider === "tink") {
    return refreshTink(conn);
  }

  if (conn.provider !== "enable-banking") {
    console.log(`  [${conn.id}] Skipping (provider "${conn.provider}" — refresh not supported)`);
    return false;
  }

  console.log(`  [${conn.id}] ${conn.label}`);

  const expanded = expandPaths(conn.config);
  const appId = expanded.appId as string;
  const privateKeyPath = expanded.privateKeyPath as string;
  const sessionId = expanded.sessionId as string;

  if (!appId || !privateKeyPath || !sessionId) {
    throw new Error("Missing appId, privateKeyPath, or sessionId in config");
  }

  // 1. Fetch session details
  const token = generateJwt(appId, privateKeyPath);
  const session = (await fetchWithRetry(
    `${API_BASE}/sessions/${sessionId}`,
    { headers: authHeaders(token) },
  )) as { accounts: string[]; access?: { valid_until?: string } };

  if (session.access?.valid_until) {
    conn.config.validUntil = session.access.valid_until;
  }

  const oldAccounts = (conn.config.accounts as Array<{ uid: string }>) || [];
  console.log(`    Session valid until: ${(conn.config.validUntil as string || "unknown").slice(0, 10)}`);
  console.log(`    Accounts in session: ${session.accounts.length}, cached: ${oldAccounts.length}`);

  // 2. Fetch details for each account (graceful per-account errors)
  const oldMap = new Map(
    oldAccounts.map((a) => [(a as { uid: string }).uid, a]),
  );
  const accounts: Array<{ uid: string; iban: string; name: string; currency: string }> = [];

  for (const uid of session.accounts) {
    try {
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

      const account = {
        uid: details.uid || uid,
        iban: details.account_id?.iban || uid,
        name: details.details || details.product || details.name || uid,
        currency: details.currency || "EUR",
      };

      accounts.push(account);
      console.log(`    + ${account.iban} (${account.name}, ${account.currency})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Keep existing cached data for this account if available
      const cached = oldMap.get(uid) as { uid: string; iban: string; name: string; currency: string } | undefined;
      if (cached) {
        accounts.push(cached);
        console.log(`    ~ ${cached.iban} (${cached.name}) — kept cached (${msg})`);
      } else {
        // No cache — add stub so we know the account exists
        accounts.push({ uid, iban: uid, name: "(details pending)", currency: "EUR" });
        console.log(`    ? ${uid} — could not fetch details (${msg})`);
      }
    }
  }

  // 3. Check if anything changed
  const changed =
    accounts.length !== oldAccounts.length ||
    JSON.stringify(accounts) !== JSON.stringify(oldAccounts);

  // Always update accounts (even partial) — better to have stubs than nothing
  conn.config.accounts = accounts;

  if (changed) {
    console.log(`    Updated: ${oldAccounts.length} → ${accounts.length} account(s)\n`);
  } else {
    console.log(`    No changes.\n`);
  }

  return changed;
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
 */
async function fetchWithRetry(
  url: string,
  opts: FetchOptions,
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
      console.log(`    Rate limited — waiting ${delaySec}s...`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  throw new Error("Unexpected: retry loop exited without return or throw");
}

// ── Tink refresh ──────────────────────────────────────────────

const TINK_API = "https://api.tink.com";

/**
 * Refresh a Tink connection: re-generate access token and re-fetch accounts.
 * Tink tokens expire after ~2 hours, so this is essential for ongoing use.
 */
async function refreshTink(conn: ConnectionConfig): Promise<boolean> {
  console.log(`  [${conn.id}] ${conn.label}`);

  const clientId = conn.config.clientId as string;
  const clientSecret = conn.config.clientSecret as string;
  const externalUserId = conn.config.externalUserId as string;

  if (!clientId || !clientSecret || !externalUserId) {
    throw new Error("Missing clientId, clientSecret, or externalUserId — re-run: bank-mcp connect");
  }

  // Check if token is expired
  const expiresAt = conn.config.tokenExpiresAt as string;
  const isExpired = !expiresAt || new Date(expiresAt) < new Date();
  if (isExpired) {
    console.log("    Token expired — refreshing...");
  } else {
    const mins = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
    console.log(`    Token valid for ${mins} more minutes — refreshing anyway...`);
  }

  // 1. Get client token
  const clientTokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "authorization:grant",
  }).toString();

  const clientTokenResult = (await httpFetch(`${TINK_API}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: clientTokenBody,
  })) as { access_token: string };

  // 2. Create authorization grant for data scopes
  const grantResult = (await httpFetch(
    `${TINK_API}/api/v1/oauth/authorization-grant`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientTokenResult.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_user_id: externalUserId,
        scope: "accounts:read,transactions:read,balances:read",
      }),
    },
  )) as { code: string };

  // 3. Exchange for user access token
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: grantResult.code,
  }).toString();

  const tokenResult = (await httpFetch(`${TINK_API}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  })) as { access_token: string; expires_in: number };

  conn.config.accessToken = tokenResult.access_token;
  conn.config.tokenExpiresAt = new Date(
    Date.now() + (tokenResult.expires_in || 7200) * 1000,
  ).toISOString();

  console.log(`    New token expires: ${(conn.config.tokenExpiresAt as string).slice(0, 19)}`);

  // 4. Re-fetch accounts
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

  const oldAccounts = (conn.config.accounts as Array<{ uid: string }>) || [];
  conn.config.accounts = accounts;

  console.log(`    Accounts: ${accounts.length}`);
  for (const acc of accounts) {
    console.log(`    + ${acc.iban} (${acc.name}, ${acc.currency})`);
  }

  const changed =
    accounts.length !== oldAccounts.length ||
    JSON.stringify(accounts) !== JSON.stringify(oldAccounts) ||
    isExpired;

  if (changed) {
    console.log(`    Updated.\n`);
  } else {
    console.log(`    No changes.\n`);
  }

  return changed;
}
