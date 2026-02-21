import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlaidProvider } from "../../../src/providers/plaid/index.js";

// Mock the HTTP layer
vi.mock("../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

import { httpFetch } from "../../../src/utils/http.js";

const mockedFetch = vi.mocked(httpFetch);

// Fixtures
import accountsFixture from "../../fixtures/plaid/accounts.json";
import transactionsFixture from "../../fixtures/plaid/transactions.json";

const TEST_CONFIG = {
  clientId: "plaid_client_test",
  secret: "plaid_secret_test",
  accessToken: "access-sandbox-test123",
  environment: "sandbox",
};

describe("PlaidProvider", () => {
  const provider = new PlaidProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateConfig", () => {
    it("accepts valid config", () => {
      expect(() => provider.validateConfig(TEST_CONFIG)).not.toThrow();
    });

    it("defaults to sandbox environment", () => {
      expect(() =>
        provider.validateConfig({
          clientId: "c",
          secret: "s",
          accessToken: "a",
        }),
      ).not.toThrow();
    });

    it("rejects missing clientId", () => {
      expect(() =>
        provider.validateConfig({ secret: "s", accessToken: "a" }),
      ).toThrow("clientId");
    });

    it("rejects invalid environment", () => {
      expect(() =>
        provider.validateConfig({
          ...TEST_CONFIG,
          environment: "staging",
        }),
      ).toThrow("staging");
    });
  });

  describe("listAccounts", () => {
    it("returns all accounts with correct fields", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      const accounts = await provider.listAccounts(TEST_CONFIG);

      expect(accounts).toHaveLength(3);
      expect(accounts[0].uid).toBe("plaid_acc_checking");
      expect(accounts[0].name).toBe("Gold Standard 0% Interest Checking");
      expect(accounts[0].iban).toBe("****1234");
      expect(accounts[0].currency).toBe("USD");
    });

    it("prefers official_name over name", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      const accounts = await provider.listAccounts(TEST_CONFIG);

      // First account has official_name
      expect(accounts[0].name).toBe("Gold Standard 0% Interest Checking");
      // Third account has null official_name — falls back to name
      expect(accounts[2].name).toBe("Plaid Credit Card");
    });

    it("posts to sandbox URL with correct auth headers", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      await provider.listAccounts(TEST_CONFIG);

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://sandbox.plaid.com/accounts/get",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "PLAID-CLIENT-ID": "plaid_client_test",
            "PLAID-SECRET": "plaid_secret_test",
          }),
        }),
      );
    });
  });

  describe("listTransactions", () => {
    it("flips Plaid amount signs (positive → negative for debits)", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
      );

      // Burger King: Plaid amount=28.34 (positive = money out) → our amount=-28.34
      const bk = txs.find((t) => t.id === "plaid_tx_001");
      expect(bk).toBeDefined();
      expect(bk!.amount).toBe(-28.34);
      expect(bk!.type).toBe("debit");
    });

    it("flips income correctly (negative → positive)", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
      );

      // Payroll: Plaid amount=-3500 (negative = money in) → our amount=3500
      const salary = txs.find((t) => t.id === "plaid_tx_002");
      expect(salary).toBeDefined();
      expect(salary!.amount).toBe(3500);
      expect(salary!.type).toBe("credit");
    });

    it("uses personal_finance_category.detailed for category", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
      );

      const bk = txs.find((t) => t.id === "plaid_tx_001");
      expect(bk!.category).toBe("FOOD_AND_DRINK_FAST_FOOD");

      const netflix = txs.find((t) => t.id === "plaid_tx_003");
      expect(netflix!.category).toBe("ENTERTAINMENT_TV_AND_MOVIES");
    });

    it("extracts merchant from counterparties when merchant_name is null", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
      );

      // Burger King: merchant_name is "Burger King" directly
      const bk = txs.find((t) => t.id === "plaid_tx_001");
      expect(bk!.merchantName).toBe("Burger King");

      // Salary: no merchant_name, counterparty type is "financial_institution" not "merchant"
      const salary = txs.find((t) => t.id === "plaid_tx_002");
      expect(salary!.merchantName).toBeUndefined();
      expect(salary!.description).toBe("TECHCORP INC PAYROLL");
    });

    it("handles pagination with offset", async () => {
      const page1 = {
        ...transactionsFixture,
        transactions: transactionsFixture.transactions.slice(0, 3),
        total_transactions: 5,
      };
      const page2 = {
        ...transactionsFixture,
        transactions: transactionsFixture.transactions.slice(3),
        total_transactions: 5,
      };

      mockedFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
      );

      expect(txs).toHaveLength(5);
      expect(mockedFetch).toHaveBeenCalledTimes(2);

      // Second call should have offset=3
      const secondCallBody = JSON.parse(
        (mockedFetch.mock.calls[1][1] as { body: string }).body,
      );
      expect(secondCallBody.options.offset).toBe(3);
    });

    it("filters by type", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
        { type: "credit" },
      );

      expect(txs).toHaveLength(1);
      expect(txs[0].amount).toBe(3500);
    });

    it("filters by amount range", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "plaid_acc_checking",
        { amountMin: 20, amountMax: 100 },
      );

      // Should include: Burger King (28.34), Whole Foods (89.50)
      // Should exclude: salary (3500), Netflix (15.99), transfer (500)
      expect(txs).toHaveLength(2);
      for (const t of txs) {
        expect(Math.abs(t.amount)).toBeGreaterThanOrEqual(20);
        expect(Math.abs(t.amount)).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("getBalance", () => {
    it("returns current and available balances", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      const balances = await provider.getBalance(
        TEST_CONFIG,
        "plaid_acc_checking",
      );

      expect(balances.length).toBeGreaterThanOrEqual(2);

      const current = balances.find((b) => b.type === "current");
      expect(current).toBeDefined();
      expect(current!.amount).toBe(5400);

      const available = balances.find((b) => b.type === "available");
      expect(available).toBeDefined();
      expect(available!.amount).toBe(5250);
    });
  });

  describe("getConfigSchema", () => {
    it("returns all required fields including environment", () => {
      const schema = provider.getConfigSchema();
      const names = schema.map((f) => f.name);
      expect(names).toContain("clientId");
      expect(names).toContain("secret");
      expect(names).toContain("accessToken");
      expect(names).toContain("environment");

      const envField = schema.find((f) => f.name === "environment");
      expect(envField!.type).toBe("select");
      expect(envField!.options).toContain("sandbox");
      expect(envField!.options).toContain("production");
      expect(envField!.default).toBe("sandbox");
    });
  });
});
