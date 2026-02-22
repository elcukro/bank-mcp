import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnableBankingProvider } from "../../../src/providers/enable-banking/index.js";

// Mock the HTTP layer
vi.mock("../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

// Mock the JWT layer
vi.mock("../../../src/providers/enable-banking/auth.js", () => ({
  generateJwt: vi.fn().mockReturnValue("mock-jwt-token"),
}));

import { httpFetch } from "../../../src/utils/http.js";

const mockedFetch = vi.mocked(httpFetch);

// Load fixtures
import sessionFixture from "../../fixtures/enable-banking/session.json";
import accountDetails001 from "../../fixtures/enable-banking/account-details-001.json";
import accountDetails002 from "../../fixtures/enable-banking/account-details-002.json";
import transactionsFixture from "../../fixtures/enable-banking/transactions.json";
import balancesFixture from "../../fixtures/enable-banking/balances.json";

const TEST_CONFIG = {
  appId: "eb_app_test",
  privateKeyPath: "/tmp/test-key.pem",
  sessionId: "ses_test123456",
};

describe("EnableBankingProvider", () => {
  const provider = new EnableBankingProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateConfig", () => {
    it("accepts valid config", () => {
      expect(() => provider.validateConfig(TEST_CONFIG)).not.toThrow();
    });

    it("rejects missing appId", () => {
      expect(() =>
        provider.validateConfig({ privateKeyPath: "/tmp/k.pem", sessionId: "s" }),
      ).toThrow("appId");
    });

    it("rejects missing sessionId", () => {
      expect(() =>
        provider.validateConfig({ appId: "a", privateKeyPath: "/tmp/k.pem" }),
      ).toThrow("sessionId");
    });
  });

  describe("listAccounts", () => {
    it("fetches accounts from session then details endpoints", async () => {
      // 1st call: session (returns UIDs), 2nd+3rd: account details
      mockedFetch
        .mockResolvedValueOnce(sessionFixture)
        .mockResolvedValueOnce(accountDetails001)
        .mockResolvedValueOnce(accountDetails002);

      const accounts = await provider.listAccounts(TEST_CONFIG);

      expect(accounts).toHaveLength(2);
      expect(accounts[0].iban).toBe("PL61109010140000071219812874");
      expect(accounts[0].name).toBe("Konto Direct");
      expect(accounts[0].currency).toBe("PLN");
      expect(accounts[1].name).toBe("Konto Oszczednosciowe");

      // Should call session endpoint first
      expect(mockedFetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/ses_test123456"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer mock-jwt-token",
          }),
        }),
      );
      // Then call details for each account
      expect(mockedFetch).toHaveBeenCalledWith(
        expect.stringContaining("/accounts/acc-uid-001/details"),
        expect.anything(),
      );
      expect(mockedFetch).toHaveBeenCalledWith(
        expect.stringContaining("/accounts/acc-uid-002/details"),
        expect.anything(),
      );
      expect(mockedFetch).toHaveBeenCalledTimes(3);
    });

    it("returns cached accounts from config if available", async () => {
      const configWithAccounts = {
        ...TEST_CONFIG,
        accounts: [
          { uid: "cached-001", iban: "PL11111", name: "Cached Account", currency: "PLN" },
        ],
      };

      const accounts = await provider.listAccounts(configWithAccounts);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].uid).toBe("cached-001");
      // Should NOT call API when accounts are cached
      expect(mockedFetch).not.toHaveBeenCalled();
    });
  });

  describe("listTransactions", () => {
    it("normalizes DBIT transactions correctly", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(TEST_CONFIG, "acc-uid-001");

      // First tx: DBIT to Biedronka
      const biedronka = txs.find((t) => t.id === "REF-001");
      expect(biedronka).toBeDefined();
      expect(biedronka!.amount).toBe(-150.50);
      expect(biedronka!.type).toBe("debit");
      expect(biedronka!.merchantName).toBe("Biedronka Sp. z o.o.");
      expect(biedronka!.description).toBe("Biedronka Sp. z o.o.");
      expect(biedronka!.currency).toBe("PLN");
    });

    it("normalizes CRDT transactions correctly", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(TEST_CONFIG, "acc-uid-001");

      // Second tx: CRDT salary from TechCorp
      const salary = txs.find((t) => t.id === "REF-002");
      expect(salary).toBeDefined();
      expect(salary!.amount).toBe(12500.0);
      expect(salary!.type).toBe("credit");
      expect(salary!.merchantName).toBe("TechCorp Sp. z o.o.");
    });

    it("handles missing entry_reference with fallback ID", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(TEST_CONFIG, "acc-uid-001");

      // Fifth tx: null entry_reference
      const orange = txs.find((t) => t.description === "Orange Polska");
      expect(orange).toBeDefined();
      expect(orange!.id).toMatch(/^eb:acc-uid-001:txn-005$/);
    });

    it("handles pagination with continuation_key", async () => {
      const page1 = {
        transactions: transactionsFixture.transactions.slice(0, 2),
        continuation_key: "page2-key",
      };
      const page2 = {
        transactions: transactionsFixture.transactions.slice(2),
        continuation_key: null,
      };

      mockedFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      const txs = await provider.listTransactions(TEST_CONFIG, "acc-uid-001");

      expect(txs).toHaveLength(5);
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      // Second call should include continuation_key
      expect(mockedFetch).toHaveBeenLastCalledWith(
        expect.stringContaining("continuation_key=page2-key"),
        expect.anything(),
      );
    });

    it("filters by amount range", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(TEST_CONFIG, "acc-uid-001", {
        amountMin: 100,
        amountMax: 300,
      });

      // Should include: Biedronka (150.50), Orlen (250.00)
      // Should exclude: salary (12500), Netflix (43), Orange (79)
      expect(txs.every((t) => Math.abs(t.amount) >= 100)).toBe(true);
      expect(txs.every((t) => Math.abs(t.amount) <= 300)).toBe(true);
    });

    it("filters by type", async () => {
      mockedFetch.mockResolvedValueOnce(transactionsFixture);

      const txs = await provider.listTransactions(TEST_CONFIG, "acc-uid-001", {
        type: "credit",
      });

      expect(txs.every((t) => t.type === "credit")).toBe(true);
      expect(txs.length).toBe(1); // Only the salary
    });
  });

  describe("getBalance", () => {
    it("returns normalized balances", async () => {
      mockedFetch.mockResolvedValueOnce(balancesFixture);

      const balances = await provider.getBalance(TEST_CONFIG, "acc-uid-001");

      expect(balances).toHaveLength(2);
      expect(balances[0].amount).toBe(12450.67);
      expect(balances[0].type).toBe("closingBooked");
      expect(balances[0].currency).toBe("PLN");
      expect(balances[1].type).toBe("expected");
    });
  });

  describe("getConfigSchema", () => {
    it("returns required fields", () => {
      const schema = provider.getConfigSchema();
      const names = schema.map((f) => f.name);
      expect(names).toContain("appId");
      expect(names).toContain("privateKeyPath");
      expect(names).toContain("sessionId");
      expect(schema.every((f) => f.required)).toBe(true);
    });
  });
});
