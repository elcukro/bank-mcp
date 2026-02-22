import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { listAccountsSchema, listAccounts } from "./tools/list-accounts.js";
import {
  listTransactionsSchema,
  listTransactions,
} from "./tools/list-transactions.js";
import {
  searchTransactionsSchema,
  searchTransactions,
} from "./tools/search-transactions.js";
import { getBalanceSchema, getBalance } from "./tools/get-balance.js";
import {
  spendingSummarySchema,
  spendingSummary,
} from "./tools/spending-summary.js";

const TOOLS = [
  {
    name: "list_accounts",
    description:
      "List all bank accounts across configured connections. Returns account UIDs, IBANs, names, and currencies.",
    inputSchema: z.toJSONSchema(listAccountsSchema),
  },
  {
    name: "list_transactions",
    description:
      "List bank transactions with optional filters. Defaults to last 90 days. Supports date range, amount range, and debit/credit type filtering.",
    inputSchema: z.toJSONSchema(listTransactionsSchema),
  },
  {
    name: "search_transactions",
    description:
      "Full-text search across transaction descriptions, merchant names, and references. Use for finding specific payments or payees.",
    inputSchema: z.toJSONSchema(searchTransactionsSchema),
  },
  {
    name: "get_balance",
    description:
      "Get current account balance(s). Returns closing booked balance and expected balance when available.",
    inputSchema: z.toJSONSchema(getBalanceSchema),
  },
  {
    name: "spending_summary",
    description:
      'Group expenses by merchant or category with totals. Shows where money is being spent. Use groupBy "merchant" for vendor breakdown, "category" for category breakdown.',
    inputSchema: z.toJSONSchema(spendingSummarySchema),
  },
];

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, ToolHandler> = {
  list_accounts: (args) => listAccounts(listAccountsSchema.parse(args)),
  list_transactions: (args) =>
    listTransactions(listTransactionsSchema.parse(args)),
  search_transactions: (args) =>
    searchTransactions(searchTransactionsSchema.parse(args)),
  get_balance: (args) => getBalance(getBalanceSchema.parse(args)),
  spending_summary: (args) =>
    spendingSummary(spendingSummarySchema.parse(args)),
};

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: "bank-mcp", version: "0.1.3" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];

    if (!handler) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: true, code: "unknown_tool", message: `Unknown tool: ${name}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler(args || {});
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Return structured error as text so LLMs can explain it
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: true, code: "tool_error", message }),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // All logging to stderr — stdout is the MCP wire protocol
  console.error("[bank-mcp] Server started");
}
