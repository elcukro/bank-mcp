/**
 * `bank-mcp connect` — Browser-based OAuth flow for linking bank accounts.
 *
 * Unlike `init` (which asks for a pre-existing session ID), `connect`
 * automates the entire browser authorization and returns a ready-to-use
 * session. Supports Enable Banking and Tink; other providers can be
 * added by creating a flow function and registering it in CONNECT_FLOWS.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { enableBankingConnectFlow } from "./connect/flows/enable-banking.js";
import { tinkConnectFlow } from "./connect/flows/tink.js";
import type { ConnectionConfig } from "./types.js";

interface ConnectProvider {
  name: string;
  displayName: string;
}

/** Generic result shape that all connect flows must return. */
interface ConnectResult {
  provider: string;
  label: string;
  config: Record<string, unknown>;
}

type ConnectFlowFn = (
  rl: import("node:readline/promises").Interface,
  existingConfig?: Record<string, unknown>,
) => Promise<ConnectResult>;

/**
 * Registry of providers that support browser-based connect flows.
 * To add a new provider: create src/connect/flows/<name>.ts, add here.
 */
const CONNECT_FLOWS: Map<string, { provider: ConnectProvider; flow: ConnectFlowFn }> =
  new Map([
    [
      "enable-banking",
      {
        provider: {
          name: "enable-banking",
          displayName: "Enable Banking (PSD2)",
        },
        flow: enableBankingConnectFlow,
      },
    ],
    [
      "tink",
      {
        provider: {
          name: "tink",
          displayName: "Tink (EU Open Banking)",
        },
        flow: tinkConnectFlow,
      },
    ],
  ]);

export async function runConnect(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("\n  bank-mcp connect — Link your bank account\n");

    // List providers with connect support
    const entries = [...CONNECT_FLOWS.values()];
    console.log("  Providers with automated setup:");
    entries.forEach((e, i) => {
      console.log(`    ${i + 1}. ${e.provider.displayName}`);
    });

    const providerIdx =
      parseInt(await rl.question("\n? Select provider: "), 10) - 1;
    const entry = entries[providerIdx];
    if (!entry) {
      console.error("  Invalid selection.");
      return;
    }

    // Check for existing credentials to reuse
    const appConfig = loadConfig();
    const existingConn = appConfig.connections.find(
      (c) => c.provider === entry.provider.name,
    );

    // Run the connect flow
    const result = await entry.flow(rl, existingConn?.config);

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
