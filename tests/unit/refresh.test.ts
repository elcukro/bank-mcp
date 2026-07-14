import { describe, it, expect, vi, beforeEach } from "vitest";
import { runRefresh, DETAILS_PENDING } from "../../src/refresh.js";
import { loadConfig, saveConfig } from "../../src/config.js";
import { httpFetch } from "../../src/utils/http.js";

// Mock the config functions
vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  expandPaths: vi.fn((c) => c),
}));

// Mock HTTP layer
vi.mock("../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

// Mock the JWT layer
vi.mock("../../src/providers/enable-banking/auth.js", () => ({
  generateJwt: vi.fn().mockReturnValue("mock-jwt-token"),
}));

describe("runRefresh prioritization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prioritizes pending/missing accounts and preserves output order", async () => {
    const mockConfig = {
      connections: [
        {
          id: "conn-eb-01",
          provider: "enable-banking",
          label: "Enable Banking Connection",
          config: {
            appId: "eb_app_test",
            privateKeyPath: "/tmp/test-key.pem",
            sessionId: "ses_test123456",
            accounts: [
              { uid: "acc-uid-001", iban: "PL1111", name: "Cached Account 1", currency: "PLN" },
              { uid: "acc-uid-002", iban: "acc-uid-002", name: DETAILS_PENDING, currency: "PLN" },
            ],
          },
        },
      ],
    };

    vi.mocked(loadConfig).mockReturnValue(mockConfig);

    const requestUrls: string[] = [];
    vi.mocked(httpFetch).mockImplementation(async (url) => {
      requestUrls.push(url as string);
      if ((url as string).includes("/sessions/")) {
        return {
          accounts: ["acc-uid-001", "acc-uid-002", "acc-uid-003"],
          access: { valid_until: "2026-12-31T00:00:00Z" },
        };
      }
      if ((url as string).includes("/accounts/acc-uid-001/details")) {
        return { uid: "acc-uid-001", account_id: { iban: "PL1111" }, details: "Cached Account 1", currency: "PLN" };
      }
      if ((url as string).includes("/accounts/acc-uid-002/details")) {
        return { uid: "acc-uid-002", account_id: { iban: "PL2222" }, details: "Fetched Account 2", currency: "PLN" };
      }
      if ((url as string).includes("/accounts/acc-uid-003/details")) {
        return { uid: "acc-uid-003", account_id: { iban: "PL3333" }, details: "Fetched Account 3", currency: "PLN" };
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    await runRefresh();

    // Verify calling sequence:
    // Call 0: Session details fetch
    expect(requestUrls[0]).toContain("/sessions/ses_test123456");

    // Call 1 & 2: Should be acc-uid-002 and acc-uid-003 (the pending/new ones) in any order
    const nextTwo = requestUrls.slice(1, 3);
    expect(nextTwo).toContain("https://api.enablebanking.com/accounts/acc-uid-002/details");
    expect(nextTwo).toContain("https://api.enablebanking.com/accounts/acc-uid-003/details");

    // Call 3: Should be acc-uid-001 (already cached details)
    expect(requestUrls[3]).toContain("https://api.enablebanking.com/accounts/acc-uid-001/details");

    // Verify saveConfig is called with correctly structured and ordered accounts
    expect(saveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = vi.mocked(saveConfig).mock.calls[0][0];
    const savedAccounts = savedConfig.connections[0].config.accounts;

    expect(savedAccounts).toHaveLength(3);
    expect(savedAccounts[0]).toEqual({ uid: "acc-uid-001", iban: "PL1111", name: "Cached Account 1", currency: "PLN" });
    expect(savedAccounts[1]).toEqual({ uid: "acc-uid-002", iban: "PL2222", name: "Fetched Account 2", currency: "PLN" });
    expect(savedAccounts[2]).toEqual({ uid: "acc-uid-003", iban: "PL3333", name: "Fetched Account 3", currency: "PLN" });
  });
});
