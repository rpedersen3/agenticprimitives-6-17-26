# `@agenticprimitives/mcp-runtime`

`mcp-runtime` is the MCP enforcement layer. It wraps MCP tools so delegated
authority, policy checks, service authentication, replay protection, and audit
events happen before a handler executes.

## Owns

- MCP middleware wrappers.
- Delegation-token enforcement at the tool boundary.
- Service MAC checks.
- Replay/JTI state integration.
- Tool-policy evaluation integration.
- Audit and metrics hooks around runtime decisions.

## Does Not Own

- Delegation data model. Use `delegation`.
- Risk classification rules. Use `tool-policy`.
- Service key storage. Use `key-custody`.
- Credential ceremonies or account custody.
- Business logic inside the tool handler.

## Dependencies

Depends on:

- `types`
- `audit`
- `delegation`
- `key-custody`
- `tool-policy`

## Consumers

Used by MCP servers and demo apps that expose tools requiring delegated access to
private data or sensitive actions.

## Architecture Rules

- Enforce before handler execution.
- Do not bypass policy checks through helper paths.
- Keep MCP-specific logic here rather than in protocol-neutral packages.
- Runtime failures should be auditable and understandable.
- No silent fallback between verification mechanisms.

## Common Use

Use this package for MCP tools that read PII, trigger actions, or operate on
behalf of a person/org/service Smart Agent.

## Validation

Run:

```bash
pnpm check:mcp-runtime
```
