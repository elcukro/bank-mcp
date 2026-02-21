import { describe, it, expect, vi } from "vitest";

// Mock config to use mock provider
vi.mock("../../../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    version: 1,
    connections: [{ id: "mock", provider: "mock", label: "Mock", config: {} }],
    defaults: { transactionDays: 90, currency: "PLN" },
  }),
  getConnection: vi.fn().mockReturnValue({
    id: "mock",
    provider: "mock",
    label: "Mock",
    config: {},
  }),
  getAllConnections: vi.fn().mockReturnValue([
    { id: "mock", provider: "mock", label: "Mock", config: {} },
  ]),
}));

import { listTransactions } from "../../../src/tools/list-transactions.js";

describe("listTransactions", () => {
  it("returns transactions sorted by date descending", async () => {
    const txs = await listTransactions({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
      limit: 20,
    });

    expect(txs.length).toBeLessThanOrEqual(20);
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i - 1].date >= txs[i].date).toBe(true);
    }
  });

  it("filters by debit type", async () => {
    const txs = await listTransactions({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
      type: "debit",
      limit: 50,
    });

    expect(txs.length).toBeGreaterThan(0);
    expect(txs.every((t) => t.type === "debit")).toBe(true);
    expect(txs.every((t) => t.amount < 0)).toBe(true);
  });

  it("filters by credit type", async () => {
    const txs = await listTransactions({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
      type: "credit",
      limit: 50,
    });

    expect(txs.length).toBeGreaterThan(0);
    expect(txs.every((t) => t.type === "credit")).toBe(true);
    expect(txs.every((t) => t.amount > 0)).toBe(true);
  });

  it("filters by amount range", async () => {
    const txs = await listTransactions({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
      amountMin: 50,
      amountMax: 200,
      limit: 100,
    });

    for (const t of txs) {
      expect(Math.abs(t.amount)).toBeGreaterThanOrEqual(50);
      expect(Math.abs(t.amount)).toBeLessThanOrEqual(200);
    }
  });

  it("respects limit parameter", async () => {
    const txs = await listTransactions({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
      limit: 5,
    });

    expect(txs.length).toBeLessThanOrEqual(5);
  });
});
