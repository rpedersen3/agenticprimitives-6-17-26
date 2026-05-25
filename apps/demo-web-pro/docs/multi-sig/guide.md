# Multi-sig + custody policy — capability guide

The canonical demo of **account custody**: who controls a Smart Agent, how
control changes are gated by an m-of-n quorum + a risk-tiered safety delay, and
how a lost credential is recovered without the agent's address ever changing.

Audience: adopters wiring custody into their own app. The live flow is
[demo-web-pro](../../CLAUDE.md) Acts 3–5; the recovery variant is
[demo-web-recovery](../../../demo-web-recovery/CLAUDE.md).

## The model

A Smart Agent's control set lives in its on-chain **CustodyPolicy** (an ERC-7579
executor module), not inlined in the account. Two roles:

- **Custodians** — day-to-day control credentials (passkey PIA / wallet EOA).
- **Trustees** — recovery quorum; can rotate the custodian set if credentials
  are lost, but cannot act day-to-day.

Every custody change is a `CustodyAction` (add/remove custodian, change
quorum, `RecoverAccount`, …) scheduled then applied, gated by:

- a **quorum** (m-of-n signatures over the EIP-712 schedule + apply payloads), and
- a **risk tier** safety delay. Tiers (owned by `tool-policy`): T1 Read · T2
  Write · T3 Value · T4 Admin · T5 Critical · T6 Recovery. Higher tier ⇒ higher
  quorum + longer delay. Reducing a quorum escalates to the stricter tier.

The **Smart Agent address never changes** — credentials rotate, the identity
(the address; `CanonicalAgentIdentity`) is permanent ([ADR-0010](../../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md), [ADR-0011](../../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)).

## SDK pieces (which package does what)

| Need | Package |
| --- | --- |
| Encode a `CustodyAction` (add/remove custodian, quorum, `RecoverAccount`) + EIP-712 schedule/apply hashes | `@agenticprimitives/account-custody` |
| Risk-tier taxonomy + `evaluatePolicy()` → `{ tier, requiresQuorum, requiresUv, requiresAcceptedOnChain }` | `@agenticprimitives/tool-policy` |
| `buildQuorumCaveat` + `requireQuorumForTier` on a delegation | `@agenticprimitives/delegation` |
| Deploy / address / ERC-1271 quorum verification | `@agenticprimitives/agent-account` |
| Audit events for every schedule/apply | `@agenticprimitives/audit` |

The on-chain enforcement lives in `apps/contracts/src/custody/CustodyPolicy.sol`
+ the `QuorumEnforcer` / `ApprovedHashRegistry` (Base Sepolia). The
custody/agency vocabulary firewall ([spec 213](../../../../specs/213-custody-layer-carve-out.md))
keeps `account-custody` (account control) distinct from `delegation` (agent
authority) and `key-custody` (KMS).

## The demo flow (demo-web-pro)

1. **Act 3 — Bob joins.** A second custodian is added to the Org via a scheduled
   `CustodyAction`, signed by the existing custodian quorum.
2. **Act 4 — Two-person control.** The Org's T4 (Admin) quorum is raised to
   **2-of-2**: from here, every admin change needs both Alice and Bob.
3. **Act 5 — Treasury stewardship.** The Treasury issues bounded delegations
   (these are *delegations*, not custody changes — different package, different
   authority).
4. **Recovery (demo-web-recovery).** Sam loses a credential; Alice + Bob (2-of-2
   trustees) co-sign a T6 `RecoverAccount` that atomically swaps the lost
   credential for a new one. Sam's address, name, profile, and delegations are
   unchanged.

## Security invariants

- **Quorum is verified on-chain**, over a payload hash bound to chainId +
  enforcer + delegationHash + delegator + redeemer + target + value + calldata —
  `msg.sender` does not affect the check.
- **Recovery is custody-governed, never a delegation.** A delegated party cannot
  gain custody powers; a credential change never flows through a caveat/token.
- **Reducing a quorum escalates to the higher tier** (you can't quietly weaken
  control at a lower bar).

## See also

- [`specs/207`](../../../../specs/207-smart-account-threshold-policy.md) (product) · [`specs/209`](../../../../specs/209-erc7579-module-taxonomy.md) (module taxonomy) · [`specs/213`](../../../../specs/213-custody-layer-carve-out.md) (firewall) · [`specs/221`](../../../../specs/221-credential-recovery.md) (recovery)
- [Cross-cutting capability index](../../../../docs/architecture/cross-cutting-capabilities.md)
