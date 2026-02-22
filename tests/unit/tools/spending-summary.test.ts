import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the config to use mock provider
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

import { spendingSummary } from "../../../src/tools/spending-summary.js";

describe("spendingSummary", () => {
  it("groups expenses by merchant", async () => {
    const result = await spendingSummary({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
    });

    expect(result.groups).toBeDefined();
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.totalSpent).toBeGreaterThan(0);
    expect(result.currency).toBe("USD");

    // All groups should have positive totalSpent
    for (const group of result.groups) {
      expect(group.totalSpent).toBeGreaterThan(0);
      expect(group.transactionCount).toBeGreaterThan(0);
      expect(group.name).toBeTruthy();
    }
  });

  it("respects limit parameter", async () => {
    const result = await spendingSummary({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
      limit: 3,
    });

    expect(result.groups.length).toBeLessThanOrEqual(3);
  });

  it("sorts by total spent descending", async () => {
    const result = await spendingSummary({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-21",
    });

    for (let i = 1; i < result.groups.length; i++) {
      expect(result.groups[i - 1].totalSpent).toBeGreaterThanOrEqual(
        result.groups[i].totalSpent,
      );
    }
  });
});
