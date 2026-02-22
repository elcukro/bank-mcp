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

import { tellerInitFlow } from "../../../../src/init/flows/teller.js";
import type { Interface as ReadlineInterface } from "node:readline/promises";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createMockRL(answers: string[]) {
  let idx = 0;
  return {
    question: vi.fn().mockImplementation(() => Promise.resolve(answers[idx++] ?? "")),
    close: vi.fn(),
  } as unknown as ReadlineInterface;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("tellerInitFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("throws on empty application ID", async () => {
    // Answers: skip browser open, empty app ID
    const rl = createMockRL(["", ""]);

    await expect(tellerInitFlow(rl)).rejects.toThrow("Application ID is required");
  });

  it("asks for mTLS certs in development mode", async () => {
    // Answers: skip browser, app_id, env "2" (development), cert path, key path
    // The flow will then try to start the server — which hangs (mocked listen
    // calls cb but serveTellerConnect never resolves since no HTTP request comes).
    // We just verify the questions were asked.
    const rl = createMockRL([
      "",              // skip browser open
      "app_test_123",  // application ID
      "2",             // environment = development
      "/path/cert.pem", // certificate path
      "/path/key.pem",  // private key path
    ]);

    // The promise will never resolve (server waits for callback), so we race
    // with a short timer and check the questions that were asked.
    const result = await Promise.race([
      tellerInitFlow(rl).catch(() => "error"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    // Should have timed out because the server is waiting for callback
    expect(result).toBe("timeout");

    // Verify all 5 questions were asked
    expect(rl.question).toHaveBeenCalledTimes(5);

    // Check that cert/key questions were asked (calls 4 and 5)
    const calls = (rl.question as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[3][0]).toContain("Certificate path");
    expect(calls[4][0]).toContain("Private key path");
  });

  it("skips mTLS certs in sandbox mode", async () => {
    // Answers: skip browser, app_id, env "1" (sandbox)
    // No cert questions should follow.
    const rl = createMockRL([
      "",              // skip browser open
      "app_test_456",  // application ID
      "1",             // environment = sandbox
    ]);

    const result = await Promise.race([
      tellerInitFlow(rl).catch(() => "error"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(result).toBe("timeout");

    // Only 3 questions: browser open, app ID, environment
    expect(rl.question).toHaveBeenCalledTimes(3);
  });
});
