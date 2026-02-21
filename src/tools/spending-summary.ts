import { z } from "zod";
import { listTransactions } from "./list-transactions.js";
import type { Transaction } from "../types.js";

export const spendingSummarySchema = z.object({
  connectionId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  groupBy: z
    .enum(["merchant", "category"])
    .optional()
    .describe('Group expenses by "merchant" (default) or "category".'),
  limit: z
    .number()
    .optional()
    .describe("Max groups to return (default 20, sorted by total spent)."),
});

interface SpendingGroup {
  name: string;
  totalSpent: number;
  transactionCount: number;
  currency: string;
}

export async function spendingSummary(
  args: z.infer<typeof spendingSummarySchema>,
): Promise<{ groups: SpendingGroup[]; totalSpent: number; currency: string; period: string }> {
  const transactions = await listTransactions({
    connectionId: args.connectionId,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    type: "debit",
  });

  const groupBy = args.groupBy || "merchant";
  const limit = args.limit || 20;

  // Group expenses
  const groups = new Map<string, { total: number; count: number; currency: string }>();

  for (const tx of transactions) {
    const key =
      groupBy === "merchant"
        ? tx.merchantName || tx.description || "Unknown"
        : tx.category || "uncategorized";

    const existing = groups.get(key) || { total: 0, count: 0, currency: tx.currency };
    existing.total += Math.abs(tx.amount);
    existing.count += 1;
    groups.set(key, existing);
  }

  // Sort by total spent descending
  const sorted = [...groups.entries()]
    .map(([name, data]) => ({
      name,
      totalSpent: Math.round(data.total * 100) / 100,
      transactionCount: data.count,
      currency: data.currency,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);

  const totalSpent =
    Math.round(transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0) * 100) / 100;

  const currency = transactions[0]?.currency || "PLN";
  const dateFrom = args.dateFrom || defaultDateFrom(90);
  const dateTo = args.dateTo || today();

  return {
    groups: sorted,
    totalSpent,
    currency,
    period: `${dateFrom} to ${dateTo}`,
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
