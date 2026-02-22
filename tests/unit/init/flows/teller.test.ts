import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks — must be declared before imports                            */
/* ------------------------------------------------------------------ */

vi.mock("node:http", () => {
  const fakeServer = {
    listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
    close: vi.fn(),
    on: vi.fn(),
    address: vi.fn(() => ({ port: 54321 })),
  };
  return { createServer: vi.fn(() => fakeServer) };
});

vi.mock("../../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

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

import { tellerInitFlow } from "../../../../src/init/flows/teller.js";
import * as p from "@clack/prompts";

const setAnswers = (p as unknown as { __setAnswers: (a: unknown[]) => void }).__setAnswers;

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("tellerInitFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on empty application ID", async () => {
    setAnswers([
      false,  // askWithBrowserOpen: don't open
      "",     // p.text: empty application ID
    ]);

    await expect(tellerInitFlow()).rejects.toThrow("Application ID is required");
  });

  it("asks for mTLS certs in development mode", async () => {
    // Answers: skip browser, app_id, env development, cert path, key path
    // The flow will then try to start the server — which hangs (mocked listen
    // calls cb but serveTellerConnect never resolves since no HTTP request comes).
    setAnswers([
      false,              // askWithBrowserOpen: don't open
      "app_test_123",     // p.text: application ID
      "development",      // p.select: environment
      "/path/cert.pem",   // p.text: certificate path
      "/path/key.pem",    // p.text: private key path
    ]);

    // The promise will never resolve (server waits for callback), so we race
    // with a short timer and check the questions that were asked.
    const result = await Promise.race([
      tellerInitFlow().catch(() => "error"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    // Should have timed out because the server is waiting for callback
    expect(result).toBe("timeout");

    // Verify text was called for cert and key paths
    const textCalls = vi.mocked(p.text).mock.calls;
    const certCall = textCalls.find((c) => (c[0] as { message: string }).message.includes("Certificate"));
    const keyCall = textCalls.find((c) => (c[0] as { message: string }).message.includes("Private key"));
    expect(certCall).toBeTruthy();
    expect(keyCall).toBeTruthy();
  });

  it("skips mTLS certs in sandbox mode", async () => {
    setAnswers([
      false,              // askWithBrowserOpen: don't open
      "app_test_456",     // p.text: application ID
      "sandbox",          // p.select: environment
    ]);

    const result = await Promise.race([
      tellerInitFlow().catch(() => "error"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(result).toBe("timeout");

    // No cert/key text prompts should appear
    const textCalls = vi.mocked(p.text).mock.calls;
    const certCall = textCalls.find((c) => (c[0] as { message: string }).message.includes("Certificate"));
    expect(certCall).toBeUndefined();
  });
});
