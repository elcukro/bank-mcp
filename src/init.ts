import * as p from "@clack/prompts";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";
import { printBanner, handleCancel } from "./init/ui.js";
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

/**
 * Interactive setup wizard — unified orchestrator that routes to
 * provider-specific guided flows.
 */
export async function runInit(): Promise<void> {
  printBanner();

  const providerKey = await p.select({
    message: "Choose your banking provider",
    options: PROVIDERS.map((prov) => ({
      value: prov.key,
      label: prov.displayName,
      hint: prov.description,
    })),
  });
  handleCancel(providerKey);

  const provider = PROVIDERS.find((prov) => prov.key === providerKey)!;

  // Check for existing credentials to reuse
  const appConfig = loadConfig();
  const existingConn = appConfig.connections.find(
    (c) => c.provider === provider.key,
  );

  // Run the provider's guided flow
  const result = await provider.flow(existingConn?.config);

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

  p.log.success(`Config saved to ${getConfigPath()}`);

  const client = await p.select({
    message: "Add bank-mcp to your MCP client",
    options: [
      { value: "claude", label: "Claude Code", hint: "auto-configure via CLI" },
      { value: "cursor", label: "Cursor" },
      { value: "windsurf", label: "Windsurf" },
      { value: "gemini", label: "Gemini CLI" },
      { value: "codex", label: "Codex CLI" },
      { value: "skip", label: "Skip", hint: "I'll configure it manually" },
    ],
  });
  handleCancel(client);

  const mcpJson = JSON.stringify(
    { "mcpServers": { "bank": { "command": "npx", "args": ["@bank-mcp/server"] } } },
    null,
    2,
  );

  switch (client) {
    case "claude":
      p.note(
        "Run this command:\n\n" +
        "  claude mcp add bank -- npx @bank-mcp/server",
        "Claude Code",
      );
      break;
    case "cursor":
      p.note(
        "Add to .cursor/mcp.json:\n\n" + mcpJson,
        "Cursor",
      );
      break;
    case "windsurf":
      p.note(
        "Add to ~/.codeium/windsurf/mcp_config.json:\n\n" + mcpJson,
        "Windsurf",
      );
      break;
    case "gemini":
      p.note(
        "Add to ~/.gemini/settings.json:\n\n" + mcpJson,
        "Gemini CLI",
      );
      break;
    case "codex":
      p.note(
        "Add to ~/.codex/config.json:\n\n" + mcpJson,
        "Codex CLI",
      );
      break;
  }

  p.outro("Setup complete!");
}
