# `@agenticprimitives/tool-policy`

`tool-policy` classifies actions and evaluates protocol-neutral risk policy. It
is the package that says whether a tool/action is low risk, sensitive, or requires
stronger approval.

## Owns

- Tool/action classification shapes.
- Risk tiers.
- Exact-call and policy rules.
- Policy evaluation helpers.
- Protocol-neutral decision output consumed by runtime packages.

## Does Not Own

- MCP transport. Use `mcp-runtime`.
- A2A transport or app servers.
- Delegation token verification. Use `delegation`.
- Credential or custody decisions.
- UI copy or product-specific consent screens.

## Dependencies

Depends on:

- `types`

It must stay transport-agnostic.

## Consumers

Used by:

- `mcp-runtime`
- apps that preflight risky actions
- consent flows that need a risk explanation before granting authority

## Architecture Rules

- No MCP, A2A, LangChain, Vercel, or UI framework imports.
- Policy output should be deterministic and easy to audit.
- Classification belongs before execution, not after a tool handler has already
  run.
- Keep product-specific labels out of the package.

## Common Use

Use this package when deciding whether a tool call needs a quorum caveat,
on-chain acceptance, stronger credential assurance, extra logging, or a
user-facing warning.

## Validation

Run:

```bash
pnpm check:tool-policy
```
