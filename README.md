# bank-mcp

Banking data MCP server — give your AI assistant read-only access to bank accounts, transactions, and balances through pluggable provider adapters.

## Quick Start

### 1. Configure a bank connection

```bash
npx @bank-mcp/server init
```

This walks you through connecting your bank. Currently supported:

| Provider | Coverage | Auth |
|----------|----------|------|
| **Enable Banking (PSD2)** | 2000+ European banks | RSA key + session |
| **Teller (US)** | 7000+ US banks | mTLS certificate + access token |
| **Plaid (US/CA/EU)** | 12,000+ institutions | Client ID + secret + access token |
| **Mock** | Demo data | None |

### 2. Add to your MCP client

**Claude Code** (`.mcp.json`):
```json
{
  "mcpServers": {
    "bank": {
      "command": "npx",
      "args": ["@bank-mcp/server"]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "bank": {
      "command": "npx",
      "args": ["@bank-mcp/server"]
    }
  }
}
```

### 3. Try it

```
You: "What's my account balance?"
You: "Show my spending by merchant this month"
You: "Search for salary payments in the last 90 days"
```

### Demo mode (no bank needed)

```bash
npx @bank-mcp/server --mock
```

Starts with realistic fake data — great for testing your setup.

## Tools

| Tool | Description |
|------|-------------|
| `list_accounts` | List all bank accounts across connections |
| `list_transactions` | Transactions with date, amount, and type filters |
| `search_transactions` | Full-text search on descriptions and merchant names |
| `get_balance` | Current account balances |
| `spending_summary` | Group expenses by merchant or category |

## Architecture

```
~/.bank-mcp/
  config.json          # Connections & settings (permissions: 600)
  keys/                # RSA keys for providers that need them

src/
  providers/
    base.ts            # Abstract BankProvider class
    enable-banking/    # PSD2 via Enable Banking API
    mock/              # Deterministic fake data
  tools/               # MCP tool implementations
  utils/
    cache.ts           # In-memory TTL cache
    http.ts            # Fetch with timeout + retry
```

### Provider Interface

All providers implement the same interface:

```typescript
abstract class BankProvider {
  abstract listAccounts(config): Promise<BankAccount[]>;
  abstract listTransactions(config, accountId, filter?): Promise<Transaction[]>;
  abstract getBalance(config, accountId): Promise<Balance[]>;
  abstract getConfigSchema(): ConfigField[];
}
```

### Caching

In-memory (dies with the process):
- Account list: 1 hour
- Transactions: 15 minutes
- Balances: 5 minutes

### Multiple Connections

You can configure multiple bank connections (even across providers):

```json
{
  "connections": [
    { "id": "ing-main", "provider": "enable-banking", ... },
    { "id": "mbank-savings", "provider": "enable-banking", ... }
  ]
}
```

Tools accept an optional `connectionId` to target a specific connection. If omitted, all connections are queried.

## Adding a New Provider

1. Create `src/providers/your-provider/index.ts`
2. Extend `BankProvider` — implement all abstract methods
3. Register in `src/providers/registry.ts`
4. Add config schema fields for the init wizard

See `src/providers/enable-banking/` as a reference implementation.

## Enable Banking Setup

You need:
1. An [Enable Banking](https://enablebanking.com) account with an app
2. Your RSA private key (`.pem` file)
3. An active session ID (from the OAuth consent flow)

```bash
npx @bank-mcp/server init
# Select: Enable Banking (PSD2)
# Enter: App ID, key path, session ID
```

The init wizard validates your credentials by fetching accounts.

## Teller Setup

You need:
1. A [Teller](https://teller.io) developer account
2. Your client certificate and private key (downloaded as `.zip` from the Teller dashboard)
3. An access token from a Teller Connect enrollment

```bash
# Extract your certificate
mkdir -p ~/.bank-mcp/keys/teller
unzip ~/Downloads/teller.zip -d ~/.bank-mcp/keys/teller/
chmod 600 ~/.bank-mcp/keys/teller/*.pem

# Run setup
npx @bank-mcp/server init
# Select: Teller (US Banks)
# Enter: certificate path, key path, access token
```

Teller uses **mutual TLS** (mTLS) — your app authenticates at the TLS layer via client certificate, then individual enrollments authenticate via HTTP Basic Auth with the access token. Free tier supports up to 100 live connections.

## Plaid Setup

You need:
1. A [Plaid](https://plaid.com) developer account (free signup)
2. Your Client ID and Secret (from the Plaid dashboard)
3. An access token from a Plaid Link enrollment

```bash
npx @bank-mcp/server init
# Select: Plaid (US/CA/EU)
# Enter: client ID, secret, access token, environment
```

Plaid supports three environments: `sandbox` (fake data, instant), `development` (100 live Items, needs approval), and `production` (unlimited, needs security review). Start with sandbox to test your setup. Plaid provides the richest transaction categorization (104 sub-categories with confidence scores) — ideal for LLM-driven analysis.

## Development

```bash
git clone https://github.com/elcukro/bank-mcp.git
cd bank-mcp
npm install
npm test          # Run tests
npm run build     # Compile TypeScript
npm run dev       # Watch mode
```

## License

MIT
