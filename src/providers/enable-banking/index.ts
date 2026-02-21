import { BankProvider } from "../base.js";
import { generateJwt } from "./auth.js";
import { httpFetch } from "../../utils/http.js";
import type {
  BankAccount,
  Transaction,
  Balance,
  TransactionFilter,
  ConfigField,
} from "../../types.js";

const API_BASE = "https://api.enablebanking.com";

interface EBConfig {
  appId: string;
  privateKeyPath: string;
  sessionId: string;
  validUntil?: string;
  accounts?: Array<{ uid: string; iban: string; name: string; currency: string }>;
}

function parseConfig(raw: Record<string, unknown>): EBConfig {
  const appId = raw.appId as string;
  const privateKeyPath = raw.privateKeyPath as string;
  const sessionId = raw.sessionId as string;
  if (!appId || !privateKeyPath || !sessionId) {
    throw new Error(
      "Enable Banking config requires: appId, privateKeyPath, sessionId",
    );
  }
  return {
    appId,
    privateKeyPath,
    sessionId,
    validUntil: raw.validUntil as string | undefined,
    accounts: raw.accounts as EBConfig["accounts"],
  };
}

export class EnableBankingProvider extends BankProvider {
  readonly name = "enable-banking";
  readonly displayName = "Enable Banking (PSD2)";

  validateConfig(config: Record<string, unknown>): void {
    parseConfig(config);
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        name: "appId",
        label: "App ID",
        type: "string",
        required: true,
      },
      {
        name: "privateKeyPath",
        label: "Path to RSA private key (.pem)",
        type: "path",
        required: true,
      },
      {
        name: "sessionId",
        label: "Session ID",
        type: "string",
        required: true,
      },
    ];
  }

  async listAccounts(config: Record<string, unknown>): Promise<BankAccount[]> {
    const eb = parseConfig(config);

    // If accounts are cached in config, return those
    if (eb.accounts?.length) {
      return eb.accounts.map((a) => ({
        uid: a.uid,
        iban: a.iban,
        name: a.name,
        currency: a.currency,
        connectionId: "", // filled by caller
      }));
    }

    // Otherwise fetch from API
    const token = generateJwt(eb.appId, eb.privateKeyPath);
    const data = (await httpFetch(`${API_BASE}/sessions/${eb.sessionId}`, {
      headers: authHeaders(token),
    })) as { accounts: Array<{ uid: string; iban: string; account_name?: string; currency?: string }> };

    return data.accounts.map((a) => ({
      uid: a.uid,
      iban: a.iban,
      name: a.account_name || a.iban,
      currency: a.currency || "EUR",
      connectionId: "",
    }));
  }

  async listTransactions(
    config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    const eb = parseConfig(config);
    const token = generateJwt(eb.appId, eb.privateKeyPath);
    const headers = authHeaders(token);

    const allTx: Transaction[] = [];
    let continuationKey: string | undefined;

    // Pagination loop — Enable Banking uses continuation_key cursor
    do {
      const params = new URLSearchParams();
      if (filter?.dateFrom) params.set("date_from", filter.dateFrom);
      if (filter?.dateTo) params.set("date_to", filter.dateTo);
      if (continuationKey) params.set("continuation_key", continuationKey);

      const qs = params.toString();
      const url = `${API_BASE}/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`;

      const data = (await httpFetch(url, {
        headers,
        timeoutMs: 60000,
      })) as {
        transactions: RawTransaction[];
        continuation_key?: string;
      };

      for (const raw of data.transactions) {
        allTx.push(normalizeTransaction(raw, accountId));
      }

      continuationKey = data.continuation_key;
    } while (continuationKey);

    // Apply local filters the API doesn't support natively
    let filtered = allTx;

    if (filter?.amountMin !== undefined) {
      filtered = filtered.filter(
        (t) => Math.abs(t.amount) >= filter.amountMin!,
      );
    }
    if (filter?.amountMax !== undefined) {
      filtered = filtered.filter(
        (t) => Math.abs(t.amount) <= filter.amountMax!,
      );
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
    const eb = parseConfig(config);
    const token = generateJwt(eb.appId, eb.privateKeyPath);

    const data = (await httpFetch(
      `${API_BASE}/accounts/${accountId}/balances`,
      { headers: authHeaders(token) },
    )) as {
      balances: Array<{
        balance_amount: { amount: string; currency: string };
        balance_type: string;
      }>;
    };

    return data.balances.map((b) => ({
      accountId,
      amount: parseFloat(b.balance_amount.amount),
      currency: b.balance_amount.currency,
      type: b.balance_type,
    }));
  }
}

// --- Internal helpers ---

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

interface RawTransaction {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount: { amount: string; currency: string };
  booking_date?: string;
  credit_debit_indicator?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
  remittance_information?: string[] | string;
  merchant_category_code?: string;
}

/**
 * Normalize an Enable Banking raw transaction into our standard format.
 *
 * Direction logic:
 *   DBIT → expense: merchant = creditor.name (who you paid)
 *   CRDT → income:  merchant = debtor.name (who paid you)
 *
 * Description priority: counterpart name > remittance text > "Unknown"
 */
function normalizeTransaction(
  raw: RawTransaction,
  accountId: string,
): Transaction {
  const amount = parseFloat(raw.transaction_amount.amount);
  const cdi = raw.credit_debit_indicator || "";
  const isDebit = cdi === "DBIT" || amount < 0;

  // Build remittance text (defensive: can be array or string)
  const remittance = Array.isArray(raw.remittance_information)
    ? raw.remittance_information.join(" ")
    : String(raw.remittance_information || "");

  // Counterpart name depends on direction
  const merchantName = isDebit ? raw.creditor?.name : raw.debtor?.name;
  const description = merchantName || remittance || "Unknown transaction";

  // Unique ID: entry_reference preferred, fallback to composed ID
  const id =
    raw.entry_reference ||
    `eb:${accountId}:${raw.transaction_id || Date.now()}`;

  return {
    id,
    accountId,
    date: raw.booking_date || new Date().toISOString().slice(0, 10),
    amount: isDebit ? -Math.abs(amount) : Math.abs(amount),
    currency: raw.transaction_amount.currency,
    description,
    merchantName: merchantName || undefined,
    type: isDebit ? "debit" : "credit",
    reference: remittance || undefined,
    rawData: raw as unknown as Record<string, unknown>,
  };
}
