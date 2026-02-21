import { z } from "zod";
import { loadConfig, getConnection, getAllConnections } from "../config.js";
import { getProvider } from "../providers/registry.js";
import { cache, TTL } from "../utils/cache.js";
import type { Transaction, TransactionFilter } from "../types.js";

export const listTransactionsSchema = z.object({
  connectionId: z
    .string()
    .optional()
    .describe("Connection ID. If omitted, queries all connections."),
  accountId: z
    .string()
    .optional()
    .describe("Account UID. If omitted, queries all accounts."),
  dateFrom: z
    .string()
    .optional()
    .describe('Start date (YYYY-MM-DD). Defaults to 90 days ago.'),
  dateTo: z
    .string()
    .optional()
    .describe('End date (YYYY-MM-DD). Defaults to today.'),
  amountMin: z
    .number()
    .optional()
    .describe("Minimum absolute amount."),
  amountMax: z
    .number()
    .optional()
    .describe("Maximum absolute amount."),
  type: z
    .enum(["debit", "credit"])
    .optional()
    .describe("Filter by transaction type."),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of transactions to return."),
});

export async function listTransactions(
  args: z.infer<typeof listTransactionsSchema>,
): Promise<Transaction[]> {
  const config = loadConfig();
  const dateFrom = args.dateFrom || defaultDateFrom(config.defaults.transactionDays);
  const dateTo = args.dateTo || today();

  const filter: TransactionFilter = {
    dateFrom,
    dateTo,
    amountMin: args.amountMin,
    amountMax: args.amountMax,
    type: args.type,
    limit: args.limit,
  };

  // Resolve which connections and accounts to query
  const connections = args.connectionId
    ? [getConnection(config, args.connectionId)]
    : getAllConnections(config);

  const allTx: Transaction[] = [];

  for (const conn of connections) {
    const provider = getProvider(conn.provider);

    // Get account list (may come from cache)
    let accountIds: string[];
    if (args.accountId) {
      accountIds = [args.accountId];
    } else {
      const accounts = await provider.listAccounts(conn.config);
      accountIds = accounts.map((a) => a.uid);
    }

    for (const accId of accountIds) {
      const cacheKey = `tx:${conn.id}:${accId}:${dateFrom}:${dateTo}`;
      const cached = cache.get<Transaction[]>(cacheKey);

      if (cached) {
        allTx.push(...applyLocalFilters(cached, filter));
        continue;
      }

      const transactions = await provider.listTransactions(
        conn.config,
        accId,
        { dateFrom, dateTo },
      );
      cache.set(cacheKey, transactions, TTL.TRANSACTIONS);
      allTx.push(...applyLocalFilters(transactions, filter));
    }
  }

  // Sort by date descending (most recent first)
  allTx.sort((a, b) => b.date.localeCompare(a.date));

  return args.limit ? allTx.slice(0, args.limit) : allTx;
}

function applyLocalFilters(
  txs: Transaction[],
  f: TransactionFilter,
): Transaction[] {
  let result = txs;
  if (f.amountMin !== undefined) {
    result = result.filter((t) => Math.abs(t.amount) >= f.amountMin!);
  }
  if (f.amountMax !== undefined) {
    result = result.filter((t) => Math.abs(t.amount) <= f.amountMax!);
  }
  if (f.type) {
    result = result.filter((t) => t.type === f.type);
  }
  return result;
}

function defaultDateFrom(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
