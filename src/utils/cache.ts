/**
 * Simple in-memory TTL cache.
 *
 * Dies with the process — no disk persistence.
 * TTLs: balances 5min, transactions 15min, accounts 1hr.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

// Singleton + TTL constants
export const cache = new Cache();

export const TTL = {
  ACCOUNTS: 60 * 60 * 1000, // 1 hour
  TRANSACTIONS: 15 * 60 * 1000, // 15 minutes
  BALANCES: 5 * 60 * 1000, // 5 minutes
} as const;
