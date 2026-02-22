# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-02-22

### Changed

- Rewrite mock provider with realistic US banking data (Chase accounts, USD)
- Realistic transaction patterns: monthly bills, weekly groceries, occasional shopping
- Separate checking vs savings activity (savings has only interest + transfers)
- Deterministic seeded random for consistent demo experience
- Update init wizard example to US bank (Chase)

## [0.1.1] — 2026-02-22

### Fixed

- Ensure scoped package always publishes as public (`publishConfig.access`)
- Remove stale `zod-to-json` build artifacts from distribution

### Changed

- Migrated from Zod 3 to Zod 4 (uses built-in `z.toJSONSchema()`)

## [0.1.0] — 2026-02-21

### Added

- Initial release
- **Enable Banking** provider — 2,000+ European banks via PSD2
- **Teller** provider — 7,000+ US banks via mTLS
- **Plaid** provider — 12,000+ institutions (US/CA/EU) with rich categorization
- **Tink** provider — 3,400+ European banks via Open Banking
- **Mock** provider — deterministic fake data for testing
- 5 MCP tools: `list_accounts`, `list_transactions`, `search_transactions`, `get_balance`, `spending_summary`
- Interactive setup wizard (`npx @bank-mcp/server init`)
- In-memory TTL cache (accounts 1h, transactions 15m, balances 5m)
- Multi-connection support across providers
- Demo mode (`--mock` flag)

[0.1.2]: https://github.com/elcukro/bank-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/elcukro/bank-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/elcukro/bank-mcp/releases/tag/v0.1.0
