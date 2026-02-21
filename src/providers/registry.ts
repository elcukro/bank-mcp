import type { BankProvider } from "./base.js";
import { EnableBankingProvider } from "./enable-banking/index.js";
import { MockProvider } from "./mock/index.js";

const providers = new Map<string, BankProvider>();

function register(provider: BankProvider): void {
  providers.set(provider.name, provider);
}

register(new EnableBankingProvider());
register(new MockProvider());

export function getProvider(name: string): BankProvider {
  const provider = providers.get(name);
  if (!provider) {
    const available = [...providers.keys()].join(", ");
    throw new Error(
      `Unknown provider "${name}". Available: ${available}`,
    );
  }
  return provider;
}

export function listProviders(): BankProvider[] {
  return [...providers.values()];
}
