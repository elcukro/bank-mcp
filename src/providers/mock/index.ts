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
        iban: "PL61109010140000071219812874",
        name: "Konto Direct",
        currency: "PLN",
        connectionId: "",
      },
      {
        uid: "mock-savings-001",
        iban: "PL72109010140000071219812999",
        name: "Konto Oszczednosciowe",
        currency: "PLN",
        connectionId: "",
      },
    ];
  }

  async listTransactions(
    _config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    let txs = generateMockTransactions(accountId);

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
    const amounts: Record<string, number> = {
      "mock-checking-001": 12450.67,
      "mock-savings-001": 45000.0,
    };

    return [
      {
        accountId,
        amount: amounts[accountId] || 1000.0,
        currency: "PLN",
        type: "closingBooked",
      },
      {
        accountId,
        amount: (amounts[accountId] || 1000.0) + 250.0,
        currency: "PLN",
        type: "expected",
      },
    ];
  }
}

function generateMockTransactions(accountId: string): Transaction[] {
  const today = new Date();
  const txs: Transaction[] = [];

  const merchants = [
    { name: "Biedronka", min: 30, max: 180 },
    { name: "Lidl", min: 40, max: 200 },
    { name: "Żabka", min: 5, max: 45 },
    { name: "Orlen", min: 150, max: 350 },
    { name: "Allegro", min: 20, max: 500 },
    { name: "Netflix", min: 43, max: 43 },
    { name: "Spotify", min: 29.99, max: 29.99 },
    { name: "PZU Ubezpieczenie", min: 180, max: 180 },
    { name: "Orange Polska", min: 79, max: 79 },
    { name: "Inea Internet", min: 69, max: 69 },
  ];

  const incomes = [
    { name: "TechCorp Sp. z o.o.", amount: 12500, desc: "Wynagrodzenie" },
    { name: "Freelance Client", amount: 3500, desc: "Faktura 2026/02" },
  ];

  // Generate 90 days of transactions (deterministic via simple seed)
  for (let day = 0; day < 90; day++) {
    const date = new Date(today);
    date.setDate(date.getDate() - day);
    const dateStr = date.toISOString().slice(0, 10);

    // 1-3 expenses per day
    const txCount = (day % 3) + 1;
    for (let i = 0; i < txCount; i++) {
      const merchant = merchants[(day * 3 + i) % merchants.length];
      const amount =
        merchant.min === merchant.max
          ? merchant.min
          : merchant.min +
            ((day * 7 + i * 13) % (merchant.max - merchant.min));

      txs.push({
        id: `mock-tx-${accountId}-${day}-${i}`,
        accountId,
        date: dateStr,
        amount: -Math.round(amount * 100) / 100,
        currency: "PLN",
        description: merchant.name,
        merchantName: merchant.name,
        type: "debit",
      });
    }

    // Salary on the 10th, freelance on the 25th
    if (date.getDate() === 10) {
      txs.push({
        id: `mock-tx-${accountId}-salary-${dateStr}`,
        accountId,
        date: dateStr,
        amount: incomes[0].amount,
        currency: "PLN",
        description: incomes[0].desc,
        merchantName: incomes[0].name,
        type: "credit",
      });
    }
    if (date.getDate() === 25) {
      txs.push({
        id: `mock-tx-${accountId}-freelance-${dateStr}`,
        accountId,
        date: dateStr,
        amount: incomes[1].amount,
        currency: "PLN",
        description: incomes[1].desc,
        merchantName: incomes[1].name,
        type: "credit",
      });
    }
  }

  // Sort by date descending
  txs.sort((a, b) => b.date.localeCompare(a.date));
  return txs;
}
