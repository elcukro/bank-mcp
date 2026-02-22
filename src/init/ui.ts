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
