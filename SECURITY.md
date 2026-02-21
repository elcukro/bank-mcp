# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in bank-mcp, **please do not open a public issue.**

Instead, email **[luke@elcukro.dev](mailto:luke@elcukro.dev)** with:

- A description of the vulnerability
- Steps to reproduce
- The potential impact
- (Optional) A suggested fix

You should receive an acknowledgment within 48 hours. We will work with you to understand the issue, determine the affected versions, and coordinate a fix before any public disclosure.

## Scope

bank-mcp handles sensitive financial credentials (API keys, access tokens, certificates). Security issues we care about include:

- Credential leakage (logging, error messages, stack traces)
- Unauthorized file access (config file permissions)
- Dependency vulnerabilities that affect bank-mcp
- Injection vectors through MCP tool parameters
- Unintended write access to banking APIs

## Design Principles

- **Read-only by design** — no write methods exist in the provider interface
- **No network listener** — stdio transport only, no open ports
- **Minimal dependencies** — 3 runtime deps to minimize supply chain risk
- **Local-only credentials** — config stored at `~/.bank-mcp/` with `600` permissions
- **No telemetry** — zero analytics, no phone-home
