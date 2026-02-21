import { describe, it, expect, vi, beforeEach } from "vitest";
import { TinkProvider } from "../../../src/providers/tink/index.js";

// Mock the HTTP layer
vi.mock("../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

import { httpFetch } from "../../../src/utils/http.js";

const mockedFetch = vi.mocked(httpFetch);

// Fixtures
import accountsFixture from "../../fixtures/tink/accounts.json";
import transactionsFixture from "../../fixtures/tink/transactions.json";
import balancesFixture from "../../fixtures/tink/balances.json";

const TEST_CONFIG = {
  accessToken: "tink_test_token_abc123",
};

describe("TinkProvider", () => {
  const provider = new TinkProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateConfig", () => {
    it("accepts valid config", () => {
      expect(() => provider.validateConfig(TEST_CONFIG)).not.toThrow();
    });

    it("rejects missing accessToken", () => {
      expect(() => provider.validateConfig({})).toThrow("accessToken");
    });
  });

  describe("listAccounts", () => {
    it("returns all accounts with correct fields", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      const accounts = await provider.listAccounts(TEST_CONFIG);

      expect(accounts).toHaveLength(3);
      expect(accounts[0].uid).toBe("tink_acc_checking");
      expect(accounts[0].name).toBe("Main Checking Account");
      expect(accounts[0].iban).toBe("DE89370400440532013000");
      expect(accounts[0].currency).toBe("EUR");
    });

    it("falls back to id when no IBAN present", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      const accounts = await provider.listAccounts(TEST_CONFIG);

      // Credit card account has no IBAN
      expect(accounts[2].iban).toBe("tink_acc_credit");
    });

    it("sends Bearer token in Authorization header", async () => {
      mockedFetch.mockResolvedValueOnce(accountsFixture);

      await provider.listAccounts(TEST_CONFIG);

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://api.tink.com/data/v2/accounts",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer tink_test_token_abc123",
          }),
        }),
      );
    });
  });

  describe("listTransactions", () => {
    it("parses fixed-point amounts correctly", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
      );

      // Lidl: unscaledValue=2834, scale=2 → 28.34, DEBIT → -28.34
      const lidl = txs.find((t) => t.id === "tink_tx_001");
      expect(lidl).toBeDefined();
      expect(lidl!.amount).toBeCloseTo(-28.34, 2);
      expect(lidl!.type).toBe("debit");
    });

    it("handles CREDIT transactions (income)", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
      );

      // Salary: unscaledValue=350000, scale=2 → 3500.00, CREDIT → +3500.00
      const salary = txs.find((t) => t.id === "tink_tx_002");
      expect(salary).toBeDefined();
      expect(salary!.amount).toBeCloseTo(3500.0, 2);
      expect(salary!.type).toBe("credit");
    });

    it("extracts merchant name from merchantInformation", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
      );

      const lidl = txs.find((t) => t.id === "tink_tx_001");
      expect(lidl!.merchantName).toBe("Lidl");
      expect(lidl!.description).toBe("Lidl");

      // Salary has no merchant
      const salary = txs.find((t) => t.id === "tink_tx_002");
      expect(salary!.merchantName).toBeUndefined();
      expect(salary!.description).toBe("ACME GmbH Salary");
    });

    it("uses PFM category names", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
      );

      const lidl = txs.find((t) => t.id === "tink_tx_001");
      expect(lidl!.category).toBe("Groceries");

      const spotify = txs.find((t) => t.id === "tink_tx_003");
      expect(spotify!.category).toBe("Entertainment");
    });

    it("handles pagination with nextPageToken", async () => {
      const page1 = {
        transactions: transactionsFixture.transactions.slice(0, 3),
        nextPageToken: "page2_cursor_xyz",
      };
      const page2 = {
        transactions: transactionsFixture.transactions.slice(3),
        nextPageToken: null,
      };

      mockedFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
      );

      expect(txs).toHaveLength(5);
      expect(mockedFetch).toHaveBeenCalledTimes(2);

      // Second call should include pageToken
      const secondCallUrl = mockedFetch.mock.calls[1][0] as string;
      expect(secondCallUrl).toContain("pageToken=page2_cursor_xyz");
    });

    it("filters by type", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
        { type: "credit" },
      );

      expect(txs).toHaveLength(1);
      expect(txs[0].amount).toBeCloseTo(3500.0, 2);
    });

    it("filters by amount range", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
        { amountMin: 20, amountMax: 100 },
      );

      // Should include: Lidl (28.34), REWE (89.50)
      // Should exclude: Salary (3500), Spotify (12.99), Transfer (500)
      expect(txs).toHaveLength(2);
      for (const t of txs) {
        expect(Math.abs(t.amount)).toBeGreaterThanOrEqual(20);
        expect(Math.abs(t.amount)).toBeLessThanOrEqual(100);
      }
    });

    it("passes date filters as query params", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      await provider.listTransactions(
        TEST_CONFIG,
        "tink_acc_checking",
        { dateFrom: "2026-02-01", dateTo: "2026-02-28" },
      );

      const callUrl = mockedFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("bookedDateGte=2026-02-01");
      expect(callUrl).toContain("bookedDateLte=2026-02-28");
    });
  });

  describe("getBalance", () => {
    it("returns booked and available balances", async () => {
      mockedFetch.mockResolvedValueOnce(balancesFixture);

      const balances = await provider.getBalance(
        TEST_CONFIG,
        "tink_acc_checking",
      );

      expect(balances).toHaveLength(2);

      const booked = balances.find((b) => b.type === "booked");
      expect(booked).toBeDefined();
      expect(booked!.amount).toBeCloseTo(5400.75, 2);
      expect(booked!.currency).toBe("EUR");

      const available = balances.find((b) => b.type === "available");
      expect(available).toBeDefined();
      expect(available!.amount).toBeCloseTo(5250.0, 2);
    });

    it("calls correct account-specific URL", async () => {
      mockedFetch.mockResolvedValueOnce(balancesFixture);

      await provider.getBalance(TEST_CONFIG, "tink_acc_checking");

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://api.tink.com/data/v2/accounts/tink_acc_checking/balances",
        expect.anything(),
      );
    });
  });

  describe("getConfigSchema", () => {
    it("returns accessToken as the only required field", () => {
      const schema = provider.getConfigSchema();

      expect(schema).toHaveLength(1);
      expect(schema[0].name).toBe("accessToken");
      expect(schema[0].required).toBe(true);
      expect(schema[0].secret).toBe(true);
    });
  });
});
