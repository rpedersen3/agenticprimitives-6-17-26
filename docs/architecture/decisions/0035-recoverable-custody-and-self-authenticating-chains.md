# ADR-0035 — Recoverable custody, owned-custodian authority, and self-authenticating delegation chains

**Status:** proposed (2026-06-10) · **Specs:** re-roots [270](../../../specs/270-del-001-activation.md) (DEL-001); introduces a W0 recoverable-custody spec (TBD) · **Builds on:** [ADR-0010](0010-smart-agent-canonical-identifier.md), [ADR-0011](0011-credential-recovery-and-re-association.md), [ADR-0013](0013-no-silent-fallbacks.md), [ADR-0025](0025-related-agent-links-are-private.md), [spec 235](../../../specs/235-google-kms-custody.md)

## Context

Activating DEL-001 (bind a delegation token's session key to the delegate) forced a walk through the
custody/delegation/session/token stack, and every blocker traced to **one structural confusion**: in the
demo, `demo-a2a` simultaneously plays three roles that must be separate —

1. **Custodian** — it holds the KMS master that derives every owner's per-`(iss,sub)` `C_sub`.
2. **Minter** — it generates session keys and signs delegation tokens *on behalf of remote delegates*.
3. **Verifier / proxy** — it checks delegations and forwards to `demo-mcp`.

The symptoms of that fusion, each confirmed in code:

- **Caller-auth gap.** `/mcp/person/pii` (`apps/demo-a2a/src/index.ts:3214`) accepts `{ delegation,
  requester }` with **no proof the caller is `requester`** — anyone holding an observed `owner→delegate`
  delegation can read.
- **Binding gap (DEL-001).** The token is signed by an **ephemeral key `demo-a2a` itself generated**
  (`SessionManager.init → randomBytes(32)` per call), not by anything the delegate authorized — so an
  observer can re-mint with their own key and impersonate the delegator.
- **Recoverability gap.** Org SAs deploy with a **random, non-persisted salt**
  (`index.ts:2267`: `crypto.getRandomValues` → `orgSalt`). From a read request `demo-a2a` has the org's
  *address* but cannot reconstruct its `(custodian, salt)` to sign anything for it.

The current mitigation that hides all three is the **service-MAC** on the `demo-a2a → demo-mcp` hop — i.e.
**transport**, not the token. That is the wrong layer to depend on for authority.

These are not three bugs; they are one missing architecture. This ADR states it.

## Decision

Adopt **recoverable custody → owned-custodian authority → self-authenticating chains** as the custody
architecture, and un-fuse the three roles. Three pillars:

### 1. Custody is recoverable, and the recovery record lives in the owner's private vault

> **Every SA an owner controls has a recoverable custody descriptor — `{ targetSA, salt, custodianSpec }`
> — persisted in the owner's private related-agents vault at creation.** To act for that SA you
> authenticate as the owner, recover its descriptor, reconstruct the custodian, and sign.

The random org salt is **kept** (ADR-0010: the SA is its own agent, salt is never name-derived). What was
missing is the **descriptor record** — which [ADR-0025](0025-related-agent-links-are-private.md) already says
person↔org links must be (private vault credentials, not on-chain edges or app-local state). The
"recoverability blocker" is simply a missing instance of a record the model already requires. This
descriptor is the same primitive that future org recovery, credential rotation, and multi-sig need — so
it is built once and reused.

### 2. Authority flows only through owned custodians; no service mints for an anonymous SA

`demo-a2a`'s honest role is **custody operator + verifier**, never minter-for-strangers. **Every mint runs
under an authenticated owner session** (`verifyCustodySession`) that recovers the relevant SA's custodian
(pillar 1) and signs. The anonymous `{ delegation, requester }` path is retired. Caller-authentication and
the DEL-001 leaf are then **the same act**: recovering the delegate's custodian and signing
`delegate-SA → session-key` *is* the proof the caller controls the delegate.

### 3. Tokens (and credentials) are self-authenticating chains; transport is not authority

A token carries the complete chain `owner ──delegation₁──▶ delegate-SA ──delegation₂──▶ session-key
──signs──▶ token` — three independently-verifiable links (owner ERC-1271, **delegate ERC-1271 = the
DEL-001 leaf**, session-key signature). `demo-mcp` verifies the chain with no trust in the minter or the
channel. **The service-MAC is reclassified as transport hardening, not the authority binding.** A token is
then safe to travel anywhere — client-side, cross-service — which is the entire point of binding.

### Degradation across custody type (where the session key dies)

- **Online custody (KMS — the spec-235 direction):** the recovered custodian (`C_sub`) signs on demand,
  zero-tx. The clean form **drops the session key**: `C_sub` signs tokens directly (`owner→delegate` + a
  per-token custodian signature). DEL-001 becomes *moot*, not *mitigated*.
- **Offline custody (passkey/hardware):** the delegate's custodian signs `delegation₂` **once per
  session** (one prompt), the session key is reused. The session-key/leaf apparatus exists **only** as the
  bridge for offline humans and thins out as KMS custody becomes default.

## Why this is the right shape (it is the intersection of prior decisions)

| Prior decision | What it contributes |
| --- | --- |
| ADR-0010 (canonical SA) | the SA is the identity; salt is random; custody is a facet |
| ADR-0011 (recoverable custody) | custody recovers *through the owner*; the SA address never changes |
| ADR-0025 (private relationship vault) | the recovery descriptor (owner↔SA, salt) is a private vault credential |
| spec 235 (KMS custody) | the recovered custodian is online → signs on demand, zero-tx |
| DEL-001 (spec 270) | the token is a self-authenticating chain |

They collapse into one principle. That collapse — not novelty — is the signal this is the correct
long-term shape.

## Consequences

- **A new W0 spec — "recoverable agent custody."** Persist `{ targetSA, salt, custodianSpec }` to the
  owner's related-agents vault at SA creation (org-create, service-agent-create); add
  `recoverCustodian(ownerSession, targetSA)` that re-derives `C_sub` + salt under an authenticated owner
  session. Prerequisite for DEL-001 and independently valuable (recovery, rotation, multi-sig).
- **Spec 270 (DEL-001) re-roots under this ADR.** Its W1 becomes implementable: the mint recovers the
  delegate's custodian (W0) and signs `delegation₂`. Its W0/W1/W2 sequencing is updated to depend on
  recoverable custody.
- **`demo-a2a`'s anonymous mint endpoints are retired** in favor of owner-session-gated custody recovery +
  mint. The `{ delegation, requester }` shape gains a required custody session.
- **The service-MAC is documented as transport hardening only.** Authority lives in the token chain. (The
  MAC stays — defence in depth — but nothing relies on it for authorization.)
- **The dependency on `key-custody` / spec-235 custodian derivation is made first-class** in the app layer:
  every SA-acting flow goes through `recoverCustodian`, not ad-hoc `deriveSubjectCustodian` calls.

## Alternatives rejected

- **Deterministic-from-identity salt** (recompute the org SA from owner + name/index, no stored state).
  Simpler, but violates ADR-0010 (the SA stops being its own agent) and **leaks the owner↔SA link
  on-chain** (privacy). Rejected: the vault descriptor keeps the salt random, the link private, and custody
  recoverable — at the cost of one persisted record the ADR-0025 model already implies.
- **Keep `demo-a2a` minting for remote delegates** (just bolt a leaf on). Impossible — `demo-a2a` has no
  authority to sign `delegation₂` for a delegate it doesn't custody (the recoverability gap). This is the
  fusion that caused the blockers.
- **On-chain `approveHash` as the session-key binding** (spec 270 v1). A transaction on the hot read path
  with per-call keys; persists ephemeral bindings on-chain forever. The binding is verified off-chain;
  it never needed to be on-chain. (ADR-0013-adjacent: one mechanism, the right one.)
- **Rely on the service-MAC for authority.** Binds to transport, not to the token; breaks the moment a
  token is minted or held outside the MAC'd hop (the client-side / true-delegate direction). Defence in
  depth, not the authority model.
