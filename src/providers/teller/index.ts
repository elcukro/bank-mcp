import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { request as httpsRequest, Agent } from "node:https";
import { BankProvider } from "../base.js";
import type {
  BankAccount,
  Transaction,
  Balance,
  TransactionFilter,
  ConfigField,
} from "../../types.js";

const API_BASE = "https://api.teller.io";

interface TellerConfig {
  certificatePath?: string;
  privateKeyPath?: string;
  accessToken: string;
}

function parseConfig(raw: Record<string, unknown>): TellerConfig {
  const certificatePath = (raw.certificatePath as string) || undefined;
  const privateKeyPath = (raw.privateKeyPath as string) || undefined;
  const accessToken = raw.accessToken as string;
  if (!accessToken) {
    throw new Error("Teller config requires: accessToken");
  }
  return { certificatePath, privateKeyPath, accessToken };
}

function expandPath(p: string): string {
  return resolve(p.replace(/^~/, process.env.HOME || ""));
}

/**
 * Create an HTTPS agent with mutual TLS client certificate.
 *
 * Teller requires mTLS for development/production — the app proves its
 * identity at the TLS layer, then user enrollment is authenticated
 * via HTTP Basic Auth (token:empty_password).
 *
 * In sandbox mode, mTLS is not required — returns undefined so
 * tellerFetch uses the default HTTPS agent (no client cert).
 */
function createAgent(config: TellerConfig): Agent | undefined {
  if (!config.certificatePath || !config.privateKeyPath) return undefined;
  return new Agent({
    cert: readFileSync(expandPath(config.certificatePath)),
    key: readFileSync(expandPath(config.privateKeyPath)),
  });
}

/**
 * Make an HTTPS request with mTLS client certificate.
 *
 * Uses node:https directly because Node's global fetch doesn't
 * reliably support passing an https.Agent for mTLS across all
 * Node versions. This is the battle-tested approach.
 */
async function tellerFetch(
  url: string,
  config: TellerConfig,
  agent: Agent | undefined,
): Promise<unknown> {
  const auth = Buffer.from(`${config.accessToken}:`).toString("base64");

  const opts: Parameters<typeof httpsRequest>[1] = {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  };
  if (agent) opts.agent = agent;

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      opts,
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `Teller API ${res.statusCode} ${res.statusMessage}: ${body.slice(0, 200)}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Teller API: invalid JSON response: ${body.slice(0, 200)}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Teller API request timed out (30s)"));
    });
    req.end();
  });
}

export class TellerProvider extends BankProvider {
  readonly name = "teller";
  readonly displayName = "Teller (US Banks)";

  validateConfig(config: Record<string, unknown>): void {
    parseConfig(config);
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        name: "certificatePath",
        label: "Path to client certificate (.pem) — optional for sandbox",
        type: "path",
        required: false,
      },
      {
        name: "privateKeyPath",
        label: "Path to private key (.pem) — optional for sandbox",
        type: "path",
        required: false,
      },
      {
        name: "accessToken",
        label: "Access token (from Teller Connect enrollment)",
        type: "string",
        required: true,
        secret: true,
      },
    ];
  }

  async listAccounts(config: Record<string, unknown>): Promise<BankAccount[]> {
    const tc = parseConfig(config);
    const agent = createAgent(tc);

    const accounts = (await tellerFetch(
      `${API_BASE}/accounts`,
      tc,
      agent,
    )) as TellerAccount[];

    return accounts
      .filter((a) => a.status === "open")
      .map((a) => ({
        uid: a.id,
        iban: a.last_four ? `****${a.last_four}` : a.id,
        name: a.name,
        currency: a.currency || "USD",
        connectionId: "",
      }));
  }

  async listTransactions(
    config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    const tc = parseConfig(config);
    const agent = createAgent(tc);

    // Fetch account to get currency (Teller transactions don't include it)
    const accounts = (await tellerFetch(
      `${API_BASE}/accounts`,
      tc,
      agent,
    )) as TellerAccount[];
    const account = accounts.find((a) => a.id === accountId);
    const currency = account?.currency || "USD";

    // Teller uses cursor pagination with from_id + count
    const allTx: Transaction[] = [];
    let fromId: string | undefined;
    const pageSize = 250;

    do {
      const params = new URLSearchParams();
      params.set("count", String(pageSize));
      if (fromId) params.set("from_id", fromId);

      const url = `${API_BASE}/accounts/${accountId}/transactions?${params}`;
      const page = (await tellerFetch(url, tc, agent)) as TellerTransaction[];

      if (page.length === 0) break;

      for (const raw of page) {
        const tx = normalizeTransaction(raw, currency);

        // Apply date filter (Teller doesn't support server-side date filtering)
        if (filter?.dateFrom && tx.date < filter.dateFrom) continue;
        if (filter?.dateTo && tx.date > filter.dateTo) continue;

        allTx.push(tx);
      }

      // If we got a full page, there may be more
      if (page.length < pageSize) break;
      fromId = page[page.length - 1].id;

      // Safety: if we've passed the dateFrom window, stop paginating
      if (filter?.dateFrom) {
        const lastDate = page[page.length - 1].date;
        if (lastDate < filter.dateFrom) break;
      }
    } while (true);

    // Apply remaining local filters
    let filtered = allTx;
    if (filter?.amountMin !== undefined) {
      filtered = filtered.filter((t) => Math.abs(t.amount) >= filter.amountMin!);
    }
    if (filter?.amountMax !== undefined) {
      filtered = filtered.filter((t) => Math.abs(t.amount) <= filter.amountMax!);
    }
    if (filter?.type) {
      filtered = filtered.filter((t) => t.type === filter.type);
    }
    if (filter?.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  async getBalance(
    config: Record<string, unknown>,
    accountId: string,
  ): Promise<Balance[]> {
    const tc = parseConfig(config);
    const agent = createAgent(tc);

    // Fetch account to get currency (balance endpoint doesn't include it)
    const accounts = (await tellerFetch(
      `${API_BASE}/accounts`,
      tc,
      agent,
    )) as TellerAccount[];
    const account = accounts.find((a) => a.id === accountId);
    const currency = account?.currency || "USD";

    const bal = (await tellerFetch(
      `${API_BASE}/accounts/${accountId}/balances`,
      tc,
      agent,
    )) as TellerBalance;

    const balances: Balance[] = [];

    if (bal.ledger !== null) {
      balances.push({
        accountId,
        amount: parseFloat(bal.ledger),
        currency,
        type: "ledger",
      });
    }

    if (bal.available !== null) {
      balances.push({
        accountId,
        amount: parseFloat(bal.available),
        currency,
        type: "available",
      });
    }

    return balances;
  }
}

// --- Raw Teller API types ---

interface TellerAccount {
  id: string;
  name: string;
  type: string;
  subtype: string;
  currency: string;
  enrollment_id: string;
  institution: { id: string; name: string };
  last_four: string;
  status: string;
  links: Record<string, string>;
}

interface TellerTransaction {
  id: string;
  account_id: string;
  date: string;
  amount: string; // Pre-signed: "-86.46"
  description: string;
  type: string; // "card_payment", "transfer", etc.
  status: string; // "posted" | "pending"
  running_balance: string | null;
  details: {
    processing_status: string;
    category: string | null;
    counterparty: {
      name: string | null;
      type: string | null;
    };
  };
}

interface TellerBalance {
  account_id: string;
  ledger: string | null;
  available: string | null;
}

/**
 * Normalize a Teller transaction.
 *
 * Teller's amounts are pre-signed strings ("-86.46" for debits).
 * Categories are flat (~28 values). Counterparty is already extracted.
 */
function normalizeTransaction(raw: TellerTransaction, currency: string): Transaction {
  const amount = parseFloat(raw.amount);
  const isDebit = amount < 0;
  const merchantName = raw.details?.counterparty?.name || undefined;

  return {
    id: raw.id,
    accountId: raw.account_id,
    date: raw.date,
    amount,
    currency,
    description: merchantName || raw.description,
    merchantName,
    category: raw.details?.category || undefined,
    type: isDebit ? "debit" : "credit",
    reference: raw.description,
    rawData: raw as unknown as Record<string, unknown>,
  };
}
