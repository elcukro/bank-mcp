import { z } from "zod";
import { loadConfig, getConnection, getAllConnections } from "../config.js";
import { getProvider } from "../providers/registry.js";
import { cache, TTL } from "../utils/cache.js";
import type { BankAccount } from "../types.js";

export const listAccountsSchema = z.object({
  connectionId: z
    .string()
    .optional()
    .describe("Connection ID to query. If omitted, queries all connections."),
});

export async function listAccounts(
  args: z.infer<typeof listAccountsSchema>,
): Promise<BankAccount[]> {
  const config = loadConfig();

  const connections = args.connectionId
    ? [getConnection(config, args.connectionId)]
    : getAllConnections(config);

  const allAccounts: BankAccount[] = [];

  for (const conn of connections) {
    const cacheKey = `accounts:${conn.id}`;
    const cached = cache.get<BankAccount[]>(cacheKey);
    if (cached) {
      allAccounts.push(...cached);
      continue;
    }

    const provider = getProvider(conn.provider);
    const accounts = await provider.listAccounts(conn.config);

    // Tag each account with its connection
    const tagged = accounts.map((a) => ({ ...a, connectionId: conn.id }));
    cache.set(cacheKey, tagged, TTL.ACCOUNTS);
    allAccounts.push(...tagged);
  }

  return allAccounts;
}
