import * as p from "@clack/prompts";
import type { BankAccount } from "../types.js";
import { openBrowser } from "../connect/browser.js";

export function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
}

export function printBanner(): void {
  p.intro("bank-mcp — Connect your bank account");
}

export function printSection(title: string): void {
  p.log.step(title);
}

export function printAccounts(accounts: BankAccount[]): void {
  const lines = accounts.map((acc) => `  ${acc.iban} (${acc.name}, ${acc.currency})`);
  p.note(lines.join("\n"), `Found ${accounts.length} account(s)`);
}

export async function askWithBrowserOpen(url: string): Promise<void> {
  const shouldOpen = await p.confirm({
    message: `Open ${url} in your browser?`,
    initialValue: false,
  });
  handleCancel(shouldOpen);

  if (shouldOpen) {
    openBrowser(url);
    p.log.info(`Opened ${url}`);

    const ready = await p.confirm({
      message: "Ready to continue?",
      initialValue: true,
    });
    handleCancel(ready);
  }
}
