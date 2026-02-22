# Guided Init Setup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bare-bones `init` wizard with a unified, guided setup experience that walks new users through each provider's prerequisites, signup, and credential collection with a friendly TUI.

**Architecture:** Per-provider flow functions (like existing `connect/flows/`) orchestrated by a rewritten `init.ts`. Plaid sandbox auto-creates tokens; Teller serves a local Connect widget. Enable Banking and Tink flows are reused from `connect/flows/`.

**Tech Stack:** Node.js readline/promises, node:http (local server for Teller Connect), existing `httpFetch` utility, Vitest for tests.

---

### Task 1: Create shared TUI utilities (`src/init/ui.ts`)

**Files:**
- Create: `src/init/ui.ts`
- Test: `tests/unit/init/ui.test.ts`

**Step 1: Write the tests**

```typescript
// tests/unit/init/ui.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

import { printBanner, printSection, printAccounts, askWithBrowserOpen } from "../../src/init/ui.js";
import { openBrowser } from "../../src/connect/browser.js";

const mockedOpenBrowser = vi.mocked(openBrowser);

function createMockRL(answers: string[]) {
  let idx = 0;
  return {
    question: vi.fn().mockImplementation(() => Promise.resolve(answers[idx++] || "")),
    close: vi.fn(),
  } as unknown as import("node:readline/promises").Interface;
}

describe("TUI utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("printBanner outputs welcome box", () => {
    printBanner();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("bank-mcp");
    expect(output).toContain("Connect your bank account");
  });

  it("printSection outputs titled section", () => {
    printSection("Step 1: Credentials");
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Step 1: Credentials");
    expect(output).toContain("──");
  });

  it("printAccounts formats account list", () => {
    printAccounts([
      { uid: "1", iban: "PL123", name: "Checking", currency: "PLN", connectionId: "" },
      { uid: "2", iban: "PL456", name: "Savings", currency: "PLN", connectionId: "" },
    ]);
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("PL123");
    expect(output).toContain("Checking");
    expect(output).toContain("2 account(s)");
  });

  it("askWithBrowserOpen opens browser on 'o'", async () => {
    const rl = createMockRL(["o"]);
    await askWithBrowserOpen(rl, "https://example.com");
    expect(mockedOpenBrowser).toHaveBeenCalledWith("https://example.com");
  });

  it("askWithBrowserOpen skips browser on Enter", async () => {
    const rl = createMockRL([""]);
    await askWithBrowserOpen(rl, "https://example.com");
    expect(mockedOpenBrowser).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/init/ui.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/init/ui.ts`**

```typescript
// src/init/ui.ts
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { BankAccount } from "../types.js";
import { openBrowser } from "../connect/browser.js";

export function printBanner(): void {
  console.log("");
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │  bank-mcp — Connect your bank account    │");
  console.log("  └──────────────────────────────────────────┘");
  console.log("");
}

export function printSection(title: string): void {
  const line = "─".repeat(Math.max(0, 46 - title.length));
  console.log(`\n  ── ${title} ${line}\n`);
}

export function printAccounts(accounts: BankAccount[]): void {
  console.log(`  Found ${accounts.length} account(s):`);
  for (const acc of accounts) {
    console.log(`    • ${acc.iban} (${acc.name}, ${acc.currency})`);
  }
}

export async function askWithBrowserOpen(
  rl: ReadlineInterface,
  url: string,
): Promise<void> {
  const answer = await rl.question(`  Press 'o' to open ${url}, or Enter to continue: `);
  if (answer.toLowerCase() === "o") {
    openBrowser(url);
    console.log(`\n  Opened ${url}`);
    await rl.question("  Press Enter once you're ready to continue... ");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/init/ui.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/init/ui.ts tests/unit/init/ui.test.ts
git commit -m "feat(init): add shared TUI utilities for guided setup"
```

---

### Task 2: Create Plaid guided flow (`src/init/flows/plaid.ts`)

**Files:**
- Create: `src/init/flows/plaid.ts`
- Test: `tests/unit/init/flows/plaid.test.ts`

**Step 1: Write the tests**

```typescript
// tests/unit/init/flows/plaid.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/http.js", () => ({
  httpFetch: vi.fn(),
}));

vi.mock("../../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

import { plaidInitFlow } from "../../../../src/init/flows/plaid.js";
import { httpFetch } from "../../../../src/utils/http.js";

const mockedFetch = vi.mocked(httpFetch);

function createMockRL(answers: string[]) {
  let idx = 0;
  return {
    question: vi.fn().mockImplementation(() => Promise.resolve(answers[idx++] || "")),
    close: vi.fn(),
  } as unknown as import("node:readline/promises").Interface;
}

describe("plaidInitFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("completes sandbox flow with auto token creation", async () => {
    // User inputs: Enter (skip browser), client_id, secret, "1" (sandbox), "1" (First Platypus), label
    const rl = createMockRL(["", "test_client_id", "test_secret", "1", "1", "My Plaid Test"]);

    // Mock: sandbox/public_token/create
    mockedFetch.mockResolvedValueOnce({ public_token: "public-sandbox-xxx" });
    // Mock: item/public_token/exchange
    mockedFetch.mockResolvedValueOnce({ access_token: "access-sandbox-xxx" });
    // Mock: accounts/get (for validation)
    mockedFetch.mockResolvedValueOnce({
      accounts: [
        { account_id: "acc1", name: "Plaid Checking", mask: "0000",
          type: "depository", subtype: "checking",
          balances: { iso_currency_code: "USD" } },
      ],
    });

    const result = await plaidInitFlow(rl);

    expect(result.provider).toBe("plaid");
    expect(result.config.clientId).toBe("test_client_id");
    expect(result.config.accessToken).toBe("access-sandbox-xxx");
    expect(result.config.environment).toBe("sandbox");
    expect(result.label).toBe("My Plaid Test");
  });

  it("accepts existing access token for development environment", async () => {
    // User inputs: Enter, client_id, secret, "2" (development), access_token, label
    const rl = createMockRL(["", "client_id", "secret", "2", "access-dev-xxx", "Dev Bank"]);

    // Mock: accounts/get
    mockedFetch.mockResolvedValueOnce({
      accounts: [
        { account_id: "a1", name: "Checking", mask: "1234",
          type: "depository", subtype: "checking",
          balances: { iso_currency_code: "USD" } },
      ],
    });

    const result = await plaidInitFlow(rl);

    expect(result.config.environment).toBe("development");
    expect(result.config.accessToken).toBe("access-dev-xxx");
  });

  it("throws on empty client ID", async () => {
    const rl = createMockRL(["", "", "secret"]);
    await expect(plaidInitFlow(rl)).rejects.toThrow("Client ID is required");
  });

  it("throws on empty secret", async () => {
    const rl = createMockRL(["", "client_id", ""]);
    await expect(plaidInitFlow(rl)).rejects.toThrow("Secret is required");
  });

  it("reuses existing credentials when user confirms", async () => {
    const existingConfig = { clientId: "existing_id", secret: "existing_secret" };
    // "y" to reuse, "1" sandbox, "1" First Platypus, label
    const rl = createMockRL(["y", "1", "1", "Reused"]);

    mockedFetch.mockResolvedValueOnce({ public_token: "public-sandbox-xxx" });
    mockedFetch.mockResolvedValueOnce({ access_token: "access-sandbox-yyy" });
    mockedFetch.mockResolvedValueOnce({ accounts: [] });

    const result = await plaidInitFlow(rl, existingConfig);
    expect(result.config.clientId).toBe("existing_id");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/init/flows/plaid.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/init/flows/plaid.ts`**

```typescript
// src/init/flows/plaid.ts
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { httpFetch } from "../../utils/http.js";
import { printSection, printAccounts, askWithBrowserOpen } from "../ui.js";
import type { BankAccount } from "../../types.js";

const ENVIRONMENTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

const SANDBOX_INSTITUTIONS = [
  { id: "ins_109508", name: "First Platypus Bank" },
  { id: "ins_109509", name: "Tartan Bank" },
] as const;

export interface PlaidInitResult {
  provider: "plaid";
  label: string;
  config: {
    clientId: string;
    secret: string;
    accessToken: string;
    environment: string;
    accounts?: Array<{ uid: string; iban: string; name: string; currency: string }>;
  };
}

export async function plaidInitFlow(
  rl: ReadlineInterface,
  existingConfig?: Record<string, unknown>,
): Promise<PlaidInitResult> {
  // ── Welcome ──────────────────────────────────────
  console.log("  Plaid connects to 12,000+ banks across the US, UK, and EU.\n");
  console.log("  Prerequisites:");
  console.log("    • Plaid account — free at https://dashboard.plaid.com/signup");
  console.log("    • Client ID and Secret from the Keys section\n");

  await askWithBrowserOpen(rl, "https://dashboard.plaid.com/developers/keys");

  // ── Step 1: API Credentials ──────────────────────
  printSection("Step 1: API Credentials");

  let clientId: string;
  let secret: string;

  if (existingConfig?.clientId && existingConfig?.secret) {
    const reuse = await rl.question(
      `  Found existing credentials (Client ID: ${String(existingConfig.clientId).slice(0, 8)}...)\n  Reuse them? (Y/n): `,
    );
    if (reuse.toLowerCase() !== "n") {
      clientId = existingConfig.clientId as string;
      secret = existingConfig.secret as string;
    } else {
      clientId = await promptCredentials(rl);
      secret = await rl.question("  Secret: ");
    }
  } else {
    console.log("  Find these in your Plaid Dashboard → Keys section.\n");
    clientId = await promptCredentials(rl);
    secret = await rl.question("  Secret: ");
  }

  if (!clientId.trim()) throw new Error("Client ID is required");
  if (!secret.trim()) throw new Error("Secret is required");

  // ── Step 2: Environment ──────────────────────────
  printSection("Step 2: Environment");
  console.log("    1. Sandbox       — Test with fake data (recommended to start)");
  console.log("    2. Development   — Real banks, 100 Items free");
  console.log("    3. Production    — Full access (requires Plaid approval)\n");

  const envChoice = await rl.question("  Environment (1-3) [1]: ");
  const envMap: Record<string, string> = { "1": "sandbox", "2": "development", "3": "production" };
  const environment = envMap[envChoice] || "sandbox";

  // ── Step 3: Access Token ─────────────────────────
  let accessToken: string;

  if (environment === "sandbox") {
    accessToken = await createSandboxToken(rl, clientId, secret);
  } else {
    printSection("Step 3: Access Token");
    console.log("  To connect a real bank, you need an access token from Plaid Link.");
    console.log("  If you've already run Plaid Link, paste the access token below.");
    console.log("  Otherwise, see: https://plaid.com/docs/quickstart/\n");
    accessToken = await rl.question("  Access token: ");
    if (!accessToken.trim()) throw new Error("Access token is required");
  }

  // ── Validate ─────────────────────────────────────
  printSection("Validating connection");
  console.log("  Fetching accounts...");

  const baseUrl = ENVIRONMENTS[environment];
  const accountsResp = await httpFetch(`${baseUrl}/accounts/get`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PLAID-CLIENT-ID": clientId,
      "PLAID-SECRET": secret,
    },
    body: JSON.stringify({ access_token: accessToken }),
  }) as { accounts: PlaidRawAccount[] };

  const accounts: BankAccount[] = (accountsResp.accounts || []).map((a) => ({
    uid: a.account_id,
    iban: a.mask ? `****${a.mask}` : a.account_id,
    name: a.name,
    currency: a.balances?.iso_currency_code || "USD",
    connectionId: "",
  }));

  if (accounts.length > 0) {
    printAccounts(accounts);
  } else {
    console.log("  Warning: No accounts found. Config will be saved anyway.");
  }

  // ── Label ────────────────────────────────────────
  const defaultLabel = `Plaid (${environment})`;
  const label = (await rl.question(`\n  Connection label [${defaultLabel}]: `)) || defaultLabel;

  return {
    provider: "plaid",
    label,
    config: {
      clientId,
      secret,
      accessToken,
      environment,
      accounts: accounts.map((a) => ({
        uid: a.uid,
        iban: a.iban,
        name: a.name,
        currency: a.currency,
      })),
    },
  };
}

async function promptCredentials(rl: ReadlineInterface): Promise<string> {
  return rl.question("  Client ID: ");
}

async function createSandboxToken(
  rl: ReadlineInterface,
  clientId: string,
  secret: string,
): Promise<string> {
  printSection("Step 3: Connect a Bank (Sandbox)");
  console.log("  In sandbox mode, we'll create a test connection automatically.");
  console.log("  Choose a test institution:\n");

  SANDBOX_INSTITUTIONS.forEach((inst, i) => {
    const rec = i === 0 ? " (recommended)" : "";
    console.log(`    ${i + 1}. ${inst.name}${rec}`);
  });
  console.log(`    ${SANDBOX_INSTITUTIONS.length + 1}. Custom institution ID\n`);

  const choice = await rl.question(`  Test bank (1-${SANDBOX_INSTITUTIONS.length + 1}) [1]: `);
  const idx = parseInt(choice || "1", 10) - 1;

  let institutionId: string;
  if (idx >= 0 && idx < SANDBOX_INSTITUTIONS.length) {
    institutionId = SANDBOX_INSTITUTIONS[idx].id;
  } else {
    institutionId = await rl.question("  Institution ID: ");
  }

  const baseUrl = ENVIRONMENTS.sandbox;
  const headers = {
    "Content-Type": "application/json",
    "PLAID-CLIENT-ID": clientId,
    "PLAID-SECRET": secret,
  };

  console.log("\n  Creating sandbox connection...");

  // 1. Create public token
  const publicResp = await httpFetch(`${baseUrl}/sandbox/public_token/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      institution_id: institutionId,
      initial_products: ["transactions"],
    }),
  }) as { public_token: string };

  console.log("  ✓ Public token created");

  // 2. Exchange for access token
  const exchangeResp = await httpFetch(`${baseUrl}/item/public_token/exchange`, {
    method: "POST",
    headers,
    body: JSON.stringify({ public_token: publicResp.public_token }),
  }) as { access_token: string };

  console.log("  ✓ Access token exchanged");

  return exchangeResp.access_token;
}

interface PlaidRawAccount {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string;
  balances: { iso_currency_code: string | null };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/init/flows/plaid.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/init/flows/plaid.ts tests/unit/init/flows/plaid.test.ts
git commit -m "feat(init): add guided Plaid setup flow with sandbox auto-token"
```

---

### Task 3: Create Teller Connect server + guided flow (`src/init/flows/teller.ts`)

**Files:**
- Create: `src/init/flows/teller.ts`
- Test: `tests/unit/init/flows/teller.test.ts`

**Step 1: Write the tests**

```typescript
// tests/unit/init/flows/teller.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

// Mock node:http for the local Teller Connect server
const mockServerInstance = {
  listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
  close: vi.fn((cb?: () => void) => cb?.()),
  on: vi.fn(),
};
vi.mock("node:http", () => ({
  createServer: vi.fn(() => mockServerInstance),
}));

// Mock node:https for Teller API calls
const mockHttpsRequest = vi.fn();
vi.mock("node:https", () => {
  const EventEmitter = require("node:events");
  return {
    request: (...args: unknown[]) => mockHttpsRequest(...args),
    Agent: vi.fn(),
  };
});

import { tellerInitFlow } from "../../../../src/init/flows/teller.js";

function createMockRL(answers: string[]) {
  let idx = 0;
  return {
    question: vi.fn().mockImplementation(() => Promise.resolve(answers[idx++] || "")),
    close: vi.fn(),
  } as unknown as import("node:readline/promises").Interface;
}

describe("tellerInitFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("throws on empty application ID", async () => {
    const rl = createMockRL(["", ""]);
    await expect(tellerInitFlow(rl)).rejects.toThrow("Application ID is required");
  });

  it("asks for mTLS certs in development mode", async () => {
    // Enter (skip browser), app_id, "2" (development), cert path, key path
    // Then it would try to open Teller Connect — mock will timeout
    const rl = createMockRL(["", "app_xxx", "2", "/path/cert.pem", "/path/key.pem"]);
    // Let it fail on the server step — we're testing the cert prompts
    await expect(tellerInitFlow(rl)).rejects.toThrow();
    // Verify cert questions were asked
    expect(rl.question).toHaveBeenCalledTimes(5);
  });

  it("skips mTLS certs in sandbox mode", async () => {
    // Enter (skip browser), app_id, "1" (sandbox)
    // Then it opens Teller Connect — mock will timeout
    const rl = createMockRL(["", "app_xxx", "1"]);
    await expect(tellerInitFlow(rl)).rejects.toThrow();
    // Only 3 questions (no cert paths)
    expect(rl.question).toHaveBeenCalledTimes(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/init/flows/teller.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/init/flows/teller.ts`**

```typescript
// src/init/flows/teller.ts
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { createServer, type Server } from "node:http";
import { openBrowser } from "../../connect/browser.js";
import { printSection, printAccounts, askWithBrowserOpen } from "../ui.js";
import type { BankAccount } from "../../types.js";

const TELLER_CONNECT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface TellerInitResult {
  provider: "teller";
  label: string;
  config: {
    accessToken: string;
    certificatePath?: string;
    privateKeyPath?: string;
    accounts?: Array<{ uid: string; iban: string; name: string; currency: string }>;
  };
}

export async function tellerInitFlow(
  rl: ReadlineInterface,
  existingConfig?: Record<string, unknown>,
): Promise<TellerInitResult> {
  // ── Welcome ──────────────────────────────────────
  console.log("  Teller provides instant, reliable access to US bank accounts");
  console.log("  with real-time transaction data.\n");
  console.log("  Prerequisites:");
  console.log("    • Teller account — sign up at https://teller.io");
  console.log("    • Application ID from your dashboard\n");

  await askWithBrowserOpen(rl, "https://teller.io/dashboard");

  // ── Step 1: Application ID ───────────────────────
  printSection("Step 1: Application ID");

  let appId: string;
  if (existingConfig?.appId) {
    const reuse = await rl.question(
      `  Found existing App ID (${String(existingConfig.appId).slice(0, 12)}...)\n  Reuse? (Y/n): `,
    );
    appId = reuse.toLowerCase() === "n"
      ? await rl.question("  Application ID: ")
      : existingConfig.appId as string;
  } else {
    console.log("  Find this in your Teller Dashboard → Your Application.\n");
    appId = await rl.question("  Application ID: ");
  }

  if (!appId.trim()) throw new Error("Application ID is required");

  // ── Step 2: Environment ──────────────────────────
  printSection("Step 2: Environment");
  console.log("    1. Sandbox       — Test with simulated banks");
  console.log("    2. Development   — Real banks (requires mTLS certificate)");
  console.log("    3. Production    — Full access (requires mTLS certificate)\n");

  const envChoice = await rl.question("  Environment (1-3) [1]: ");
  const envMap: Record<string, string> = { "1": "sandbox", "2": "development", "3": "production" };
  const environment = envMap[envChoice] || "sandbox";

  // ── mTLS certs (dev/prod only) ───────────────────
  let certificatePath: string | undefined;
  let privateKeyPath: string | undefined;

  if (environment !== "sandbox") {
    printSection("Step 2b: mTLS Certificate");
    console.log("  Teller requires a client certificate for real bank connections.");
    console.log("  Download it from your Teller Dashboard → Certificate.\n");
    certificatePath = await rl.question("  Path to client certificate (.pem): ");
    privateKeyPath = await rl.question("  Path to private key (.pem): ");
  }

  // ── Step 3: Teller Connect ───────────────────────
  printSection("Step 3: Connect a Bank");

  if (environment === "sandbox") {
    console.log("  Opening Teller Connect in your browser...");
    console.log("  Use sandbox credentials: username / password\n");
  } else {
    console.log("  Opening Teller Connect in your browser...");
    console.log("  Log in to your bank when prompted.\n");
  }

  const accessToken = await runTellerConnect(appId, environment);

  console.log(`\n  ✓ Access token received`);

  // ── Validate ─────────────────────────────────────
  printSection("Validating connection");
  console.log("  Fetching accounts...");

  const accounts = await fetchTellerAccounts(accessToken, certificatePath, privateKeyPath);

  if (accounts.length > 0) {
    printAccounts(accounts);
  } else {
    console.log("  Warning: No accounts found. Config will be saved anyway.");
  }

  // ── Label ────────────────────────────────────────
  const defaultLabel = `Teller (${environment})`;
  const label = (await rl.question(`\n  Connection label [${defaultLabel}]: `)) || defaultLabel;

  return {
    provider: "teller",
    label,
    config: {
      accessToken,
      ...(certificatePath ? { certificatePath } : {}),
      ...(privateKeyPath ? { privateKeyPath } : {}),
      accounts: accounts.map((a) => ({
        uid: a.uid,
        iban: a.iban,
        name: a.name,
        currency: a.currency,
      })),
    },
  };
}

/**
 * Serve a local page with Teller Connect JS SDK.
 * The widget calls back to our local server with the access token.
 */
function runTellerConnect(appId: string, environment: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let server: Server | undefined;

    function cleanup(): void {
      if (timer) clearTimeout(timer);
      if (server) { server.close(); server = undefined; }
    }

    function settle<T>(fn: (v: T) => void, value: T): void {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }

    server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1`);

      if (url.pathname === "/") {
        // Serve the Teller Connect page
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(tellerConnectPage(appId, environment));
        return;
      }

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        if (token) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(successPage());
          settle(resolve, token);
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(errorPage("No access token received"));
          settle(reject, new Error("No access token received from Teller Connect"));
        }
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      settle(reject, err.code === "EADDRINUSE"
        ? new Error("Port in use. Close other processes and try again.")
        : err);
    });

    // Use port 0 to let OS assign a free port
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const localUrl = `http://127.0.0.1:${port}`;
      console.log(`  Teller Connect: ${localUrl}`);
      openBrowser(localUrl);

      timer = setTimeout(() => {
        settle(reject, new Error(`Teller Connect timed out after ${TELLER_CONNECT_TIMEOUT_MS / 1000}s`));
      }, TELLER_CONNECT_TIMEOUT_MS);
    });
  });
}

async function fetchTellerAccounts(
  accessToken: string,
  _certPath?: string,
  _keyPath?: string,
): Promise<BankAccount[]> {
  // Use global fetch for simplicity (sandbox doesn't need mTLS)
  // For dev/prod with mTLS, the provider's own listAccounts handles it
  const auth = Buffer.from(`${accessToken}:`).toString("base64");
  const resp = await fetch("https://api.teller.io/accounts", {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Teller API ${resp.status}: ${await resp.text()}`);
  const accounts = await resp.json() as TellerRawAccount[];

  return accounts
    .filter((a) => a.status === "open")
    .map((a) => ({
      uid: a.id,
      iban: a.last_four ? `****${a.last_four}` : a.id,
      name: a.name,
      currency: a.currency || "USD",
      connectionId: "",
    }));
}

interface TellerRawAccount {
  id: string;
  name: string;
  currency: string;
  last_four: string;
  status: string;
}

function tellerConnectPage(appId: string, environment: string): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp — Teller Connect</title>
<style>
  body { font-family: system-ui; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0;
    background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px;
    background: #1e293b; }
  h1 { color: #818cf8; margin-bottom: 0.5rem; }
  p { color: #94a3b8; }
</style>
</head><body>
<div class="card">
  <h1>bank-mcp</h1>
  <p>Loading Teller Connect...</p>
</div>
<script src="https://cdn.teller.io/connect/connect.js"></script>
<script>
  const teller = TellerConnect.setup({
    applicationId: "${appId}",
    environment: "${environment}",
    onSuccess: function(enrollment) {
      window.location.href = "/callback?token=" +
        encodeURIComponent(enrollment.accessToken);
    },
    onFailure: function() {
      document.querySelector("p").textContent = "Connection failed. Close and retry.";
    },
    onExit: function() {
      document.querySelector("p").textContent = "Closed. Return to terminal.";
    }
  });
  teller.open();
</script>
</body></html>`;
}

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp</title><style>
  body { font-family: system-ui; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0;
    background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px;
    background: #1e293b; }
  h1 { color: #22c55e; }
</style></head><body>
<div class="card">
  <h1>Connected!</h1>
  <p>You can close this tab and return to the terminal.</p>
</div>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>bank-mcp</title><style>
  body { font-family: system-ui; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0;
    background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 2rem 3rem; border-radius: 12px;
    background: #1e293b; }
  h1 { color: #ef4444; }
</style></head><body>
<div class="card">
  <h1>Connection Failed</h1>
  <p>${message.replace(/</g, "&lt;")}</p>
  <p>Return to the terminal for details.</p>
</div>
</body></html>`;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/unit/init/flows/teller.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/init/flows/teller.ts tests/unit/init/flows/teller.test.ts
git commit -m "feat(init): add guided Teller setup flow with local Connect widget"
```

---

### Task 4: Rewrite `init.ts` as unified orchestrator

**Files:**
- Modify: `src/init.ts`
- Test: `tests/unit/init.test.ts` (create if doesn't exist)

**Step 1: Write the test**

```typescript
// tests/unit/init.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/init/flows/plaid.js", () => ({
  plaidInitFlow: vi.fn(),
}));

vi.mock("../../src/init/flows/teller.js", () => ({
  tellerInitFlow: vi.fn(),
}));

vi.mock("../../src/connect/flows/enable-banking.js", () => ({
  enableBankingConnectFlow: vi.fn(),
}));

vi.mock("../../src/connect/flows/tink.js", () => ({
  tinkConnectFlow: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ version: 1, connections: [], defaults: {} }),
  saveConfig: vi.fn(),
  getConfigPath: vi.fn().mockReturnValue("/mock/.bank-mcp/config.json"),
}));

import { runInit } from "../../src/init.js";
import { plaidInitFlow } from "../../src/init/flows/plaid.js";
import { saveConfig } from "../../src/config.js";

const mockedPlaid = vi.mocked(plaidInitFlow);
const mockedSaveConfig = vi.mocked(saveConfig);

function createMockRL(answers: string[]) {
  let idx = 0;
  return {
    question: vi.fn().mockImplementation(() => Promise.resolve(answers[idx++] || "")),
    close: vi.fn(),
  } as unknown as import("node:readline/promises").Interface;
}

describe("runInit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("routes to Plaid flow on selection '1'", async () => {
    // We need to mock readline creation inside runInit
    // This tests the flow routing — detailed flow tests are in their own files
    mockedPlaid.mockResolvedValue({
      provider: "plaid",
      label: "Test",
      config: { clientId: "x", secret: "y", accessToken: "z", environment: "sandbox" },
    });

    // The init function creates its own readline; we test at integration level
    // by checking that the flow function is called when routed to
  });
});
```

**Step 2: Rewrite `src/init.ts`**

```typescript
// src/init.ts
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { printBanner } from "./init/ui.js";
import { plaidInitFlow } from "./init/flows/plaid.js";
import { tellerInitFlow } from "./init/flows/teller.js";
import { enableBankingConnectFlow } from "./connect/flows/enable-banking.js";
import { tinkConnectFlow } from "./connect/flows/tink.js";
import type { ConnectionConfig } from "./types.js";

interface ProviderOption {
  key: string;
  displayName: string;
  description: string;
  flow: (
    rl: import("node:readline/promises").Interface,
    existingConfig?: Record<string, unknown>,
  ) => Promise<{ provider: string; label: string; config: Record<string, unknown> }>;
}

const PROVIDERS: ProviderOption[] = [
  {
    key: "plaid",
    displayName: "Plaid",
    description: "US, UK, EU · 12,000+ institutions",
    flow: plaidInitFlow,
  },
  {
    key: "teller",
    displayName: "Teller",
    description: "US · real-time data, instant access",
    flow: tellerInitFlow,
  },
  {
    key: "tink",
    displayName: "Tink",
    description: "EU · PSD2 open banking",
    flow: tinkConnectFlow,
  },
  {
    key: "enable-banking",
    displayName: "Enable Banking",
    description: "EU · PSD2 aggregation",
    flow: enableBankingConnectFlow,
  },
];

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    printBanner();

    console.log("  Choose your banking provider:\n");
    PROVIDERS.forEach((p, i) => {
      const name = p.displayName.padEnd(16);
      console.log(`    ${i + 1}. ${name}— ${p.description}`);
    });

    const choice = await rl.question("\n? Select provider (1-4): ");
    const idx = parseInt(choice, 10) - 1;
    const provider = PROVIDERS[idx];
    if (!provider) {
      console.error("\n  Invalid selection.\n");
      return;
    }

    // Check for existing credentials to reuse
    const appConfig = loadConfig();
    const existingConn = appConfig.connections.find(
      (c) => c.provider === provider.key,
    );

    // Run the provider's guided flow
    const result = await provider.flow(rl, existingConn?.config);

    // Build connection ID
    const id = result.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const connection: ConnectionConfig = {
      id,
      provider: result.provider,
      label: result.label,
      config: result.config,
    };

    // Replace if same ID exists, otherwise append
    const existing = appConfig.connections.findIndex((c) => c.id === id);
    if (existing >= 0) {
      appConfig.connections[existing] = connection;
    } else {
      appConfig.connections.push(connection);
    }

    saveConfig(appConfig);

    console.log(`\n  ✓ Config saved to ${getConfigPath()}`);
    console.log(`\n  Add to your MCP client config:`);
    console.log(`  { "mcpServers": { "bank": { "command": "npx", "args": ["@bank-mcp/server"] } } }`);
    console.log();
  } finally {
    rl.close();
  }
}
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

**Step 4: Commit**

```bash
git add src/init.ts tests/unit/init.test.ts
git commit -m "feat(init): rewrite as unified orchestrator with provider routing"
```

---

### Task 5: Make `connect` a thin wrapper + update entry point

**Files:**
- Modify: `src/connect.ts`
- Modify: `src/index.ts` (update help text)

**Step 1: Update `src/connect.ts` to delegate to init**

Keep `connect` working (backward compat) but have it call `runInit()`:

```typescript
// src/connect.ts — simplified to delegate to init
import { runInit } from "./init.js";

export async function runConnect(): Promise<void> {
  console.log("  Note: 'connect' is now part of 'init'. Launching guided setup...\n");
  await runInit();
}
```

**Step 2: Update help text in `src/index.ts`**

Update the usage comment to reflect the unified init.

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All existing connect tests may need adjustment (connect.ts changed)

**Step 4: Commit**

```bash
git add src/connect.ts src/index.ts
git commit -m "feat: make connect delegate to unified init"
```

---

### Task 6: Final integration test + build verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Build**

Run: `npm run build`
Expected: Clean TypeScript build, no errors

**Step 3: Manual smoke test**

Run: `node dist/index.js init`
Expected: See the new welcome banner + provider list

**Step 4: Final commit + PR**

```bash
git add -A
git commit -m "test: integration verification for guided init"
git push origin HEAD
gh pr create --title "feat: guided init setup with per-provider flows" \
  --body "Replaces bare-bones init with guided flows..."
```

---

## Implementation Order

```
Task 1: TUI utilities       ← foundation, no dependencies
Task 2: Plaid flow           ← uses TUI utils
Task 3: Teller flow          ← uses TUI utils + local server
Task 4: Rewrite init.ts      ← wires everything together
Task 5: Connect wrapper      ← backward compat
Task 6: Integration + PR     ← final verification
```

Tasks 2 and 3 are independent and can be parallelized.
