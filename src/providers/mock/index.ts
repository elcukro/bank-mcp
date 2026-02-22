import { BankProvider } from "../base.js";
import type {
  BankAccount,
  Transaction,
  Balance,
  TransactionFilter,
  ConfigField,
} from "../../types.js";

/**
 * Mock provider with deterministic fake data.
 * Used for demos, testing, and development without real bank credentials.
 *
 * Generates realistic US checking/savings account data including:
 * - Monthly bills (rent, insurance, utilities, subscriptions)
 * - Variable spending (groceries, dining, gas, shopping)
 * - Bi-monthly salary + side income
 *
 * Run with: npx @bank-mcp/server --mock
 */
export class MockProvider extends BankProvider {
  readonly name = "mock";
  readonly displayName = "Mock Bank (Demo Data)";

  validateConfig(): void {
    // No config needed
  }

  getConfigSchema(): ConfigField[] {
    return [];
  }

  async listAccounts(): Promise<BankAccount[]> {
    return [
      {
        uid: "mock-checking-001",
        iban: "****4832",
        name: "Chase Total Checking",
        currency: "USD",
        connectionId: "",
      },
      {
        uid: "mock-savings-001",
        iban: "****7291",
        name: "Chase Savings",
        currency: "USD",
        connectionId: "",
      },
    ];
  }

  async listTransactions(
    _config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    let txs =
      accountId === "mock-savings-001"
        ? generateSavingsTransactions(accountId)
        : generateCheckingTransactions(accountId);

    if (filter?.dateFrom) {
      txs = txs.filter((t) => t.date >= filter.dateFrom!);
    }
    if (filter?.dateTo) {
      txs = txs.filter((t) => t.date <= filter.dateTo!);
    }
    if (filter?.amountMin !== undefined) {
      txs = txs.filter((t) => Math.abs(t.amount) >= filter.amountMin!);
    }
    if (filter?.amountMax !== undefined) {
      txs = txs.filter((t) => Math.abs(t.amount) <= filter.amountMax!);
    }
    if (filter?.type) {
      txs = txs.filter((t) => t.type === filter.type);
    }
    if (filter?.limit) {
      txs = txs.slice(0, filter.limit);
    }

    return txs;
  }

  async getBalance(
    _config: Record<string, unknown>,
    accountId: string,
  ): Promise<Balance[]> {
    const balances: Record<string, { booked: number; expected: number }> = {
      "mock-checking-001": { booked: 5284.32, expected: 5041.89 },
      "mock-savings-001": { booked: 24150.0, expected: 24150.0 },
    };

    const bal = balances[accountId] || { booked: 1000.0, expected: 1000.0 };

    return [
      {
        accountId,
        amount: bal.booked,
        currency: "USD",
        type: "closingBooked",
      },
      {
        accountId,
        amount: bal.expected,
        currency: "USD",
        type: "expected",
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tx(
  accountId: string,
  id: string,
  date: string,
  amount: number,
  description: string,
  merchant: string,
  category: string,
  type: "debit" | "credit" = "debit",
  reference?: string,
): Transaction {
  return {
    id,
    accountId,
    date,
    amount: type === "debit" ? -Math.abs(amount) : Math.abs(amount),
    currency: "USD",
    description,
    merchantName: merchant,
    category,
    type,
    ...(reference ? { reference } : {}),
  };
}

/** Simple deterministic pseudo-random from a seed (mulberry32). */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to 2 decimal places. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Checking account — realistic US spending patterns
// ---------------------------------------------------------------------------

function generateCheckingTransactions(accountId: string): Transaction[] {
  const today = new Date();
  const txs: Transaction[] = [];
  let seq = 0;
  const nextId = () => `mock-tx-${accountId}-${++seq}`;

  for (let day = 0; day < 90; day++) {
    const date = new Date(today);
    date.setDate(date.getDate() - day);
    const ds = date.toISOString().slice(0, 10);
    const dom = date.getDate();
    const dow = date.getDay(); // 0=Sun
    const rand = seededRandom(day * 1000 + dom * 100 + dow);

    // ── Income ──────────────────────────────────────────────
    if (dom === 1) {
      txs.push(
        tx(accountId, nextId(), ds, 4250.0, "TechFlow Inc - Payroll", "TechFlow Inc", "salary", "credit", "DD-PAY-01"),
      );
    }
    if (dom === 15) {
      txs.push(
        tx(accountId, nextId(), ds, 4250.0, "TechFlow Inc - Payroll", "TechFlow Inc", "salary", "credit", "DD-PAY-15"),
      );
    }
    if (dom === 28) {
      txs.push(
        tx(accountId, nextId(), ds, 850.0, "Stripe Transfer - Consulting", "Stripe", "freelance", "credit"),
      );
    }

    // ── Monthly bills ───────────────────────────────────────
    if (dom === 1) {
      txs.push(
        tx(accountId, nextId(), ds, 2100.0, "Zelle - Parkview Apartments", "Parkview Apartments", "housing"),
      );
      txs.push(
        tx(accountId, nextId(), ds, 148.5, "GEICO Auto Insurance", "GEICO", "insurance"),
      );
    }
    if (dom === 3) {
      txs.push(
        tx(accountId, nextId(), ds, 85.0, "Verizon Wireless", "Verizon", "utilities"),
      );
    }
    if (dom === 5) {
      txs.push(
        tx(accountId, nextId(), ds, 15.49, "Netflix", "Netflix", "entertainment"),
      );
    }
    if (dom === 12) {
      txs.push(
        tx(accountId, nextId(), ds, 11.99, "Spotify Premium", "Spotify", "entertainment"),
      );
    }
    if (dom === 15) {
      txs.push(
        tx(accountId, nextId(), ds, 134.82, "Con Edison - Electric", "Con Edison", "utilities"),
      );
    }
    if (dom === 20) {
      txs.push(
        tx(accountId, nextId(), ds, 24.99, "Planet Fitness", "Planet Fitness", "healthcare"),
      );
    }

    // ── Groceries (3x/week: Mon, Wed, Sat) ──────────────────
    if (dow === 1 || dow === 3 || dow === 6) {
      const merchants = [
        { name: "Trader Joe's", min: 42, max: 95 },
        { name: "Whole Foods Market", min: 55, max: 185 },
        { name: "Walmart Supercenter", min: 35, max: 120 },
      ];
      const m = merchants[dow % 3];
      const amount = r2(m.min + rand() * (m.max - m.min));
      txs.push(
        tx(accountId, nextId(), ds, amount, m.name, m.name, "food"),
      );
    }

    // ── Coffee (weekday mornings, ~4x/week) ─────────────────
    if (dow >= 1 && dow <= 5 && rand() > 0.25) {
      const amount = r2(5.25 + rand() * 2.7); // $5.25–$7.95
      txs.push(
        tx(accountId, nextId(), ds, amount, "Starbucks", "Starbucks", "food"),
      );
    }

    // ── Dining out (2–3x/week) ──────────────────────────────
    if ((dow === 2 || dow === 5 || dow === 0) && rand() > 0.2) {
      const places = [
        { name: "Chipotle Mexican Grill", min: 11.5, max: 18 },
        { name: "DoorDash", min: 22, max: 45 },
        { name: "Shake Shack", min: 14, max: 26 },
      ];
      const p = places[day % 3];
      const amount = r2(p.min + rand() * (p.max - p.min));
      txs.push(
        tx(accountId, nextId(), ds, amount, p.name, p.name, "food"),
      );
    }

    // ── Gas (weekly, Saturdays) ─────────────────────────────
    if (dow === 6) {
      const station = day % 14 < 7 ? "Shell" : "Chevron";
      const amount = r2(45 + rand() * 20); // $45–$65
      txs.push(
        tx(accountId, nextId(), ds, amount, station, station, "transportation"),
      );
    }

    // ── Amazon (2–3x/month) ─────────────────────────────────
    if (dom === 8 || dom === 19 || dom === 27) {
      const amount = r2(15 + rand() * 185); // $15–$200
      txs.push(
        tx(accountId, nextId(), ds, amount, "Amazon.com", "Amazon", "shopping"),
      );
    }

    // ── Target (every ~2 weeks) ─────────────────────────────
    if (dom === 7 || dom === 22) {
      const amount = r2(30 + rand() * 90); // $30–$120
      txs.push(
        tx(accountId, nextId(), ds, amount, "Target", "Target", "shopping"),
      );
    }

    // ── Uber (2–3x/month) ──────────────────────────────────
    if (dom === 4 || dom === 14 || dom === 25) {
      const amount = r2(12 + rand() * 23); // $12–$35
      txs.push(
        tx(accountId, nextId(), ds, amount, "Uber", "Uber", "transportation"),
      );
    }
  }

  txs.sort((a, b) => b.date.localeCompare(a.date));
  return txs;
}

// ---------------------------------------------------------------------------
// Savings account — minimal activity
// ---------------------------------------------------------------------------

function generateSavingsTransactions(accountId: string): Transaction[] {
  const today = new Date();
  const txs: Transaction[] = [];
  let seq = 0;
  const nextId = () => `mock-tx-${accountId}-${++seq}`;

  for (let day = 0; day < 90; day++) {
    const date = new Date(today);
    date.setDate(date.getDate() - day);
    const ds = date.toISOString().slice(0, 10);
    const dom = date.getDate();

    // Monthly interest credit
    if (dom === 1) {
      txs.push(
        tx(accountId, nextId(), ds, 12.08, "Interest Payment - APY 0.60%", "Chase Bank", "investments", "credit"),
      );
    }

    // Monthly transfer from checking
    if (dom === 2) {
      txs.push(
        tx(accountId, nextId(), ds, 500.0, "Transfer from Checking ****4832", "Chase Bank", "other", "credit"),
      );
    }
  }

  txs.sort((a, b) => b.date.localeCompare(a.date));
  return txs;
}
