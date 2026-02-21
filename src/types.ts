/**
 * Normalized banking types — all providers map to these.
 */

export interface BankAccount {
  uid: string;
  iban: string;
  name: string;
  currency: string;
  connectionId: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string; // "YYYY-MM-DD"
  amount: number; // Signed: negative = expense
  currency: string;
  description: string;
  merchantName?: string;
  category?: string;
  type: "debit" | "credit";
  reference?: string;
  rawData?: Record<string, unknown>;
}

export interface Balance {
  accountId: string;
  amount: number;
  currency: string;
  type: string; // "closingBooked" | "expected" | etc.
}

export interface TransactionFilter {
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  type?: "debit" | "credit";
  limit?: number;
}

export interface ConfigField {
  name: string;
  label: string;
  type: "string" | "path" | "select";
  required: boolean;
  secret?: boolean;
  options?: string[];
  default?: string;
}

export interface ConnectionConfig {
  id: string;
  provider: string;
  label: string;
  config: Record<string, unknown>;
}

export interface AppConfig {
  version: number;
  connections: ConnectionConfig[];
  defaults: {
    transactionDays: number;
    currency: string;
  };
}

export const EXPENSE_CATEGORIES = [
  "housing",
  "transportation",
  "food",
  "utilities",
  "insurance",
  "healthcare",
  "entertainment",
  "other",
] as const;

export const INCOME_CATEGORIES = [
  "salary",
  "freelance",
  "investments",
  "rental",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
