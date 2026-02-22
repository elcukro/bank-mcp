import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  log: { step: vi.fn(), info: vi.fn() },
  note: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("../../../src/connect/browser.js", () => ({
  openBrowser: vi.fn(),
}));

import * as p from "@clack/prompts";
import { printBanner, printSection, printAccounts, askWithBrowserOpen } from "../../../src/init/ui.js";
import { openBrowser } from "../../../src/connect/browser.js";

const mockedOpenBrowser = vi.mocked(openBrowser);
const mockedConfirm = vi.mocked(p.confirm);

describe("TUI utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("printBanner calls p.intro with banner text", () => {
    printBanner();
    expect(p.intro).toHaveBeenCalledWith("bank-mcp — Connect your bank account");
  });

  it("printSection calls p.log.step", () => {
    printSection("Step 1: Credentials");
    expect(p.log.step).toHaveBeenCalledWith("Step 1: Credentials");
  });

  it("printAccounts formats account list as note", () => {
    printAccounts([
      { uid: "1", iban: "PL123", name: "Checking", currency: "PLN", connectionId: "" },
      { uid: "2", iban: "PL456", name: "Savings", currency: "PLN", connectionId: "" },
    ]);
    expect(p.note).toHaveBeenCalledWith(
      expect.stringContaining("PL123"),
      "Found 2 account(s)",
    );
  });

  it("askWithBrowserOpen opens browser when confirmed", async () => {
    mockedConfirm
      .mockResolvedValueOnce(true)   // open browser? yes
      .mockResolvedValueOnce(true);  // ready to continue? yes

    await askWithBrowserOpen("https://example.com");
    expect(mockedOpenBrowser).toHaveBeenCalledWith("https://example.com");
  });

  it("askWithBrowserOpen skips browser when declined", async () => {
    mockedConfirm.mockResolvedValueOnce(false); // open browser? no

    await askWithBrowserOpen("https://example.com");
    expect(mockedOpenBrowser).not.toHaveBeenCalled();
  });
});
