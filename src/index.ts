#!/usr/bin/env node

/**
 * bank-mcp — Banking data MCP server
 *
 * Usage:
 *   npx @bank-mcp/server            Start MCP server (for MCP clients)
 *   npx @bank-mcp/server init       Guided setup wizard (all providers)
 *   npx @bank-mcp/server connect    Alias for init (backward compat)
 *   npx @bank-mcp/server refresh    Re-fetch accounts for existing connections
 *   npx @bank-mcp/server --mock     Start with mock data (no config needed)
 */

import { startServer } from "./server.js";
import { runInit } from "./init.js";
import { runConnect } from "./connect.js";
import { runRefresh } from "./refresh.js";

const args = process.argv.slice(2);

if (args.includes("init")) {
  runInit().catch((err) => {
    console.error("Init failed:", err);
    process.exit(1);
  });
} else if (args.includes("connect")) {
  runConnect().catch((err) => {
    console.error("Connect failed:", err);
    process.exit(1);
  });
} else if (args.includes("refresh")) {
  runRefresh().catch((err) => {
    console.error("Refresh failed:", err);
    process.exit(1);
  });
} else if (args.includes("--mock")) {
  // Force mock provider: override config to use mock connection
  process.env.BANK_MCP_MOCK = "1";
  startServer().catch((err) => {
    console.error("Server failed:", err);
    process.exit(1);
  });
} else {
  startServer().catch((err) => {
    console.error("Server failed:", err);
    process.exit(1);
  });
}
