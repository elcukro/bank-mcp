import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies BEFORE importing the module under test
vi.mock("../../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

vi.mock("../../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

vi.mock("@clack/prompts", () => {
  const answers: unknown[] = [];
  let idx = 0;
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    log: { step: vi.fn(), info: vi.fn(), success: vi.fn() },
    note: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn(() => false),
    confirm: vi.fn(() => Promise.resolve(answers[idx++])),
    text: vi.fn(() => Promise.resolve(answers[idx++])),
    password: vi.fn(() => Promise.resolve(answers[idx++])),
    select: vi.fn(() => Promise.resolve(answers[idx++])),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    __setAnswers: (a: unknown[]) => { answers.length = 0; answers.push(...a); idx = 0; },
  };
});

import { plaidInitFlow } from "../../../../src/init/flows/plaid.js";
import { httpFetch } from "../../../../src/utils/http.js";
import * as p from "@clack/prompts";

const mockedFetch = vi.mocked(httpFetch);
const setAnswers = (p as unknown as { __setAnswers: (a: unknown[]) => void }).__setAnswers;

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
    setAnswers([
      false,              // askWithBrowserOpen: don't open browser
      "test_client_id",   // p.text: client_id
      "test_secret",      // p.password: secret
      "sandbox",          // p.select: environment
      "ins_109508",       // p.select: institution (First Platypus Bank)
      "Plaid (sandbox)",  // p.text: label (default)
    ]);

    mockedFetch
      .mockResolvedValueOnce(sandboxPublicTokenResp)  // /sandbox/public_token/create
      .mockResolvedValueOnce(exchangeResp)             // /item/public_token/exchange
      .mockResolvedValueOnce(accountsResp);            // /accounts/get

    const result = await plaidInitFlow();

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
    setAnswers([
      false,                      // askWithBrowserOpen: don't open
      "dev_client_id",            // p.text: client_id
      "dev_secret",               // p.password: secret
      "development",              // p.select: environment
      "access-dev-token-12345",   // p.text: access token
      "My Dev Bank",              // p.text: label
    ]);

    mockedFetch.mockResolvedValueOnce(accountsResp); // /accounts/get

    const result = await plaidInitFlow();

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
    setAnswers([
      false,  // askWithBrowserOpen: don't open
      "",     // empty client_id
      "some_secret",
    ]);

    await expect(plaidInitFlow()).rejects.toThrow("client_id is required");
  });

  it("throws on empty secret", async () => {
    setAnswers([
      false,            // askWithBrowserOpen: don't open
      "valid_client_id", // client_id
      "",               // empty secret
    ]);

    await expect(plaidInitFlow()).rejects.toThrow("secret is required");
  });

  it("reuses existing credentials when user confirms", async () => {
    setAnswers([
      false,              // askWithBrowserOpen: don't open
      true,               // p.confirm: reuse credentials
      "sandbox",          // p.select: environment
      "ins_109508",       // p.select: institution
      "Plaid (sandbox)",  // p.text: label
    ]);

    const existingConfig = {
      clientId: "existing_client_id",
      secret: "existing_secret",
    };

    mockedFetch
      .mockResolvedValueOnce(sandboxPublicTokenResp)
      .mockResolvedValueOnce(exchangeResp)
      .mockResolvedValueOnce(accountsResp);

    const result = await plaidInitFlow(existingConfig);

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
