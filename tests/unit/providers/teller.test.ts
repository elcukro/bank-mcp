import { describe, it, expect, vi, beforeEach } from "vitest";
import { TellerProvider } from "../../../src/providers/teller/index.js";

// Mock the node:https module to intercept mTLS requests
vi.mock("node:https", () => {
  const EventEmitter = require("node:events");

  // Fake response that emits data + end
  function createMockResponse(statusCode: number, body: unknown) {
    const res = new EventEmitter();
    Object.assign(res, { statusCode, statusMessage: "OK" });
    // Emit data async to simulate real behavior
    process.nextTick(() => {
      res.emit("data", Buffer.from(JSON.stringify(body)));
      res.emit("end");
    });
    return res;
  }

  // requestHandler is what we'll mock per-test
  const requestHandler = vi.fn();

  return {
    request: (url: string, opts: unknown, callback: (res: unknown) => void) => {
      const req = new EventEmitter();
      Object.assign(req, {
        end: vi.fn(),
        setTimeout: vi.fn(),
        destroy: vi.fn(),
      });

      const { statusCode, body } = requestHandler(url) || {
        statusCode: 200,
        body: {},
      };
      process.nextTick(() => callback(createMockResponse(statusCode, body)));

      return req;
    },
    Agent: vi.fn(),
    // Expose the handler so tests can configure responses
    __requestHandler: requestHandler,
  };
});

// Import after mocking
import { __requestHandler } from "node:https";
const requestHandler = __requestHandler as ReturnType<typeof vi.fn>;

// Fixtures
import accountsFixture from "../../fixtures/teller/accounts.json";
import transactionsFixture from "../../fixtures/teller/transactions.json";
import balancesFixture from "../../fixtures/teller/balances.json";

const TEST_CONFIG = {
  certificatePath: "/tmp/test-cert.pem",
  privateKeyPath: "/tmp/test-key.pem",
  accessToken: "test_token_abc123",
};

// Mock fs.readFileSync for certificate loading
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue("mock-cert-data"),
  };
});

describe("TellerProvider", () => {
  const provider = new TellerProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateConfig", () => {
    it("accepts valid config", () => {
      expect(() => provider.validateConfig(TEST_CONFIG)).not.toThrow();
    });

    it("rejects missing accessToken", () => {
      expect(() =>
        provider.validateConfig({
          certificatePath: "/tmp/c.pem",
          privateKeyPath: "/tmp/k.pem",
        }),
      ).toThrow("accessToken");
    });

    it("accepts config without certificate paths (sandbox mode)", () => {
      expect(() =>
        provider.validateConfig({
          accessToken: "tok",
        }),
      ).not.toThrow();
    });
  });

  describe("listAccounts", () => {
    it("returns only open accounts", async () => {
      requestHandler.mockReturnValue({
        statusCode: 200,
        body: accountsFixture,
      });

      const accounts = await provider.listAccounts(TEST_CONFIG);

      // Fixture has 3 accounts but one is "closed"
      expect(accounts).toHaveLength(2);
      expect(accounts[0].uid).toBe("acc_test001");
      expect(accounts[0].name).toBe("Total Checking");
      expect(accounts[0].iban).toBe("****4567");
      expect(accounts[0].currency).toBe("USD");
      expect(accounts[1].uid).toBe("acc_test002");
    });
  });

  describe("listTransactions", () => {
    // listTransactions now calls /accounts first (for currency), then /accounts/{id}/transactions
    function mockTransactionsEndpoints() {
      requestHandler.mockImplementation((url: string) => {
        if (url.includes("/transactions")) {
          return { statusCode: 200, body: transactionsFixture };
        }
        // /accounts endpoint (for currency lookup)
        return { statusCode: 200, body: accountsFixture };
      });
    }

    it("normalizes debit transactions", async () => {
      mockTransactionsEndpoints();

      const txs = await provider.listTransactions(TEST_CONFIG, "acc_test001");

      const groceries = txs.find((t) => t.id === "txn_t001");
      expect(groceries).toBeDefined();
      expect(groceries!.amount).toBe(-42.5);
      expect(groceries!.type).toBe("debit");
      expect(groceries!.merchantName).toBe("Whole Foods Market");
      expect(groceries!.category).toBe("groceries");
      expect(groceries!.description).toBe("Whole Foods Market");
    });

    it("normalizes credit transactions", async () => {
      mockTransactionsEndpoints();

      const txs = await provider.listTransactions(TEST_CONFIG, "acc_test001");

      const income = txs.find((t) => t.id === "txn_t002");
      expect(income).toBeDefined();
      expect(income!.amount).toBe(3500);
      expect(income!.type).toBe("credit");
      expect(income!.merchantName).toBe("TechCorp Inc");
      expect(income!.category).toBe("income");
    });

    it("handles null counterparty name", async () => {
      mockTransactionsEndpoints();

      const txs = await provider.listTransactions(TEST_CONFIG, "acc_test001");

      // txn_t005 has null counterparty — should fallback to description
      const transfer = txs.find((t) => t.id === "txn_t005");
      expect(transfer).toBeDefined();
      expect(transfer!.merchantName).toBeUndefined();
      expect(transfer!.description).toBe("TRANSFER TO SAVINGS");
    });

    it("filters by type", async () => {
      mockTransactionsEndpoints();

      const txs = await provider.listTransactions(TEST_CONFIG, "acc_test001", {
        type: "credit",
      });

      expect(txs).toHaveLength(1);
      expect(txs[0].id).toBe("txn_t002");
    });

    it("filters by amount range", async () => {
      mockTransactionsEndpoints();

      const txs = await provider.listTransactions(TEST_CONFIG, "acc_test001", {
        amountMin: 40,
        amountMax: 100,
      });

      // Should include: Whole Foods (42.50), Shell (65.00)
      // Should exclude: income (3500), Netflix (15.99), transfer (120)
      expect(txs.length).toBe(2);
      for (const t of txs) {
        expect(Math.abs(t.amount)).toBeGreaterThanOrEqual(40);
        expect(Math.abs(t.amount)).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("getBalance", () => {
    it("returns ledger and available balances", async () => {
      // getBalance now calls /accounts first (for currency), then /accounts/{id}/balances
      requestHandler.mockImplementation((url: string) => {
        if (url.endsWith("/balances")) {
          return { statusCode: 200, body: balancesFixture };
        }
        // /accounts endpoint
        return { statusCode: 200, body: accountsFixture };
      });

      const balances = await provider.getBalance(TEST_CONFIG, "acc_test001");

      expect(balances).toHaveLength(2);

      const ledger = balances.find((b) => b.type === "ledger");
      expect(ledger).toBeDefined();
      expect(ledger!.amount).toBe(5247.83);
      expect(ledger!.currency).toBe("USD");

      const available = balances.find((b) => b.type === "available");
      expect(available).toBeDefined();
      expect(available!.amount).toBe(5197.83);
    });
  });

  describe("getConfigSchema", () => {
    it("returns mTLS + token fields", () => {
      const schema = provider.getConfigSchema();
      const names = schema.map((f) => f.name);
      expect(names).toContain("certificatePath");
      expect(names).toContain("privateKeyPath");
      expect(names).toContain("accessToken");
      expect(schema.find((f) => f.name === "accessToken")?.required).toBe(true);
      expect(schema.find((f) => f.name === "certificatePath")?.required).toBe(false);
      expect(schema.find((f) => f.name === "privateKeyPath")?.required).toBe(false);
    });
  });
});
