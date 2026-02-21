import { BankProvider } from "../base.js";
import { httpFetch } from "../../utils/http.js";
import type {
  BankAccount,
  Transaction,
  Balance,
  TransactionFilter,
  ConfigField,
} from "../../types.js";

const ENVIRONMENTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

interface PlaidConfig {
  clientId: string;
  secret: string;
  accessToken: string;
  environment: string;
}

function parseConfig(raw: Record<string, unknown>): PlaidConfig {
  const clientId = raw.clientId as string;
  const secret = raw.secret as string;
  const accessToken = raw.accessToken as string;
  const environment = (raw.environment as string) || "sandbox";
  if (!clientId || !secret || !accessToken) {
    throw new Error(
      "Plaid config requires: clientId, secret, accessToken",
    );
  }
  if (!ENVIRONMENTS[environment]) {
    throw new Error(
      `Invalid Plaid environment "${environment}". Use: sandbox, development, production`,
    );
  }
  return { clientId, secret, accessToken, environment };
}

/**
 * All Plaid endpoints are POST with JSON body containing credentials.
 */
async function plaidPost(
  config: PlaidConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = ENVIRONMENTS[config.environment];
  return httpFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PLAID-CLIENT-ID": config.clientId,
      "PLAID-SECRET": config.secret,
    },
    body: JSON.stringify({
      access_token: config.accessToken,
      ...body,
    }),
    timeoutMs: 30000,
    retries: 2,
  });
}

export class PlaidProvider extends BankProvider {
  readonly name = "plaid";
  readonly displayName = "Plaid (US/CA/EU)";

  validateConfig(config: Record<string, unknown>): void {
    parseConfig(config);
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        name: "clientId",
        label: "Client ID",
        type: "string",
        required: true,
      },
      {
        name: "secret",
        label: "Secret",
        type: "string",
        required: true,
        secret: true,
      },
      {
        name: "accessToken",
        label: "Access token (from Plaid Link)",
        type: "string",
        required: true,
        secret: true,
      },
      {
        name: "environment",
        label: "Environment",
        type: "select",
        required: true,
        options: ["sandbox", "development", "production"],
        default: "sandbox",
      },
    ];
  }

  async listAccounts(config: Record<string, unknown>): Promise<BankAccount[]> {
    const pc = parseConfig(config);

    const data = (await plaidPost(pc, "/accounts/get", {})) as PlaidAccountsResponse;

    return data.accounts.map((a) => ({
      uid: a.account_id,
      iban: a.mask ? `****${a.mask}` : a.account_id,
      name: a.official_name || a.name,
      currency: a.balances?.iso_currency_code || "USD",
      connectionId: "",
    }));
  }

  async listTransactions(
    config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    const pc = parseConfig(config);

    const startDate = filter?.dateFrom || defaultDateFrom(90);
    const endDate = filter?.dateTo || today();

    const allTx: Transaction[] = [];
    let offset = 0;
    const pageSize = 500;

    // Offset-based pagination — loop until we have all transactions
    do {
      const data = (await plaidPost(pc, "/transactions/get", {
        start_date: startDate,
        end_date: endDate,
        options: {
          account_ids: [accountId],
          count: pageSize,
          offset,
          include_personal_finance_category: true,
        },
      })) as PlaidTransactionsResponse;

      for (const raw of data.transactions) {
        allTx.push(normalizeTransaction(raw));
      }

      offset += data.transactions.length;
      if (offset >= data.total_transactions) break;
    } while (true);

    // Apply local filters
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
    const pc = parseConfig(config);

    const data = (await plaidPost(pc, "/accounts/balance/get", {
      options: { account_ids: [accountId] },
    })) as PlaidAccountsResponse;

    const balances: Balance[] = [];
    for (const acc of data.accounts) {
      const currency = acc.balances?.iso_currency_code || "USD";

      if (acc.balances?.current !== null && acc.balances?.current !== undefined) {
        balances.push({
          accountId: acc.account_id,
          amount: acc.balances.current,
          currency,
          type: "current",
        });
      }
      if (acc.balances?.available !== null && acc.balances?.available !== undefined) {
        balances.push({
          accountId: acc.account_id,
          amount: acc.balances.available,
          currency,
          type: "available",
        });
      }
    }

    return balances;
  }
}

// --- Raw Plaid API types ---

interface PlaidAccountsResponse {
  accounts: PlaidAccount[];
  item: Record<string, unknown>;
  request_id: string;
}

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string;
  balances: {
    available: number | null;
    current: number | null;
    iso_currency_code: string | null;
    limit: number | null;
  };
}

interface PlaidTransactionsResponse {
  accounts: PlaidAccount[];
  transactions: PlaidTransaction[];
  total_transactions: number;
  item: Record<string, unknown>;
  request_id: string;
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  name: string;
  merchant_name: string | null;
  original_description: string | null;
  pending: boolean;
  payment_channel: string;
  category: string[] | null;
  personal_finance_category: {
    primary: string;
    detailed: string;
    confidence_level: string;
  } | null;
  counterparties?: Array<{
    name: string;
    type: string;
    confidence_level: string;
  }>;
  logo_url: string | null;
  website: string | null;
}

/**
 * Normalize a Plaid transaction.
 *
 * CRITICAL: Plaid's amount sign is INVERTED from convention.
 * Positive = money leaving the account (expense).
 * Negative = money entering the account (income).
 * We flip this to match our standard (negative = expense).
 *
 * Category: We use personal_finance_category.detailed when available
 * (e.g. "FOOD_AND_DRINK_FAST_FOOD") as it's the most granular.
 * Falls back to primary (e.g. "FOOD_AND_DRINK"), then legacy category array.
 */
function normalizeTransaction(raw: PlaidTransaction): Transaction {
  // Flip sign: Plaid positive = debit (expense), we want negative = expense
  const amount = -raw.amount;
  const isDebit = amount < 0;

  // Best merchant name: merchant_name > counterparty > name
  const merchantName =
    raw.merchant_name ||
    raw.counterparties?.find((c) => c.type === "merchant")?.name ||
    undefined;

  // Best category: detailed PFC > primary PFC > legacy category
  let category: string | undefined;
  if (raw.personal_finance_category?.detailed) {
    category = raw.personal_finance_category.detailed;
  } else if (raw.personal_finance_category?.primary) {
    category = raw.personal_finance_category.primary;
  } else if (raw.category?.length) {
    category = raw.category.join(" > ");
  }

  return {
    id: raw.transaction_id,
    accountId: raw.account_id,
    date: raw.date,
    amount,
    currency: raw.iso_currency_code || "USD",
    description: merchantName || raw.name,
    merchantName,
    category,
    type: isDebit ? "debit" : "credit",
    reference: raw.original_description || raw.name,
    rawData: raw as unknown as Record<string, unknown>,
  };
}

function defaultDateFrom(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
