import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

import { printBanner, printSection, printAccounts, askWithBrowserOpen } from "../../../src/init/ui.js";
import { openBrowser } from "../../../src/connect/browser.js";

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
