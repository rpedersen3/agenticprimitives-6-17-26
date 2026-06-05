# Spec 256 — Google-KMS org-create (credential-aware organization creation)

**Status:** draft, 2026-06-04.
**Owner:** `apps/demo-a2a` (a new server custody endpoint) + `apps/demo-sso-next` (client + routing).
Combines [spec 235](235-google-kms-custody.md) (Google = per-(iss,sub) KMS custody) ×
[spec 253](253-one-prompt-org-create-batched-hash-approval.md) (org grants via batched `approveHash`).
ADR-0019 (relying-site = scoped delegate), the durable-org-custody doctrine (memory
`project_demo_org_durable_org_custody`).

## Reference: smart-agent patterns to port

No new smart-agent analog — this composes two existing in-repo patterns: the demo-a2a
`/custody/google/bootstrap-and-claim` server flow (spec 235) and the spec-253 client
`createChildAgentForSite` org+grants logic. We port the bootstrap-and-claim KMS-deploy shape to a CHILD
agent and add the spec-253 sentinel grants, server-side.

## 1. Problem

Org-create (`createChildAgentForSite`) **hardcodes `passkeySignHash`** and derives the org from a passkey.
But the home already routes the PERSON signup by credential (`secureHome(via)` → `secureHomeWithGoogle`
deploys the KMS-custodied person SA server-side, **zero device prompts**). A **Google-authenticated adopter
has no passkey — only KMS custody** — yet org-create asks them for a passkey. That is wrong custody (the org
should inherit the person's ROOT custody) AND a prompt that shouldn't exist.

## 2. Target

Make org-create **credential-aware**, mirroring person signup:
- **Google** → the org is custodied by the person's KMS custodian `C_sub`, deployed + named + grant-approved
  **server-side in one C_sub-signed, sponsored userOp — ZERO device prompts** (same as their person signup).
- **passkey** → the existing `createChildAgentForSite` path (1 prompt). Unchanged.
- **wallet** → EOA-signed (1 prompt). Unchanged.

The org inherits the **person's actual root custody** (KMS for Google, passkey for passkey users) — consistent
with durable-org-custody.

## 3. Design

### 3a. demo-a2a — `POST /custody/google/bootstrap-org` (client → a2a, custody session)

Mirrors `/custody/google/bootstrap-and-claim`, for a CHILD org + the spec-253 grants. Body:
`{ session, label, node, delegate, grantOrg? }` → `{ ok, org, orgId, name, delegation, brokerDelegation?,
stewardshipDelegation?, transactionHash }`.

1. Gate the custody session (`verifyCustodySession`); derive `{ cSub, sign }` =
   `deriveSubjectCustodian(gate.subject, …, { rotation })`. **C_sub is the person's custodian** — the session
   gates it. (The person SA = `getAddressForAgentAccount({custodians:[cSub], salt: 0n})`; assert it matches
   `gate.sessionSub`, exactly as bootstrap-and-claim does — this binds the request to the proven person.)
2. **Org SA** = `getAddressForAgentAccount({custodians:[cSub], salt: orgSalt})` with a server-generated random
   `orgSalt` (≠ 0n, so the org is a DISTINCT agent from the person; never name-derived — ADR-0010).
3. Build the org-as-delegator grants (spec 253), server-side (port of `buildApprovedSiteDelegation`):
   `siteGrant = org→delegate`, `brokerGrant = org→grantOrg` (when set), `stewardship = org→person`. Each =
   the canonical `Delegation` + its `hashDelegation` digest; wire signature = the `0x03` sentinel.
   (person→org membership is DEFERRED, same as spec 253.)
4. Deploy callData = `executeBatch([register(label, orgSA), setPrimaryName(node), approveHash(siteDigest),
   approveHash(brokerDigest?), approveHash(stewardDigest)])`. Build the deploy userOp
   (`buildDeployUserOpForAgentAccount({spec:{custodians:[cSub], salt: orgSalt}, callData, paymaster, …})`),
   **`C_sub` signs** the userOpHash, submit sponsored (same relayer/paymaster path as bootstrap-and-claim).
5. Return the org address + name + the three sentinel wire delegations.

### 3b. demo-sso-next client + routing

- `createOrganizationWithGoogle(sessionToken, base, delegate, opts)` (`connect-client.ts`) — POST to the
  endpoint; return the org + grants (shaped like `createChildAgentForSite`'s `CreatedAgent`).
- `createOrganization(home, base, delegate, via, auth, opts)` (`home/onboarding.ts`) — **route by `via`**:
  `google` → `createOrganizationWithGoogle`; else → `createChildAgentForSite` (passkey/wallet). Mirrors
  `secureHome`/`signHashFor`.
- The org-create handler (`EntryExperience.tsx`) passes the user's `via` + custody `auth` through (it already
  has them for the secure-home / grant steps).

## 4. Security

The custody-sensitive surface is the new endpoint. Invariants (mirroring spec 235 §5.4):
- **Session-gated C_sub.** The endpoint derives `C_sub` ONLY via a verified custody session
  (`verifyCustodySession` vs the broker JWKS, fail-closed). No session → no signature.
- **Person-binding.** Assert the session subject == the C_sub-derived PERSON SA (salt 0n) before acting — the
  request can only create an org for the PROVEN person. The org is then custodied by that person's `C_sub`
  (durable-org-custody). The "act only for the session SA" invariant adapts to "act only for an org custodied
  by the session's C_sub."
- **Server-controlled salt.** The server generates `orgSalt` (never client-supplied) so the org address +
  grant digests are server-computed; the client can't steer the org address.
- **Grants are sentinel-only** (spec 253): the org `approveHash`es its OWN outbound digests in its own deploy
  op; no custody is granted to anyone (ADR-0011). The relayer's `isRevoked` gate (spec 253) still applies.
- **G-2 audit:** C_sub signatures emit `key-custody.sign` via the audit sink (same as bootstrap-and-claim).
- Testnet-demo posture; the demo deployer key carve-out (memory `project_demo_a2a_kms_deferred`) is unchanged.

## 5. Files

- `apps/demo-a2a/src/index.ts` — the `/custody/google/bootstrap-org` handler (+ import the delegation
  hash/caveat builders for the server-side grant construction).
- `apps/demo-sso-next/src/connect-client.ts` — `createOrganizationWithGoogle`.
- `apps/demo-sso-next/src/home/onboarding.ts` — `createOrganization` routes by `via`/`auth`.
- `apps/demo-sso-next/src/components/onboarding/EntryExperience.tsx` — pass `via`/`auth` to `createOrganization`.

## 6. Acceptance

- A **Google** adopter creating an org in demo-jp (or GCO in demo-gs) completes with **ZERO device prompts**;
  the org is custodied by their `C_sub`; the org→app + org→broker + org→person grants validate via the
  approved hash (spec 253). A **passkey** user's org-create is byte-for-byte unchanged (1 prompt).
- The endpoint refuses without a valid custody session; the org SA is server-derived from the session's C_sub.
- `cd apps/demo-a2a && pnpm typecheck` + `cd apps/demo-sso-next && pnpm typecheck && pnpm build` green.
