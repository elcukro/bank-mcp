# Contributing to bank-mcp

## Adding a New Provider

The most impactful contribution is adding support for a new banking API.

### Steps

1. **Create the provider directory**: `src/providers/your-provider/`

2. **Implement the provider class** (`index.ts`):

```typescript
import { BankProvider } from "../base.js";
import type { BankAccount, Transaction, Balance, TransactionFilter, ConfigField } from "../../types.js";

export class YourProvider extends BankProvider {
  readonly name = "your-provider";
  readonly displayName = "Your Bank Service";

  validateConfig(config: Record<string, unknown>): void {
    // Check required fields exist
  }

  getConfigSchema(): ConfigField[] {
    return [
      { name: "apiKey", label: "API Key", type: "string", required: true, secret: true },
    ];
  }

  async listAccounts(config: Record<string, unknown>): Promise<BankAccount[]> {
    // Call your API, map to BankAccount[]
  }

  async listTransactions(
    config: Record<string, unknown>,
    accountId: string,
    filter?: TransactionFilter,
  ): Promise<Transaction[]> {
    // Fetch & normalize transactions
  }

  async getBalance(
    config: Record<string, unknown>,
    accountId: string,
  ): Promise<Balance[]> {
    // Fetch & normalize balances
  }
}
```

3. **Register it** in `src/providers/registry.ts`:

```typescript
import { YourProvider } from "./your-provider/index.js";
register(new YourProvider());
```

4. **Add tests** with mocked HTTP responses in `tests/unit/providers/your-provider.test.ts`

5. **Add fixtures** — sanitized API responses in `tests/fixtures/your-provider/`

### Key principles

- **Normalize everything** — map provider-specific fields to the standard `Transaction`, `Balance`, `BankAccount` types
- **Handle pagination** — fetch all pages before returning
- **Amount signs** — expenses should be negative, income positive
- **Description** — use the most human-readable field as `description`, raw data in `reference`
- **No new dependencies** unless absolutely necessary — use the `httpFetch` utility

### Running tests

```bash
npm test                    # All tests
npm test -- --watch         # Watch mode
npm test -- --reporter=verbose  # Detailed output
```

### Code style

- TypeScript strict mode
- ESM imports (`.js` extensions in import paths)
- No classes where functions suffice
- Errors as structured JSON in tool responses (not thrown MCP errors)

## Bug Reports & Feature Requests

Open an issue on GitHub with:
- What you expected
- What happened
- Steps to reproduce
- Provider name (if relevant)
