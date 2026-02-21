import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { listProviders, getProvider } from "./providers/registry.js";
import type { ConnectionConfig } from "./types.js";

/**
 * Interactive setup wizard — walks the user through configuring a
 * bank connection. Uses plain readline (no heavy dependencies).
 */
export async function runInit(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("\n  bank-mcp — Banking data for your AI assistant\n");

    // 1. Select provider
    const providers = listProviders();
    console.log("  Available providers:");
    providers.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.displayName}`);
    });

    const providerIdx =
      parseInt(await rl.question("\n? Select provider (number): "), 10) - 1;
    const provider = providers[providerIdx];
    if (!provider) {
      console.error("  Invalid selection.");
      return;
    }

    // 2. Collect config fields
    const schema = provider.getConfigSchema();
    const config: Record<string, unknown> = {};

    for (const field of schema) {
      const label = field.required ? field.label : `${field.label} (optional)`;
      const defaultHint = field.default ? ` [${field.default}]` : "";
      const answer = await rl.question(`? ${label}${defaultHint}: `);
      config[field.name] = answer || field.default || "";
    }

    // 3. Connection label
    const label = await rl.question("? Connection label (e.g. ING Bank - Main): ");

    // 4. Connection ID (slug from label)
    const id = (label || provider.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // 5. Validate by fetching accounts
    console.log("\n  Validating connection...");
    try {
      provider.validateConfig(config);
      const accounts = await provider.listAccounts(config);

      if (accounts.length === 0) {
        console.log("  Warning: No accounts found. Config saved anyway.\n");
      } else {
        console.log(`  Found ${accounts.length} account(s):`);
        for (const acc of accounts) {
          console.log(`    - ${acc.iban} (${acc.name}, ${acc.currency})`);
        }

        // Store fetched accounts in config for faster subsequent access
        config.accounts = accounts.map((a) => ({
          uid: a.uid,
          iban: a.iban,
          name: a.name,
          currency: a.currency,
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Validation failed: ${msg}`);
      const proceed = await rl.question("  Save anyway? (y/N): ");
      if (proceed.toLowerCase() !== "y") return;
    }

    // 6. Save config
    const appConfig = loadConfig();
    const connection: ConnectionConfig = {
      id,
      provider: provider.name,
      label: label || provider.displayName,
      config,
    };

    // Replace if same ID exists, otherwise append
    const existing = appConfig.connections.findIndex((c) => c.id === id);
    if (existing >= 0) {
      appConfig.connections[existing] = connection;
    } else {
      appConfig.connections.push(connection);
    }

    saveConfig(appConfig);

    console.log(`\n  Config saved to ${getConfigPath()}`);
    console.log(`\n  Add to your MCP client config (.mcp.json):`);
    console.log(
      `  { "mcpServers": { "bank": { "command": "npx", "args": ["@bank-mcp/server"] } } }`,
    );
    console.log();
  } finally {
    rl.close();
  }
}
