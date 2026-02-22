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
  ) => Promise<{
    provider: string;
    label: string;
    config: Record<string, unknown>;
  }>;
}

const PROVIDERS: ProviderOption[] = [
  {
    key: "plaid",
    displayName: "Plaid",
    description: "US, UK, EU \u00b7 12,000+ institutions",
    flow: plaidInitFlow,
  },
  {
    key: "teller",
    displayName: "Teller",
    description: "US \u00b7 real-time data, instant access",
    flow: tellerInitFlow,
  },
  {
    key: "tink",
    displayName: "Tink",
    description: "EU \u00b7 PSD2 open banking",
    flow: tinkConnectFlow,
  },
  {
    key: "enable-banking",
    displayName: "Enable Banking",
    description: "EU \u00b7 PSD2 aggregation",
    flow: enableBankingConnectFlow,
  },
];

/**
 * Interactive setup wizard — unified orchestrator that routes to
 * provider-specific guided flows.
 */
export async function runInit(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    printBanner();

    console.log("  Choose your banking provider:\n");
    PROVIDERS.forEach((p, i) => {
      const name = p.displayName.padEnd(16);
      console.log(`    ${i + 1}. ${name}\u2014 ${p.description}`);
    });

    const choice = await rl.question(
      `\n? Select provider (1-${PROVIDERS.length}): `,
    );
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

    // Build connection ID (slug from label)
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

    console.log(`\n  \u2713 Config saved to ${getConfigPath()}`);
    console.log(`\n  Add to your MCP client config:`);
    console.log(
      `  { "mcpServers": { "bank": { "command": "npx", "args": ["@bank-mcp/server"] } } }`,
    );
    console.log();
  } finally {
    rl.close();
  }
}
