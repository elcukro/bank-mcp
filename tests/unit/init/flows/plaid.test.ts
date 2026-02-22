import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies BEFORE importing the module under test
vi.mock("../../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

vi.mock("../../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

import { plaidInitFlow } from "../../../../src/init/flows/plaid.js";
import { httpFetch } from "../../../../src/utils/http.js";

const mockedFetch = vi.mocked(httpFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRL(answers: string[]) {
  let answerIdx = 0;
  return {
    question: vi.fn().mockImplementation(() => {
      return Promise.resolve(answers[answerIdx++] || "");
    }),
    close: vi.fn(),
  } as unknown as import("node:readline/promises").Interface;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sandboxPublicTokenResp = { public_token: "public-sandbox-abc123" };
const exchangeResp = { access_token: "access-sandbox-xyz789" };
const accountsResp = {
  accounts: [
    {
      account_id: "acc_plaid_001",
      name: "Plaid Checking",
      mask: "0000",
      type: "depository",
      subtype: "checking",
      balances: { iso_currency_code: "USD" },
    },
    {
      account_id: "acc_plaid_002",
      name: "Plaid Saving",
      mask: "1111",
      type: "depository",
      subtype: "savings",
      balances: { iso_currency_code: "USD" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plaidInitFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes sandbox flow with auto token creation", async () => {
    const rl = createMockRL([
      "",                // askWithBrowserOpen: press Enter (skip opening)
      "test_client_id",  // client_id
      "test_secret",     // secret
      "1",               // environment: sandbox
      "1",               // institution: First Platypus Bank
      "",                // label: default
    ]);

    mockedFetch
      .mockResolvedValueOnce(sandboxPublicTokenResp)  // /sandbox/public_token/create
      .mockResolvedValueOnce(exchangeResp)             // /item/public_token/exchange
      .mockResolvedValueOnce(accountsResp);            // /accounts/get

    const result = await plaidInitFlow(rl);

    expect(result.provider).toBe("plaid");
    expect(result.label).toBe("Plaid (sandbox)");
    expect(result.config.clientId).toBe("test_client_id");
    expect(result.config.secret).toBe("test_secret");
    expect(result.config.accessToken).toBe("access-sandbox-xyz789");
    expect(result.config.environment).toBe("sandbox");
    expect(result.config.accounts).toHaveLength(2);
    expect(result.config.accounts![0].name).toBe("Plaid Checking");
    expect(result.config.accounts![0].iban).toBe("****0000");
    expect(result.config.accounts![1].currency).toBe("USD");

    // Verify sandbox token creation call
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://sandbox.plaid.com/sandbox/public_token/create",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          institution_id: "ins_109508",
          initial_products: ["transactions"],
        }),
      }),
    );

    // Verify token exchange call
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://sandbox.plaid.com/item/public_token/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ public_token: "public-sandbox-abc123" }),
      }),
    );

    // Verify accounts validation call
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://sandbox.plaid.com/accounts/get",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ access_token: "access-sandbox-xyz789" }),
      }),
    );
  });

  it("accepts existing access token for development", async () => {
    const rl = createMockRL([
      "",                           // askWithBrowserOpen: skip
      "dev_client_id",              // client_id
      "dev_secret",                 // secret
      "2",                          // environment: development
      "access-dev-token-12345",     // paste access token
      "My Dev Bank",                // label
    ]);

    mockedFetch.mockResolvedValueOnce(accountsResp); // /accounts/get

    const result = await plaidInitFlow(rl);

    expect(result.provider).toBe("plaid");
    expect(result.label).toBe("My Dev Bank");
    expect(result.config.environment).toBe("development");
    expect(result.config.accessToken).toBe("access-dev-token-12345");
    expect(result.config.accounts).toHaveLength(2);

    // Verify it called development endpoint
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://development.plaid.com/accounts/get",
      expect.objectContaining({ method: "POST" }),
    );

    // Should only have 1 fetch call (accounts/get), no sandbox token calls
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on empty client ID", async () => {
    const rl = createMockRL([
      "",  // askWithBrowserOpen: skip
      "",  // empty client_id
      "some_secret",
    ]);

    await expect(plaidInitFlow(rl)).rejects.toThrow("client_id is required");
  });

  it("throws on empty secret", async () => {
    const rl = createMockRL([
      "",                // askWithBrowserOpen: skip
      "valid_client_id", // client_id
      "",                // empty secret
    ]);

    await expect(plaidInitFlow(rl)).rejects.toThrow("secret is required");
  });

  it("reuses existing credentials when user confirms", async () => {
    const rl = createMockRL([
      "",   // askWithBrowserOpen: skip
      "",   // reuse credentials: Y (default)
      "1",  // environment: sandbox
      "1",  // institution: First Platypus Bank
      "",   // label: default
    ]);

    const existingConfig = {
      clientId: "existing_client_id",
      secret: "existing_secret",
    };

    mockedFetch
      .mockResolvedValueOnce(sandboxPublicTokenResp)
      .mockResolvedValueOnce(exchangeResp)
      .mockResolvedValueOnce(accountsResp);

    const result = await plaidInitFlow(rl, existingConfig);

    expect(result.config.clientId).toBe("existing_client_id");
    expect(result.config.secret).toBe("existing_secret");
    expect(result.config.accessToken).toBe("access-sandbox-xyz789");

    // Verify headers used the existing credentials
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://sandbox.plaid.com/sandbox/public_token/create",
      expect.objectContaining({
        headers: expect.objectContaining({
          "PLAID-CLIENT-ID": "existing_client_id",
          "PLAID-SECRET": "existing_secret",
        }),
      }),
    );
  });
});
