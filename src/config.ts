import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { AppConfig, ConnectionConfig } from "./types.js";

const CONFIG_DIR = resolve(homedir(), ".bank-mcp");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  connections: [],
  defaults: { transactionDays: 90, currency: "PLN" },
};

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): AppConfig {
  // Mock mode: return a synthetic config with mock provider
  if (process.env.BANK_MCP_MOCK === "1") {
    return {
      version: 1,
      connections: [
        {
          id: "mock",
          provider: "mock",
          label: "Mock Bank (Demo)",
          config: {},
        },
      ],
      defaults: { transactionDays: 90, currency: "PLN" },
    };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as AppConfig;
  } catch {
    return { ...DEFAULT_CONFIG, connections: [] };
  }
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const data = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(CONFIG_PATH, data, { mode: 0o600 });
  // Ensure permissions even if file existed
  chmodSync(CONFIG_PATH, 0o600);
}

export function getConnection(
  config: AppConfig,
  connectionId?: string,
): ConnectionConfig {
  if (config.connections.length === 0) {
    throw new Error("No connections configured. Run: npx @bank-mcp/server init");
  }

  if (connectionId) {
    const conn = config.connections.find((c) => c.id === connectionId);
    if (!conn) {
      const ids = config.connections.map((c) => c.id).join(", ");
      throw new Error(
        `Connection "${connectionId}" not found. Available: ${ids}`,
      );
    }
    return conn;
  }

  // Default to first connection
  return config.connections[0];
}

export function getAllConnections(config: AppConfig): ConnectionConfig[] {
  return config.connections;
}

/**
 * Expand ~ in paths within a config object.
 */
export function expandPaths(config: Record<string, unknown>): Record<string, unknown> {
  const home = homedir();
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value.startsWith("~")) {
      result[key] = value.replace(/^~/, home);
    } else {
      result[key] = value;
    }
  }
  return result;
}
