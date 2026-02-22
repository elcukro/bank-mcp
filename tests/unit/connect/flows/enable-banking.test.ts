import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies BEFORE importing the module under test
vi.mock("../../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

vi.mock("../../../../src/providers/enable-banking/auth.js", () => ({
  generateJwt: vi.fn().mockReturnValue("mock-jwt-token"),
}));

vi.mock("../../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue({
      toString: () => "deadbeef1234567890abcdef12345678",
    }),
  };
});

vi.mock("@clack/prompts", () => {
  const answers: unknown[] = [];
  let idx = 0;
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    log: { step: vi.fn(), info: vi.fn(), warn: vi.fn(), success: vi.fn() },
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

import {
  enableBankingConnectFlow,
  extractCodeFromUrl,
} from "../../../../src/connect/flows/enable-banking.js";
import { httpFetch } from "../../../../src/utils/http.js";
import { openBrowser } from "../../../../src/connect/browser.js";
import * as p from "@clack/prompts";

const mockedFetch = vi.mocked(httpFetch);
const mockedOpenBrowser = vi.mocked(openBrowser);
const setAnswers = (p as unknown as { __setAnswers: (a: unknown[]) => void }).__setAnswers;

// The redirect URL the user would paste (with correct state)
const VALID_REDIRECT =
  "https://localhost:13579/callback?code=AUTH_CODE_FROM_BANK&state=deadbeef1234567890abcdef12345678";

// Fixtures
const aspspsResponse = {
  aspsps: [
    { name: "ING Bank Slaski", country: "PL" },
    { name: "mBank", country: "PL" },
    { name: "PKO Bank Polski", country: "PL" },
  ],
};

const authResponse = {
  url: "https://login.ing.pl/oauth/authorize?client_id=xxx&state=deadbeef1234567890abcdef12345678",
};

const sessionCreateResponse = {
  session_id: "ses_new_123456",
};

const sessionDetailsResponse = {
  session_id: "ses_new_123456",
  accounts: ["acc-001", "acc-002"],
  access: { valid_until: "2026-05-23T00:00:00Z" },
};

const accountDetails001 = {
  uid: "acc-001",
  account_id: { iban: "PL21105014611000009040238140" },
  details: "Konto Active",
  currency: "PLN",
};

const accountDetails002 = {
  uid: "acc-002",
  account_id: { iban: "PL72105014611000009845640250" },
  product: "K@rta wirtualna ING VISA",
  currency: "PLN",
};

describe("enableBankingConnectFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes full flow: credentials → country → bank → auth → paste URL → session → accounts", async () => {
    setAnswers([
      false,              // p.confirm: open enablebanking.com? → no
      "test-app-id",      // p.text: App ID
      "/tmp/test.pem",    // p.text: private key path
      true,               // p.confirm: redirect URI already done? → yes
      "PL",               // p.select: country → Poland
      0,                  // p.select: bank → ING Bank Slaski (index 0)
      VALID_REDIRECT,     // p.text: paste redirect URL
      "ING Bank Slaski",  // p.text: label (default)
    ]);

    mockedFetch
      .mockResolvedValueOnce(aspspsResponse)       // aspsps
      .mockResolvedValueOnce(authResponse)          // auth
      .mockResolvedValueOnce(sessionCreateResponse) // sessions
      .mockResolvedValueOnce(sessionDetailsResponse) // session details
      .mockResolvedValueOnce(accountDetails001)     // account 1
      .mockResolvedValueOnce(accountDetails002);    // account 2

    const result = await enableBankingConnectFlow();

    // Verify result
    expect(result.provider).toBe("enable-banking");
    expect(result.label).toBe("ING Bank Slaski");
    expect(result.config.appId).toBe("test-app-id");
    expect(result.config.privateKeyPath).toBe("/tmp/test.pem");
    expect(result.config.sessionId).toBe("ses_new_123456");
    expect(result.config.validUntil).toBe("2026-05-23T00:00:00Z");
    expect(result.config.accounts).toHaveLength(2);
    expect(result.config.accounts[0].iban).toBe("PL21105014611000009040238140");
    expect(result.config.accounts[0].name).toBe("Konto Active");
    expect(result.config.accounts[1].name).toBe("K@rta wirtualna ING VISA");

    // Verify browser was opened with auth URL
    expect(mockedOpenBrowser).toHaveBeenCalledWith(authResponse.url);

    // Verify POST /auth body
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://api.enablebanking.com/auth",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"redirect_url":"https://localhost:13579/callback"'),
      }),
    );

    // Verify POST /sessions body
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://api.enablebanking.com/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "AUTH_CODE_FROM_BANK" }),
      }),
    );
  });

  it("reuses existing credentials when user confirms", async () => {
    setAnswers([
      false,              // p.confirm: open browser? → no
      true,               // p.confirm: reuse credentials? → yes
      true,               // p.confirm: redirect URI done? → yes
      "PL",               // p.select: country
      0,                  // p.select: bank → ING
      VALID_REDIRECT,     // p.text: redirect URL
      "ING",              // p.text: label
    ]);

    const existingConfig = {
      appId: "existing-app-id",
      privateKeyPath: "/existing/key.pem",
      sessionId: "old-session",
    };

    mockedFetch
      .mockResolvedValueOnce(aspspsResponse)
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(sessionCreateResponse)
      .mockResolvedValueOnce(sessionDetailsResponse)
      .mockResolvedValueOnce(accountDetails001)
      .mockResolvedValueOnce(accountDetails002);

    const result = await enableBankingConnectFlow(existingConfig);

    expect(result.config.appId).toBe("existing-app-id");
    expect(result.config.privateKeyPath).toBe("/existing/key.pem");
    expect(result.label).toBe("ING");
  });

  it("throws on invalid private key", async () => {
    setAnswers([
      false,                    // p.confirm: open browser? → no
      "test-app-id",            // p.text: App ID
      "/nonexistent/key.pem",   // p.text: key path
    ]);

    const { generateJwt } = await import(
      "../../../../src/providers/enable-banking/auth.js"
    );
    vi.mocked(generateJwt).mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file");
    });

    await expect(enableBankingConnectFlow()).rejects.toThrow(
      "Cannot read private key",
    );
  });

  it("throws when no banks found for country", async () => {
    setAnswers([
      false,            // p.confirm: open browser? → no
      "test-app-id",    // p.text: App ID
      "/tmp/test.pem",  // p.text: key path
      true,             // p.confirm: redirect URI done? → yes
      "PL",             // p.select: country
    ]);

    mockedFetch.mockResolvedValueOnce({ aspsps: [] });

    await expect(enableBankingConnectFlow()).rejects.toThrow(
      "No banks found",
    );
  });

  it("throws when auth API returns no URL", async () => {
    setAnswers([
      false,            // p.confirm: open browser? → no
      "test-app-id",    // p.text: App ID
      "/tmp/test.pem",  // p.text: key path
      true,             // p.confirm: redirect URI done? → yes
      "PL",             // p.select: country
      0,                // p.select: bank → ING
    ]);

    mockedFetch
      .mockResolvedValueOnce(aspspsResponse)
      .mockResolvedValueOnce({ error: "invalid_aspsp" }); // no url field

    await expect(enableBankingConnectFlow()).rejects.toThrow(
      "did not return an authorization URL",
    );
  });

  it("throws when session creation fails", async () => {
    setAnswers([
      false,            // p.confirm: open browser? → no
      "test-app-id",    // p.text: App ID
      "/tmp/test.pem",  // p.text: key path
      true,             // p.confirm: redirect URI done? → yes
      "PL",             // p.select: country
      0,                // p.select: bank → ING
      VALID_REDIRECT,   // p.text: redirect URL
    ]);

    mockedFetch
      .mockResolvedValueOnce(aspspsResponse)
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce({}); // no session_id

    await expect(enableBankingConnectFlow()).rejects.toThrow(
      "no session_id returned",
    );
  });

  it("handles custom label override", async () => {
    setAnswers([
      false,              // p.confirm: open browser? → no
      "test-app-id",      // p.text: App ID
      "/tmp/test.pem",    // p.text: key path
      true,               // p.confirm: redirect URI done? → yes
      "PL",               // p.select: country
      0,                  // p.select: bank → ING
      VALID_REDIRECT,     // p.text: redirect URL
      "My ING Account",   // p.text: label
    ]);

    mockedFetch
      .mockResolvedValueOnce(aspspsResponse)
      .mockResolvedValueOnce(authResponse)
      .mockResolvedValueOnce(sessionCreateResponse)
      .mockResolvedValueOnce(sessionDetailsResponse)
      .mockResolvedValueOnce(accountDetails001)
      .mockResolvedValueOnce(accountDetails002);

    const result = await enableBankingConnectFlow();
    expect(result.label).toBe("My ING Account");
  });
});

describe("extractCodeFromUrl", () => {
  const state = "deadbeef1234567890abcdef12345678";

  it("extracts code from valid redirect URL", () => {
    const code = extractCodeFromUrl(
      `https://localhost:13579/callback?code=ABC123&state=${state}`,
      state,
    );
    expect(code).toBe("ABC123");
  });

  it("throws on invalid URL", () => {
    expect(() => extractCodeFromUrl("not-a-url", state)).toThrow("Invalid URL");
  });

  it("throws on state mismatch", () => {
    expect(() =>
      extractCodeFromUrl(
        "https://localhost:13579/callback?code=ABC&state=wrong",
        state,
      ),
    ).toThrow("State mismatch");
  });

  it("throws on missing code", () => {
    expect(() =>
      extractCodeFromUrl(
        `https://localhost:13579/callback?state=${state}`,
        state,
      ),
    ).toThrow("No authorization code");
  });

  it("throws on bank error", () => {
    expect(() =>
      extractCodeFromUrl(
        `https://localhost:13579/callback?error=access_denied&error_description=User+cancelled&state=${state}`,
        state,
      ),
    ).toThrow("Bank authorization failed: User cancelled");
  });

  it("handles URL with extra whitespace", () => {
    const code = extractCodeFromUrl(
      `  https://localhost:13579/callback?code=TRIMMED&state=${state}  `,
      state,
    );
    expect(code).toBe("TRIMMED");
  });
});
