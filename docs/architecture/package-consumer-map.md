# Package consumer map

**One question this answers:** *"I need to do X — which package do I import?"*

This is the developer-facing front door to the 12 capability packages. It is a
routing map, not the design — the design lives in `specs/2XX-*.md` and each
`packages/<name>/CLAUDE.md`. For "which package owns this concept when a task
spans several," see [`task-routing.md`](./task-routing.md); for the boundary
rules, [`specs/100-package-boundary-doctrine.md`](../../specs/100-package-boundary-doctrine.md).

> **Naming note.** Three packages were renamed (commit `7861f4b`) to remove two
> collisions (login-vs-profile, account-custody-vs-key-custody). The names below
> are current; the `(was: …)` hints are only for migrating old imports:
> `connect-auth` (was `connect-auth`), `agent-profile` (was `agent-profile`),
> `account-custody` (was `custody`).

## I need to…

| I need to…                                                | Import (today's package)                        |
| --------------------------------------------------------- | ----------------------------------------------- |
| Deploy / derive address / build a UserOp for a Smart Agent | `agent-account`                                 |
| Passkey login, SIWE, JWT sessions, the `Signer` interface  | `connect-auth`         |
| Add / remove a passkey, recovery, multi-sig on the SA      | `account-custody`            |
| Encrypt session bytes, KMS signing, service HMAC           | `key-custody`                                   |
| Mint / verify a delegation token, session rows             | `delegation`                                    |
| Classify tools, risk tiers, exact-call policy              | `tool-policy`                                   |
| Wrap MCP tools with delegation enforcement                 | `mcp-runtime`                                   |
| (A2A tool wrapping)                                        | `a2a-runtime` — *planned, mirrors mcp-runtime*  |
| `.agent` name → address (and records)                      | `agent-naming`                                  |
| Public profile / `AgentCard` for an agent                  | `agent-profile`       |
| Org membership, governance / trust edges                   | `agent-relationships`                           |
| Emit / route audit events                                  | `audit`                                         |
| Shared branded chain/domain types, `NameContext`           | `types`                                         |

## The layered story

Each package sits in one layer; dependencies only ever point *up* the list
(strict, no cycles — see doctrine §4).

| Layer        | Package(s)                                   | Role                                                            |
| ------------ | -------------------------------------------- | --------------------------------------------------------------- |
| **Core**     | `types`, `agent-account`                     | The canonical identity **anchor** — the ERC-4337 Smart Agent address IS the identity. |
| **Connect**  | `connect-auth` (was `connect-auth`)             | Connect a *human* to a Smart Agent: passkey, SIWE, JWT, `Signer`. |
| **Govern**   | `account-custody` (was `custody`)                | Who controls the account: custodians, trustees, quorum, `RecoverAccount`. |
| **Authorize**| `delegation`, `tool-policy`                  | What an agent may do: delegation tokens + caveats; tool risk policy. |
| **Operate**  | `mcp-runtime` (+ planned `a2a-runtime`)      | Enforce authorization at a transport boundary.                  |
| **Discover** | `agent-naming`, `agent-profile` (was `agent-profile`), `agent-relationships` | **Facet** registries + the trust **graph** that point AT the canonical address. |
| **Secrets**  | `key-custody`                                | KMS / envelope encryption / HMAC. ("key" custody, *not* account custody.) |
| **Observe**  | `audit`                                      | Audit-event schema + sinks (durable persistence wired by apps). |

**Three words to keep straight** (per ADR-0010):
- **anchor** — `agent-account` owns the canonical identity (the SA address). Names/profiles never *are* the identity.
- **facet** — `agent-naming` (name), `agent-profile` (AgentCard), and registry entries are facets that *point at* the anchor.
- **graph** — `agent-relationships` edges connect anchors; an edge is **not** a delegation.

## Two collisions this map exists to defuse

- **`connect-auth` (was `connect-auth`) is login, `agent-profile` (was `agent-profile`) is the profile.** Need a JWT/passkey/SIWE session → `connect-auth`. Need an `AgentCard`/HCS-11 manifest → `agent-profile`. They are NOT the same "identity" (ADR-0007 split is intentional — do not merge).
- **`account-custody` (was `custody`) is the on-chain CustodyPolicy, `key-custody` is KMS.** Add a passkey / run recovery / change quorum → `account-custody`. Encrypt bytes / KMS-sign → `key-custody`.

## See also

- [`task-routing.md`](./task-routing.md) — which package *owns* a concept when a task spans several.
- [`cross-cutting-capabilities.md`](./cross-cutting-capabilities.md) — capabilities that span 3+ packages.
- [`specs/100-package-boundary-doctrine.md` §8](../../specs/100-package-boundary-doctrine.md) — the consumer-doc standard this map satisfies.
- [`specs/101-v0-package-proposal.md`](../../specs/101-v0-package-proposal.md) — the package roster + deferred packages.
