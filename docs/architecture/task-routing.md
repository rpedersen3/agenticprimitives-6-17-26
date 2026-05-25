# Task Routing

Use this as the first stop when a task could touch multiple packages. Keep the
actual design in specs and package docs; this file is only a routing map.

> **Just need to know which package to import?** See
> [`package-consumer-map.md`](./package-consumer-map.md) — the "I need to do X →
> import this package" table + the layered story.
>
> **Renamed (commit `7861f4b`)** to remove the login-vs-profile and
> account-custody-vs-key-custody collisions — update old imports:
> `connect-auth` (was `identity-auth`), `account-custody` (was `custody`),
> `agent-profile` (was `agent-identity`).

| Task                                                       | Start Here                                    | Notes                                             |
| ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Passkey ceremony, SIWE, sessions, signer interfaces        | `packages/connect-auth/CLAUDE.md`            | No smart-account deployment logic here.           |
| Smart Agent deployment, UserOps, ERC-1271, factory clients | `packages/agent-account/CLAUDE.md`            | Consumes signers from `identity-auth`.            |
| Custody policy, recovery, quorum signatures, admin actions | `packages/account-custody/CLAUDE.md`                  | Keep custody vocabulary out of delegation.        |
| Delegation tokens, caveats, session authority              | `packages/delegation/CLAUDE.md`               | Authority/session layer, not KMS.                 |
| Envelope encryption, KMS providers, HMAC/MAC helpers       | `packages/key-custody/CLAUDE.md`              | No session lifecycle.                             |
| Tool classification, risk tiers, exact-call policy         | `packages/tool-policy/CLAUDE.md`              | Protocol-agnostic; no MCP imports.                |
| MCP authorization middleware and tool runtime glue         | `packages/mcp-runtime/CLAUDE.md`              | Transport-specific MCP layer.                     |
| Audit event schema and sink interface                      | `packages/audit/CLAUDE.md`                    | Concrete persistence stays in apps.               |
| `.agent` names, namehash, resolver records                 | `packages/agent-naming/CLAUDE.md`             | ENS-v2-style naming only.                         |
| AgentCard/profile JSON, CAIP-10 native IDs                 | `packages/agent-profile/CLAUDE.md`           | Off-chain profile schema and verification.        |
| Trust-fabric edges and relationship roles                  | `packages/agent-relationships/CLAUDE.md`      | Do not model naming hierarchy here.               |
| Shared branded chain/domain types                          | `packages/types/CLAUDE.md`                    | Base package; no runtime policy.                  |
| Solidity contracts                                         | `apps/contracts/` + relevant `specs/2XX-*.md` | Check the package spec before changing contracts. |
| Demo UX flows                                              | `apps/demo-web-pro/CLAUDE.md`                 | App wiring, local state, and tutorials.           |

## Cross-Cutting Work

If a task touches three or more packages or carries its own threat model, check
`docs/architecture/cross-cutting-capabilities.md` before editing. New
cross-cutting capabilities need a spec row and package `CLAUDE.md` entries.

## Validation Shortcut

Prefer the narrowest root script before `pnpm check:all`:

```bash
pnpm check:agent-naming
pnpm check:agent-identity
pnpm check:agent-relationships
pnpm check:custody
```
