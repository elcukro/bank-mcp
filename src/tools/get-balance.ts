import { z } from "zod";
import { loadConfig, getConnection, getAllConnections } from "../config.js";
import { getProvider } from "../providers/registry.js";
import { cache, TTL } from "../utils/cache.js";
import type { Balance } from "../types.js";

export const getBalanceSchema = z.object({
  connectionId: z.string().optional(),
  accountId: z.string().optional().describe("Account UID. If omitted, returns balances for all accounts."),
});

export async function getBalance(
  args: z.infer<typeof getBalanceSchema>,
): Promise<Balance[]> {
  const config = loadConfig();

  const connections = args.connectionId
    ? [getConnection(config, args.connectionId)]
    : getAllConnections(config);

  const allBalances: Balance[] = [];

  for (const conn of connections) {
    const provider = getProvider(conn.provider);

    let accountIds: string[];
    if (args.accountId) {
      accountIds = [args.accountId];
    } else {
      const accounts = await provider.listAccounts(conn.config);
      accountIds = accounts.map((a) => a.uid);
    }

    for (const accId of accountIds) {
      const cacheKey = `bal:${conn.id}:${accId}`;
      const cached = cache.get<Balance[]>(cacheKey);
      if (cached) {
        allBalances.push(...cached);
        continue;
      }

      const balances = await provider.getBalance(conn.config, accId);
      cache.set(cacheKey, balances, TTL.BALANCES);
      allBalances.push(...balances);
    }
  }

  return allBalances;
}
