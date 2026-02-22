# Guided Init Setup — Design Document

**Date:** 2026-02-22
**Status:** Approved

## Problem

The current `init` command is a bare-bones field collector. A new user selecting "Plaid" gets asked for "Client ID", "Secret", "Access token" with zero context on where to find them, what prerequisites exist, or how to get started. This makes onboarding frustrating.

Meanwhile, `connect` has excellent guided flows for Enable Banking and Tink, but Plaid and Teller have no guided experience at all.

## Decisions

- **Unified `init`** — merge init + connect into one command that routes to provider-specific guided flows
- **Plaid sandbox** — auto-create test tokens programmatically (no browser needed)
- **Teller sandbox** — serve Teller Connect locally, capture callback token
- **Mock hidden** — only accessible via `--mock` flag, not shown in provider list

## Architecture: Per-Provider Flow Functions

Each provider gets a dedicated flow file with full control over its UX. The `init.ts` becomes a thin orchestrator.

### Entry Point

```
$ npx @bank-mcp/server init

  +------------------------------------------+
  |  bank-mcp -- Connect your bank account   |
  +------------------------------------------+

  Choose your banking provider:

    1. Plaid          -- US, UK, EU . 12,000+ institutions
    2. Teller         -- US . real-time data, instant access
    3. Tink           -- EU . PSD2 open banking
    4. Enable Banking -- EU . PSD2 aggregation

? Select provider (1-4):
```

### Plaid Flow

Steps:
1. Welcome screen with prerequisites (account + API keys from dashboard)
2. Offer to open dashboard.plaid.com in browser
3. Collect client_id + secret
4. Environment selection (sandbox/development/production)
5. **Sandbox**: auto-create token via `/sandbox/public_token/create` + `/item/public_token/exchange`
6. **Dev/Prod**: guide through Plaid Link or accept existing access token
7. Validate connection, display accounts, save config

### Teller Flow

Steps:
1. Welcome screen with prerequisites (account + app ID from teller.io)
2. Offer to open teller.io in browser
3. Collect application ID
4. Environment selection (sandbox/development/production)
5. **Dev/Prod**: additionally collect mTLS certificate paths
6. Serve Teller Connect HTML locally, open browser, capture access token from callback
7. Validate connection, display accounts, save config

### Enable Banking & Tink

Reuse existing `connect/flows/` as-is. Import and delegate from init orchestrator.

## File Structure

```
src/
  init.ts                          # Rewritten: orchestrator + welcome screen
  init/
    flows/
      plaid.ts                     # NEW: guided Plaid setup
      teller.ts                    # NEW: guided Teller setup + local server
    ui.ts                          # NEW: shared TUI utilities
  connect/
    flows/
      enable-banking.ts            # EXISTING: reused from init
      tink.ts                      # EXISTING: reused from init
    callback-server.ts             # EXISTING: reused by Teller flow
    browser.ts                     # EXISTING: openBrowser util
  connect.ts                       # KEPT: thin wrapper calling init
```

## Shared TUI Utilities (`init/ui.ts`)

- `printBanner()` — top-level welcome box
- `printSection(title)` — section headers with dash borders
- `printProviderWelcome(name, description, prerequisites, signupUrl)` — consistent welcome screens
- `printAccounts(accounts)` — account list display
- `askWithBrowserOpen(rl, prompt, url)` — "press 'o' to open" pattern

## Teller Connect Local Server

Serve minimal HTML page with Teller Connect JS SDK:
- Start HTTP server on random available port
- Inject app_id and environment into HTML template
- Teller Connect `onSuccess` callback POSTs access token to local server
- Server captures token, closes, returns to CLI flow
- Reuse `callback-server.ts` pattern for the HTTP server

## Testing

Each flow gets a test file following the `tests/unit/connect/flows/enable-banking.test.ts` pattern:
- Mock readline for user input simulation
- Mock HTTP calls (Plaid API, Teller API)
- Test: happy path, invalid credentials, API failures, environment switching
