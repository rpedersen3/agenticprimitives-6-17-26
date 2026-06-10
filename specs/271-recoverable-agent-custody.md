# Spec 271 — Recoverable agent custody (W0 for ADR-0035)

**Status:** Draft (architect-of-record). **Implements:** [ADR-0035](../docs/architecture/decisions/0035-recoverable-custody-and-self-authenticating-chains.md)
pillar 1. **Unblocks:** [spec 270](270-del-001-activation.md) (DEL-001 W1). **Extends:** [spec 246](246-related-agents-vault.md)
(the private related-agent credential) + [spec 247](247-per-agent-mcp-vault.md) (the vault it lives in).
**Owns:** the **custody descriptor** (the recoverable `{ targetSA, salt, custodianSpec }` record) and the
`recoverCustodian(ownerSession, targetSA)` operation.

## 1. The problem

To act for an SA you need its custodian. A KMS-custodied SA's custodian is `C_sub = derive(master,
(iss,sub), rotation)` **bound to a deployment salt** — the SA address is `getAddressForAgentAccount({
custodians:[C_sub], salt })`. Today org SAs deploy with a **random salt that is thrown away**
(`apps/demo-a2a/src/index.ts:2267` — `crypto.getRandomValues → orgSalt`, never persisted). So from an
SA *address* alone, **its custodian cannot be reconstructed** — which is why DEL-001's leaf was
unsignable for orgs (ADR-0035, recoverability gap), and why org recovery / rotation / multi-sig have no
foundation.

The salt is correctly random (ADR-0010 — the SA is its own agent, salt is never name-derived). The
missing piece is a **recoverable record of how that SA is custodied**, held where ADR-0025 already says
person↔SA links must live: the owner's **private related-agent vault**.

## 2. Reference: smart-agent patterns to port

smart-agent derives accounts with `getAddress(owner, salt)` (`packages/sdk/src/account.ts:27`) and uses
**random salts** for sessions/accounts (`session.ts:33`: `salt = BigInt(Math.random…)`). It has **no
recoverability layer** — the caller is assumed to already hold the salt (it lives in the dApp's local
state / the user's wallet context). There is no notion of reconstructing an account's custodian from a
durable, owner-resident record.

**We deliberately add** a private-vault **custody descriptor**, because our custodian is a *derived*
KMS key (`C_sub`) and our SAs (orgs, service agents) are created **server-side under an OIDC custody
session**, not in a wallet that retains the salt. The salt must therefore be **persisted by the owner**,
or it is lost. We port smart-agent's `getAddress(owner, salt)` derivation **verbatim**; we add the
durable descriptor it lacks. (This is also why a deterministic salt is rejected — ADR-0035 alternatives:
it would leak the owner↔SA link on-chain and break ADR-0010.)

## 3. The custody descriptor (shape — `@agenticprimitives/related-agents`)

A **facet of the existing `RelatedAgentCredential`** (spec 246), not a new store. The private,
holder-resident person↔org credential already links `holder (owner) → relatedAgent (the SA)`; W0 adds the
recovery fields to its body:

```ts
interface CustodyDescriptor {
  targetSA: Address;           // the SA this describes (== credential's relatedAgent role)
  salt: Hex;                   // the deployment salt (bytes32) — random, ADR-0010
  custody:                     // how the custodian is reconstructed
    | { kind: 'kms-subject'; rotation: number }   // C_sub = derive(master, owner-(iss,sub), rotation)
    | { kind: 'passkey'; credentialId: string }   // offline custodian (W3)
    | { kind: 'eoa'; address: Address };          // SIWE/wallet custodian
}
```

For `kms-subject` the `(iss,sub)` is **NOT stored** — it is supplied by the owner's authenticated session
at recovery time (so the descriptor alone never identifies the owner). The descriptor carries only the
salt + the *kind* + rotation. It inherits the credential's `visibility: 'private'` (ADR-0025). The
package stays **shape-only** (storage is app/Connect-level, per its CLAUDE.md) — it gains
`buildCustodyDescriptorBody` + types, no storage.

## 4. `recoverCustodian(ownerSession, targetSA)` (the operation — app/Connect glue)

```
recoverCustodian(ownerSession, targetSA):
  1. gate = verifyCustodySession(ownerSession)            # proves the OWNER (iss,sub) + sessionSub (owner SA)
     fail-closed on a non-custody-grade / unconfirmed session
  2. descriptor = readCustodyDescriptor(owner, targetSA)  # from the owner's private related vault (spec 246/247)
     if absent → throw 'no recoverable custody for targetSA' (NO fallback — ADR-0013)
  3. { cSub, sign } = deriveSubjectCustodian(gate.subject, MASTER, { rotation: descriptor.custody.rotation })
  4. derived = getAddressForAgentAccount({ custodians:[cSub], salt: descriptor.salt })
  5. ASSERT derived == targetSA   # the descriptor + this owner's C_sub actually reconstruct targetSA
     else → throw 'descriptor does not reconstruct targetSA' (the owner does not custody it)
  6. return { custodian: cSub, sign, salt: descriptor.salt }
```

This is the single authority-recovery primitive. Step 5 is the **caller-authentication** ADR-0035 pillar
2 needs: only an owner whose `C_sub` + the stored salt reproduce `targetSA` can recover it. The same
`{cSub, sign}` then signs delegation₂ (DEL-001), a recovery userOp, a rotation, etc.

## 5. Write (at creation) and read (at use)

- **Write:** org-create (`/custody/google/bootstrap-org`) and any server-side SA creation persist the
  descriptor into the owner's related vault **in the same flow that already mints the related-agent
  link** — the salt it currently discards (`index.ts:2267`) is written, not thrown away. Reuses the
  custodian-signed `/connect/related-orgs` POST (spec 247).
- **Read:** `recoverCustodian` reads via the existing related-vault query path (spec 246 `/connect/
  related-orgs`), filtered to `targetSA`, under the owner session.

## 6. Package boundary

- **`@agenticprimitives/related-agents`** — the `CustodyDescriptor` shape + `buildCustodyDescriptorBody`
  (generic; no app vocabulary, no storage, no hostnames). Sits with the related-agent credential it
  extends.
- **App layer (demo-a2a + demo-sso-next Connect)** — `recoverCustodian`, the write-at-create wiring, the
  vault read. The KMS master + `deriveSubjectCustodian` are already app-level (spec 235).
- `key-custody` is unchanged (it owns derivation primitives; this composes them).

## 7. Security & privacy

- **No single artifact grants custody.** The salt is not a secret; reconstruction also requires the KMS
  master (only demo-a2a holds it) **and** an authenticated, on-chain-confirmed, custody-grade owner
  session (spec 235). Descriptor leak alone ⇒ nothing.
- **Owner-link privacy (ADR-0025).** The descriptor lives in the *private* related credential and stores
  no `(iss,sub)`; it never appears on-chain and never in relying-app-local state.
- **Fail-closed (ADR-0013).** Missing descriptor → throw, never a fallback derivation. Step-5 mismatch →
  reject. One mechanism.
- **No new custody power via delegation** (delegation CLAUDE.md): `recoverCustodian` is a *custody*
  operation gated by the owner's custody session, never reachable through a delegation/caveat/token.

## 8. Waves

- **W0a — shape + write.** Add `CustodyDescriptor` + `buildCustodyDescriptorBody` to `related-agents`;
  persist the descriptor at org-create (stop discarding the salt). Unit tests for the shape; an
  integration test that a created org's descriptor round-trips through the vault. **Deploy** demo-a2a +
  Connect.
- **W0b — `recoverCustodian`.** Implement the operation (app glue) + the read path; assert-reconstruct
  (step 5). Test: recover an org's custodian under the owner session and sign a probe digest that
  ERC-1271-validates against the org SA; a wrong-owner session fails step 5. **Deploy.**
- **(then) spec 270 W1** consumes `recoverCustodian` to sign delegation₂.

## 9. Acceptance criteria

- **RC-AC-1 (round-trip):** an org created via bootstrap-org has a private custody descriptor in the
  owner's related vault carrying the deployment salt; no salt is discarded.
- **RC-AC-2 (recover + sign):** `recoverCustodian(ownerSession, orgSA)` returns a `sign` that produces an
  ERC-1271 signature **valid against `orgSA`** (proving the reconstructed custodian truly custodies it).
- **RC-AC-3 (caller-auth / wrong owner):** `recoverCustodian` with a session for a different owner
  **fails step 5** (`derived ≠ targetSA`) and signs nothing.
- **RC-AC-4 (no descriptor → fail-closed):** recovery for an SA with no descriptor **throws**, with no
  fallback derivation attempted.
- **RC-AC-5 (privacy):** the stored descriptor contains the salt + custody-kind + rotation but **no
  `(iss,sub)`** and is `visibility: private`.

## 10. Test plan

- **`related-agents`** — shape goldens for `buildCustodyDescriptorBody`; no `(iss,sub)` present.
- **demo-a2a** — `recoverCustodian` integration: create→persist→recover→sign-probe ERC-1271-valid against
  the org (RC-AC-2); wrong-owner reject (RC-AC-3); missing-descriptor throw (RC-AC-4).
- **Live (Base Sepolia)** — create an org, confirm the descriptor in the owner's vault, recover the
  custodian, sign a probe, verify ERC-1271 against the org SA on-chain.

## 11. Invariants

- **RC-INV-1:** custody is reconstructable ONLY from `{ private descriptor (salt+kind) } + { KMS master }
  + { authenticated owner session }` — never from any subset.
- **RC-INV-2:** `recoverCustodian` asserts `getAddressForAgentAccount(custodian, salt) == targetSA`
  before returning; a descriptor that does not reconstruct the target is rejected.
- **RC-INV-3:** the descriptor is a *private* related credential (ADR-0025) and stores no owner identifier;
  the owner identity comes only from the live session.
- **RC-INV-4:** the SA address is unchanged by any recovery/rotation that uses this (ADR-0011); the salt +
  the custodian set define the address, and recovery reconstructs — never re-deploys to a new address.
