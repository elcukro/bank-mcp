# 🏦 bank-mcp

<p align="center">
  <img src="bank-mcp.png" alt="bank-mcp — Banking data for AI assistants" width="700">
</p>

**Give your AI assistant secure, read-only access to your bank accounts.**

[![npm version](https://img.shields.io/npm/v/@bank-mcp/server.svg)](https://www.npmjs.com/package/@bank-mcp/server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/elcukro/bank-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/elcukro/bank-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

---

Most people manage their finances by logging into bank portals, downloading CSVs, and building spreadsheets. bank-mcp eliminates that friction by letting your AI assistant query your bank accounts directly — balances, transactions, spending breakdowns — through natural conversation. It connects to real bank APIs via the [Model Context Protocol](https://modelcontextprotocol.io) so any MCP-compatible client (Claude Code, Claude Desktop, and others) can understand your finances.

- **5 providers, 15,000+ institutions** — US and European banks covered
- **Read-only by design** — no write access, no transfers, no modifications
- **Works with any MCP client** — Claude Code, Claude Desktop, Cursor, and more
- **Pluggable architecture** — add your own provider in under 100 lines

## Table of Contents

- [Supported Providers](#supported-providers)
- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Architecture](#architecture)
- [Provider Setup Guides](#provider-setup-guides)
- [Caching](#caching)
- [Multiple Connections](#multiple-connections)
- [Security & Privacy](#security--privacy)
- [Adding a New Provider](#adding-a-new-provider)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Supported Providers

| Provider | Region | Institutions | Auth Method | Setup Difficulty |
|----------|--------|-------------|-------------|-----------------|
| **[Enable Banking](https://enablebanking.com)** | Europe | 2,000+ | RSA key + session | Medium |
| **[Teller](https://teller.io)** | US | 7,000+ | mTLS certificate | Medium |
| **[Plaid](https://plaid.com)** | US / CA / EU | 12,000+ | Client ID + secret | Easy |
| **[Tink](https://tink.com)** | Europe | 3,400+ | OAuth2 token | Easy |
| **Mock** | Demo | — | None | Instant |

### US Banks

Supported through Plaid and Teller — covering the top 20 US institutions and thousands more:

JPMorgan Chase · Bank of America · Wells Fargo · Citibank · Capital One · U.S. Bank · PNC · Truist · Goldman Sachs · TD Bank · Citizens · Fifth Third · M&T Bank · Huntington · KeyBank · Ally · Regions · BMO · American Express · USAA

### European Banks

Supported through Enable Banking and Tink — covering major banks across the EU and UK:

HSBC · BNP Paribas · Deutsche Bank · ING · Crédit Agricole · Santander · Société Générale · UniCredit · Intesa Sanpaolo · Barclays · Lloyds · BBVA · CaixaBank · Commerzbank · Rabobank · ABN AMRO · Swedbank · Handelsbanken · Nordea · PKO Bank Polski

## Quick Start

### 1. Configure a bank connection

```bash
npx @bank-mcp/server init
```

The interactive wizard walks you through selecting a provider and entering credentials. It validates your connection by fetching accounts before saving.

### 2. Add to your MCP client

**Claude Code** (`.mcp.json` in your project root or `~/.claude/.mcp.json` globally):

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

Ask your AI assistant about your finances in natural language:

```
"What's my checking account balance?"
"Show my spending by category this month"
"Find all Amazon purchases over $50"
"Compare my spending this month vs last month"
```

### Demo Mode

Don't have bank credentials yet? Start with realistic fake data:

```bash
npx @bank-mcp/server --mock
```

This launches with a mock provider that generates deterministic sample accounts and transactions — perfect for testing your setup or building on top of bank-mcp before connecting real accounts.

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_accounts` | List all bank accounts across connections | `connectionId?` |
| `list_transactions` | Fetch transactions with filtering | `accountId`, `from?`, `to?`, `minAmount?`, `maxAmount?` |
| `search_transactions` | Full-text search on descriptions and merchants | `query`, `accountId?`, `from?`, `to?` |
| `get_balance` | Current and available balances | `accountId`, `connectionId?` |
| `spending_summary` | Expenses grouped by merchant or category | `accountId`, `from?`, `to?`, `groupBy?` |

### Example Conversations

Here's what real interactions look like:

**Checking balances:**
> **You:** What's in my bank accounts?
>
> **Claude:** You have 3 accounts across 2 connections:
> | Account | Balance | Available |
> |---------|---------|-----------|
> | ING Checking | €3,241.50 | €3,141.50 |
> | ING Savings | €12,800.00 | €12,800.00 |
> | Revolut Main | €891.23 | €891.23 |

**Spending analysis:**
> **You:** Show my spending by category this month
>
> **Claude:** Here's your spending breakdown for February 2026:
> | Category | Amount | Transactions |
> |----------|--------|-------------|
> | Groceries | €487.30 | 12 |
> | Restaurants | €213.50 | 8 |
> | Transport | €156.00 | 5 |
> | Subscriptions | €89.97 | 4 |

**Searching transactions:**
> **You:** Find all Amazon purchases over $50 in the last 3 months
>
> **Claude:** Found 7 Amazon transactions over $50 since November:
> - Dec 15: Amazon.com — $129.99 (Electronics)
> - Dec 3: Amazon.com — $67.50 (Books)
> - ...

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      MCP Client                              │
│              (Claude Code / Claude Desktop)                   │
└──────────────────────┬───────────────────────────────────────┘
                       │ MCP Protocol (stdio)
┌──────────────────────▼───────────────────────────────────────┐
│                    bank-mcp Server                            │
│                                                              │
│  ┌─────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Tools   │──│  Cache Layer │──│    Provider Registry     │ │
│  │         │  │  (in-memory) │  │                         │ │
│  │ • list_ │  │              │  │  ┌───────────────────┐  │ │
│  │   accts │  │  TTL-based   │  │  │ Enable Banking    │  │ │
│  │ • list_ │  │  per-entity  │  │  │ Teller            │  │ │
│  │   txns  │  │              │  │  │ Plaid             │  │ │
│  │ • search│  │              │  │  │ Tink              │  │ │
│  │ • get_  │  │              │  │  │ Mock              │  │ │
│  │   bal   │  │              │  │  │ (your provider)   │  │ │
│  │ • spend │  │              │  │  └───────────────────┘  │ │
│  └─────────┘  └──────────────┘  └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
     Enable Banking   Plaid     Teller      ...Bank APIs
```

### File Structure

```
~/.bank-mcp/
  config.json          # Connections & credentials (permissions: 600)
  keys/                # RSA keys and certificates

src/
  providers/
    base.ts            # Abstract BankProvider class
    registry.ts        # Provider registration
    enable-banking/    # PSD2 via Enable Banking API
    teller/            # US banks via mTLS
    plaid/             # US/CA/EU via Plaid API
    tink/              # EU Open Banking via Tink API
    mock/              # Deterministic fake data
  tools/               # MCP tool implementations
  utils/
    cache.ts           # In-memory TTL cache
    http.ts            # Fetch with timeout + retry
```

### Provider Interface

Every provider extends the same abstract class, making it straightforward to add new integrations:

```typescript
abstract class BankProvider {
  abstract listAccounts(config): Promise<BankAccount[]>;
  abstract listTransactions(config, accountId, filter?): Promise<Transaction[]>;
  abstract getBalance(config, accountId): Promise<Balance[]>;
  abstract getConfigSchema(): ConfigField[];
}
```

## Provider Setup Guides

### Enable Banking (PSD2)

**What you need:**
- [ ] An [Enable Banking](https://enablebanking.com) account with a registered app
- [ ] Your RSA private key (`.pem` file)
- [ ] An active session ID from the OAuth consent flow

```bash
npx @bank-mcp/server init
# Select: Enable Banking (PSD2)
# Enter: App ID, key path, session ID
```

> **Tip:** Sessions expire after 90 days (PSD2 regulation). You'll need to re-authenticate through the consent flow periodically. The server logs a clear message when a session expires.

### Teller (US Banks)

**What you need:**
- [ ] A [Teller](https://teller.io) developer account
- [ ] Your client certificate and private key (`.zip` download from the Teller dashboard)
- [ ] An access token from a Teller Connect enrollment

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

> **Tip:** Teller uses mutual TLS (mTLS) — your app authenticates at the TLS layer via client certificate, then individual enrollments authenticate via access token. Free tier supports up to 100 live connections.

### Plaid (US/CA/EU)

**What you need:**
- [ ] A [Plaid](https://plaid.com) developer account (free signup)
- [ ] Your Client ID and Secret (from the Plaid dashboard)
- [ ] An access token from a Plaid Link enrollment

```bash
npx @bank-mcp/server init
# Select: Plaid (US/CA/EU)
# Enter: client ID, secret, access token, environment
```

> **Tip:** Start with the `sandbox` environment (fake data, instant setup). Plaid provides the richest transaction categorization — 104 sub-categories with confidence scores — which makes it ideal for LLM-driven spending analysis.

### Tink (EU Open Banking)

**What you need:**
- [ ] A [Tink](https://tink.com) developer account (free for testing)
- [ ] An OAuth2 access token (from the Tink Console or your OAuth2 flow)

```bash
npx @bank-mcp/server init
# Select: Tink (EU Open Banking)
# Enter: access token
```

> **Tip:** Tink covers 3,400+ banks across Europe. Transactions include PFM (Personal Finance Management) categories with merchant enrichment, and amounts use fixed-point decimals — no floating-point rounding surprises.

## Caching

All data is cached in-memory (no disk persistence — cache dies with the process):

| Data | TTL | Why |
|------|-----|-----|
| Account list | 1 hour | Accounts rarely change; minimizes API calls |
| Transactions | 15 minutes | Balances new transactions vs freshness |
| Balances | 5 minutes | Most time-sensitive; users expect current data |

Cache is per-connection and per-account. Restarting the server clears all caches.

## Multiple Connections

Configure as many bank connections as you need — even across different providers:

```json
{
  "connections": [
    { "id": "ing-main", "provider": "enable-banking", "..." : "..." },
    { "id": "chase-checking", "provider": "plaid", "..." : "..." },
    { "id": "revolut", "provider": "tink", "..." : "..." }
  ]
}
```

All tools accept an optional `connectionId` parameter to target a specific connection. When omitted, every connection is queried and results are merged — so "show all my balances" works across banks automatically.

## Security & Privacy

bank-mcp is designed with a security-first mindset:

- **Read-only by design** — the provider interface has no write methods. There is no way to initiate transfers, modify accounts, or take any action on your behalf.
- **Local credentials only** — your config file (`~/.bank-mcp/config.json`) is created with `600` permissions (owner read/write only). Credentials never leave your machine.
- **No telemetry** — bank-mcp collects zero analytics, sends no crash reports, and phones home to nobody.
- **No external data sharing** — transaction data flows directly from your bank's API to your local MCP client. Nothing is stored remotely.
- **Open source** — every line is auditable. No obfuscated code, no compiled blobs.

## Adding a New Provider

The pluggable architecture makes it straightforward to add support for additional banking APIs:

1. **Create your provider** at `src/providers/your-provider/index.ts`
2. **Extend `BankProvider`** — implement `listAccounts`, `listTransactions`, `getBalance`, and `getConfigSchema`
3. **Register it** in `src/providers/registry.ts`
4. **Add config fields** for the init wizard (the schema drives the interactive prompts automatically)

See [`src/providers/enable-banking/`](src/providers/enable-banking/) as a reference implementation. The mock provider at [`src/providers/mock/`](src/providers/mock/) is also useful for understanding the expected data shapes.

## Development

```bash
git clone https://github.com/elcukro/bank-mcp.git
cd bank-mcp
npm install
npm test          # Run tests (vitest)
npm run build     # Compile TypeScript
npm run dev       # Watch mode (recompile on change)
npm run lint      # ESLint
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

If you're adding a new provider, open an issue first to discuss the approach — we want to make sure the integration fits the project's architecture.

## License

[MIT](LICENSE) — use it however you want.

---

<p align="center">
  Built for the <a href="https://modelcontextprotocol.io">Model Context Protocol</a> ecosystem
</p>
