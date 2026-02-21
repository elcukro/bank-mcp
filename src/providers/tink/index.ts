import { BankProvider } from "../base.js";
import { httpFetch } from "../../utils/http.js";
import type {
  BankAccount,
  Transaction,
  Balance,
  TransactionFilter,
  ConfigField,
} from "../../types.js";

const BASE_URL = "https://api.tink.com";

interface TinkConfig {
  accessToken: string;
}

function parseConfig(raw: Record<string, unknown>): TinkConfig {
  const accessToken = raw.accessToken as string;
  if (!accessToken) {
    throw new Error("Tink config requires: accessToken");
  }
  return { accessToken };
}

/**
 * GET request to Tink API with Bearer token auth.
 */
async function tinkGet(
  config: TinkConfig,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  return httpFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
    timeoutMs: 30000,
    retries: 2,
  });
}

/**
 * Parse Tink's fixed-point decimal amount.
 *
 * Tink represents amounts as { unscaledValue, scale } where
 * actual = unscaledValue * 10^(-scale).
 *
 * Example: { unscaledValue: "15099", scale: 2 } → 150.99
 */
function parseAmount(amount: TinkAmount): number {
  const unscaled = parseFloat(amount.unscaledValue);
  return unscaled * Math.pow(10, -(amount.scale ?? 0));
}

export class TinkProvider extends BankProvider {
  readonly name = "tink";
  readonly displayName = "Tink (EU Open Banking)";

  validateConfig(config: Record<string, unknown>): void {
    parseConfig(config);
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        name: "accessToken",
        label: "Access token (from Tink Console)",
        type: "string",
        required: true,
        secret: true,
      },
    ];
  }

  async listAccounts(
    config: Record<string, unknown>,
  ): Promise<BankAccount[]> {
    const tc = parseConfig(config);

    const data = (await tinkGet(tc, "/data/v2/accounts")) as TinkAccountsResponse;

    return data.accounts.map((a) => ({
      uid: a.id,
      iban: a.identifiers?.iban?.iban || a.id,
      name: a.name,
      currency: a.balances?.booked?.amount?.currencyCode || "EUR",
      connectionId: "",
    }));
  }

  async listTransactions(
    config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    const tc = parseConfig(config);

    const allTx: Transaction[] = [];
    let pageToken: string | undefined;

    // nextPageToken cursor pagination
    do {
      const params: Record<string, string> = {
        accountIdIn: accountId,
        pageSize: "100",
      };
      if (filter?.dateFrom) params.bookedDateGte = filter.dateFrom;
      if (filter?.dateTo) params.bookedDateLte = filter.dateTo;
      if (pageToken) params.pageToken = pageToken;

      const data = (await tinkGet(
        tc,
        "/data/v2/transactions",
        params,
      )) as TinkTransactionsResponse;

      for (const raw of data.transactions) {
        allTx.push(normalizeTransaction(raw));
      }

      pageToken = data.nextPageToken || undefined;
    } while (pageToken);

    // Apply local filters
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
    const tc = parseConfig(config);

    const data = (await tinkGet(
      tc,
      `/data/v2/accounts/${accountId}/balances`,
    )) as TinkBalancesResponse;

    const balances: Balance[] = [];

    if (data.balances?.bookedBalance) {
      const amt = data.balances.bookedBalance.amount;
      balances.push({
        accountId,
        amount: parseAmount(amt),
        currency: amt.currencyCode,
        type: "booked",
      });
    }
    if (data.balances?.availableBalance) {
      const amt = data.balances.availableBalance.amount;
      balances.push({
        accountId,
        amount: parseAmount(amt),
        currency: amt.currencyCode,
        type: "available",
      });
    }

    return balances;
  }
}

// --- Raw Tink API types ---

interface TinkAmount {
  unscaledValue: string;
  scale: number;
  currencyCode: string;
}

interface TinkAccountsResponse {
  accounts: TinkAccount[];
  nextPageToken?: string;
}

interface TinkAccount {
  id: string;
  name: string;
  type: string; // "CHECKING", "SAVINGS", "CREDIT_CARD", etc.
  identifiers?: {
    iban?: { iban: string };
    sortCode?: { accountNumber: string; code: string };
  };
  balances?: {
    booked?: { amount: TinkAmount };
    available?: { amount: TinkAmount };
  };
}

interface TinkTransactionsResponse {
  transactions: TinkTransaction[];
  nextPageToken?: string;
}

interface TinkTransaction {
  id: string;
  accountId: string;
  amount: TinkAmount;
  dates: {
    booked: string; // "2026-02-20"
    value?: string;
  };
  descriptions: {
    display: string;
    original?: string;
    detailed?: { unstructured?: string };
  };
  status: string; // "BOOKED", "PENDING"
  types?: {
    type: string; // "DEBIT", "CREDIT"
  };
  merchantInformation?: {
    merchantName?: string;
    merchantCategoryCode?: string;
  };
  categories?: {
    pfm?: {
      id: string;
      name: string;
    };
  };
  reference?: string;
}

interface TinkBalancesResponse {
  balances: {
    bookedBalance?: { amount: TinkAmount };
    availableBalance?: { amount: TinkAmount };
  };
}

/**
 * Normalize a Tink transaction to our standard format.
 *
 * Amount: Tink uses fixed-point { unscaledValue, scale }.
 * Sign: Tink amounts are always positive; the `types.type` field
 * indicates DEBIT (money out) vs CREDIT (money in).
 * We negate DEBIT amounts to match our convention (negative = expense).
 *
 * Descriptions: Tink provides three levels:
 *   display (cleanest) > original (raw) > detailed.unstructured
 */
function normalizeTransaction(raw: TinkTransaction): Transaction {
  const absAmount = parseAmount(raw.amount);
  const isDebit = raw.types?.type === "DEBIT";
  const amount = isDebit ? -absAmount : absAmount;

  const merchantName = raw.merchantInformation?.merchantName || undefined;
  const category = raw.categories?.pfm?.name || undefined;

  // Best description: display > original > detailed
  const description =
    raw.descriptions.display ||
    raw.descriptions.original ||
    raw.descriptions.detailed?.unstructured ||
    "Unknown";

  return {
    id: raw.id,
    accountId: raw.accountId,
    date: raw.dates.booked,
    amount,
    currency: raw.amount.currencyCode,
    description: merchantName || description,
    merchantName,
    category,
    type: isDebit ? "debit" : "credit",
    reference: raw.reference || description,
    rawData: raw as unknown as Record<string, unknown>,
  };
}
