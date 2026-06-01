# Audit Evidence Crosswalk

**Companion to:** [spec 237](../../specs/237-audit-evidence-layer.md),
[ADR-0022](./decisions/0022-authority-must-be-declarative.md).

For each of the 17 `@agenticprimitives/*` packages, this document
records:

1. **Capabilities** — the sensitive authority surfaces the package owns,
   stated declaratively (the form they'd take as `authority.capabilities[*]`
   entries in `capability.manifest.json` per spec 237 §5).
2. **Today** — what's already in the substrate that backs the claim
   (spec section, implementation file, invariant test, audit-event).
3. **Gap** — what's missing for the Audit Evidence Layer to render a
   green row in `audit-readiness-report.md`.

Status legend:

- 🟢 — capability fully backed today (spec + impl + invariant + audit event).
- 🟡 — capability backed but the manifest entry is missing
  (mechanical: write the JSON).
- 🔴 — capability backed by code but no invariant test / no audit event
  / no spec section.

The companion spec 237's CI gate `check:audit-evidence-completeness`
will require 🟢 for every `stability: stable` package once the schema
lands.

---

## connect-auth

| Capability | Status | Today | Gap |
|---|---|---|---|
| `connect-auth.passkey.register` | 🟡 | spec 223 + `src/passkey/`; covered by `apps/demo-sso` E2E | Manifest entry |
| `connect-auth.passkey.assert` | 🟡 | spec 223 + `src/passkey/`; covered by `WebAuthnLib.t.sol` | Manifest entry |
| `connect-auth.siwe.verify` | 🟡 | spec 223 + `src/siwe/` | Manifest entry |
| `connect-auth.session.mint` | 🟡 | spec 223 + JWT-based session | Manifest entry; surfaces `audience` + `expiry` |
| `connect-auth.session.verify` | 🟡 | spec 223 + JWKS | Manifest entry; surfaces `iss` + `aud` pinning |

## connect

| Capability | Status | Today | Gap |
|---|---|---|---|
| `connect.broker.mint` | 🟡 | spec 224 + `verifyAgentSession` consumers | Manifest entry; declares ES256 (workerd) |
| `connect.broker.verify` | 🟡 | spec 224 + JWKS-pinned consumers | Manifest entry |
| `connect.bound-grant.issue` | 🟡 | spec 224 + ADR-0019 | Manifest entry; surfaces scoped-delegation requirement |

## agent-account

| Capability | Status | Today | Gap |
|---|---|---|---|
| `agent-account.deploy` | 🟡 | spec 220 (bootstrap) + `AgentAccountFactory` | Manifest entry |
| `agent-account.upgrade` | 🟢 | spec 209 + `onlySelf _authorizeUpgrade` + R9.3.x Halmos proof | Manifest entry |
| `agent-account.set-delegation-manager` | 🟢 | spec 209 + `onlySelf` + R9.3.x Halmos proof | Manifest entry |
| `agent-account.remove-custodian` | 🟢 | spec 209 + `onlySelf` + R9.3.x Halmos proof | Manifest entry |
| `agent-account.remove-passkey` | 🟢 | spec 209 + `onlySelf` + R9.3.x Halmos proof | Manifest entry |
| `agent-account.add-passkey` | 🟡 | spec 209; H7-C.1 closure (`rpIdHash != 0`) | Manifest entry; missing dedicated symbolic proof |
| `agent-account.validate-userop` | 🟡 | ERC-4337 `validateUserOp`; R8.2 UV gate symbolically proven (Halmos PROOF-1 in R9.3) | Manifest entry |

## account-custody

| Capability | Status | Today | Gap |
|---|---|---|---|
| `custody.install` | 🟡 | spec 207 + `CustodyPolicy.onInstall` + R9.1 invariants (mode bounds + threshold nonzero) | Manifest entry |
| `custody.uninstall` | 🟡 | spec 207 + `permanentlyUninstalled` flag | Manifest entry |
| `custody.schedule-change` | 🟡 | spec 207 + EIP-712 typehash + R9.1 changeCount monotonic | Manifest entry; declare `requires: ["quorum-sig", "eta"]` |
| `custody.apply-change` | 🟡 | spec 207 + EIP-712 typehash + R9.1 invariants | Manifest entry |
| `custody.cancel-scheduled` | 🟡 | spec 207 | Manifest entry |
| `custody.recover` | 🔴 | spec 207 + trustee-quorum check | Manifest entry; **missing dedicated invariant** (R9.2.x candidate) |

## key-custody

| Capability | Status | Today | Gap |
|---|---|---|---|
| `key-custody.envelope.encrypt` | 🟡 | spec 203 + `A2AKeyProvider` + AAD canonicalization | Manifest entry |
| `key-custody.envelope.decrypt` | 🟡 | spec 203 + AAD trip-wire + audit event | Manifest entry |
| `key-custody.sign-a2a-action` | 🟡 | spec 203 + per-tool executor signer + per-subject derivation | Manifest entry |
| `key-custody.mac.generate` | 🟡 | spec 203 + `MacProviderLike` | Manifest entry |
| `key-custody.subject-signer.derive` | 🟡 | spec 235 + HKDF derivation; tests verify same-subject → same-address | Manifest entry |

## delegation

| Capability | Status | Today | Gap |
|---|---|---|---|
| `delegation.mint` | 🟡 | spec 202 + EIP-712 `DELEGATION_TYPEHASH` + R9.2 hash-deterministic invariant | Manifest entry; declares chainId/audience/origin/nonce/expiry surfaces |
| `delegation.redeem` | 🔴 | spec 202 + `redeemDelegations` runtime; existing Foundry coverage | Manifest entry; **no symbolic proof of "revoked delegation cannot redeem"** (R9.3.x.y candidate) |
| `delegation.revoke` | 🟢 | spec 202 + `revokeDelegationByOwner` + R9.2 INV-1 (irreversibility) + INV-5 (set-monotonicity) | Manifest entry |
| `delegation.evaluate-caveats` | 🟡 | spec 202 + `evaluateCaveats` + tool-policy classification bridge | Manifest entry |
| `delegation.mint-token` | 🟡 | spec 202 + EIP-712 token + JTI replay protection | Manifest entry; declare `requires: ["fresh-jti", "audience-binding"]` |

## tool-policy

| Capability | Status | Today | Gap |
|---|---|---|---|
| `tool-policy.classify` | 🟡 | spec 204 + `RiskTier` enum + `declareTool` | Manifest entry |
| `tool-policy.evaluate-policy` | 🟡 | spec 204 + `evaluatePolicy` + fail-closed classification | Manifest entry; declares `denies: ["unclassified-tool"]` |
| `tool-policy.exact-call` | 🟡 | spec 204 + DSL | Manifest entry |

## mcp-runtime

| Capability | Status | Today | Gap |
|---|---|---|---|
| `mcp-runtime.with-delegation` | 🟢 | spec 205 + R8.1 type-level production-strict invariant + JTI store + audit event | Manifest entry |
| `mcp-runtime.declare-resource` | 🟡 | spec 205 + classification bridge | Manifest entry |
| `mcp-runtime.service-mac.verify` | 🟡 | spec 205 + HMAC envelope + audit event | Manifest entry |
| `mcp-runtime.jti.track` | 🟡 | spec 205 + sqlite/postgres/memory stores + atomic test | Manifest entry |

## agent-naming

| Capability | Status | Today | Gap |
|---|---|---|---|
| `agent-naming.root-initialize` | 🟡 | spec 222 + `AgentNameRegistry.initializeRoot` (governance-gated) | Manifest entry; `grantedBy: governance` |
| `agent-naming.register` | 🟡 | spec 222 + `PermissionlessSubregistry.register` | Manifest entry |
| `agent-naming.set-primary` | 🟡 | spec 222 + `setPrimary` (owner-gated) | Manifest entry |
| `agent-naming.resolve-forward` | 🟡 | spec 222 + `reverseResolveString` (single call, ADR-0012/0013) | Manifest entry |
| `agent-naming.resolve-reverse` | 🟡 | spec 222 + `reverseResolveString` | Manifest entry |

## agent-profile

| Capability | Status | Today | Gap |
|---|---|---|---|
| `agent-profile.read` | 🟡 | spec 225 + `AgentProfileResolver` (read-only) | Manifest entry |
| `agent-profile.attribute.set` | 🟡 | spec 225 + agent-self-signed attributes | Manifest entry |

## agent-relationships

| Capability | Status | Today | Gap |
|---|---|---|---|
| `agent-relationships.edge.create` | 🟡 | spec 226 + `AgentRelationship` contract; flagged EXPERIMENTAL (public graph) | Manifest entry; declares `denies: ["confidential edges"]` |
| `agent-relationships.edge.query` | 🟡 | spec 226 + public read | Manifest entry |

## identity-directory

| Capability | Status | Today | Gap |
|---|---|---|---|
| `identity-directory.lookup` | 🟡 | spec 225 + read model composing naming + profile + relationships | Manifest entry |

## identity-directory-adapters

| Capability | Status | Today | Gap |
|---|---|---|---|
| `identity-directory-adapters.caip10` | 🟡 | spec 225 + CAIP-10 adapter | Manifest entry |
| `identity-directory-adapters.naming` | 🟡 | spec 225 + naming adapter | Manifest entry |
| `identity-directory-adapters.profile` | 🟡 | spec 225 + profile adapter | Manifest entry |
| `identity-directory-adapters.indexer` | 🟡 | spec 225 + indexer adapter (off-chain index) | Manifest entry |

## ontology

| Capability | Status | Today | Gap |
|---|---|---|---|
| `ontology.term.resolve` | 🟡 | spec 226 + Hashgraph-aligned T-box / C-box | Manifest entry |
| `ontology.shape.validate` | 🟡 | spec 226 + SHACL shapes | Manifest entry |

## audit

| Capability | Status | Today | Gap |
|---|---|---|---|
| `audit.event.emit` | 🟢 | spec 206 + `AuditSink` interface + console / memory / PII-guardrail sinks | Manifest entry |
| `audit.event.assert-no-leak` | 🟡 | spec 206 + PII guardrail sink + R7 audit-reader's-guide | Manifest entry; declare `denies: ["raw-sessionId-in-log"]` |
| `audit.metrics.emit` | 🟡 | spec 206 + `MetricsSink` observability primitive | Manifest entry |

## types

| Capability | Status | Today | Gap |
|---|---|---|---|
| (leaf package — branded primitives only; no authority surfaces of its own) | n/a | spec 100 | None — exempt from `authority` requirement (declare `authority: { capabilities: [] }`) |

## contracts

Special case: `@agenticprimitives/contracts` ships Solidity sources +
ABIs. The authority claims for the deployed contracts (AgentAccount,
CustodyPolicy, DelegationManager, SmartAgentPaymaster, AgentNameRegistry,
…) live in their consuming packages' manifests (agent-account,
account-custody, delegation, agent-naming). The `contracts` manifest
declares:

- `contracts.deploy` (governance-gated; multisig handoff)
- `contracts.upgrade` (per-contract; UUPS where applicable; **only**
  AgentAccount today)

| Capability | Status | Today | Gap |
|---|---|---|---|
| `contracts.deploy` | 🟡 | spec 100 + Deploy.s.sol + `GOVERNANCE_MULTISIG` env var | Manifest entry; declare R5.4 single-multisig pattern |
| `contracts.upgrade` (UUPS AgentAccount) | 🟢 | UUPS `_authorizeUpgrade` `onlySelf` + R9.3.x Halmos proof | Manifest entry |

## Cross-package: load-bearing claims

These capabilities span multiple packages; their manifest entry lives
on the OWNING package per the package-boundary doctrine (spec 100), but
the consuming packages MAY add a one-line manifest reference for audit
discoverability.

| Capability | Owning package | Consuming packages |
|---|---|---|
| Custody-quorum threshold-policy | account-custody | agent-account, delegation |
| Delegation token mint + verify | delegation | mcp-runtime, connect, agent-relationships (when used in MCP flows) |
| MAC envelope binding (audience + service + route + nonce + timestamp + body digest) | key-custody (`/mac`) | mcp-runtime, demo-a2a, demo-mcp |
| Audit event taxonomy | audit | every package that emits |
| EIP-712 typehash registry | (cross-package) | delegation (DELEGATION_TYPEHASH), account-custody (3 custody-action typehashes), agent-account (passkey ops) |

## Summary

- **17 packages**, ~45 distinct capabilities surfaced.
- **🟢 backed today: 7 capabilities** (mostly R9 + R8 wave closures).
- **🟡 backed-but-needs-manifest: ~36 capabilities** — mechanical when
  schema lands (W1 of spec 237 §8).
- **🔴 needs invariant / symbolic-proof / spec: 2 capabilities** —
  `custody.recover` (R9.2.x candidate), `delegation.redeem` against
  revocation (R9.3.x.y candidate).

The Audit Evidence Layer is genuinely close. The substrate is in
place; what's missing is the schema work + the collector. That's
spec 237's W1-W4 — a tractable wave.
