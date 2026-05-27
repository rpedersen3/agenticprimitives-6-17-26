# Spec 233 — Cross-device passkeys (discoverable sign-in + link-a-device)

Status: PLANNED 2026-05-27. Fixes the demo's single-browser passkey limitation:
the credential handle was cached in `localStorage`, so `signWithPasskey` threw
`no registered passkey` on any browser/device except the one where it was created
(phone, Firefox). Two mechanisms, both preserving the custody invariant that a
credential is added ONLY by an existing credential (ADR-0011 / spec 221 / the
CLAUDE rule: credential add is custody-policy-governed, NEVER self-serve).

## 1. Why it's feasible with no contract change

On-chain primitives already exist (Explore-verified):
- `AgentAccount.getPasskey(bytes32 credentialIdDigest) → (uint256 x, uint256 y)`
  (`apps/contracts/src/AgentAccount.sol:1286`) + `hasPasskey` + `passkeyCount`.
- Sign-in verification is **already on-chain**: `isValidSignature(hash, sig)` →
  `_verifyWebAuthn` decodes the assertion, reads `credentialIdDigest` FROM the
  assertion, looks up the stored pubkey via `getPasskey`, and verifies P256 via
  `WebAuthnLib` / `P256Verifier`. The client-supplied `pubKeyX/Y` are NOT trusted.
- `addPasskey(digest,x,y)` is `onlySelf` → enrolled via a UserOp signed by an
  existing custodian (the ROOT). PIA becomes a first-class custodian.
- Registration already uses `residentKey: 'preferred'` (discoverable-capable).

So: the server can verify a **discoverable** assertion (no localStorage, no
client pubkey) as long as it knows WHICH agent's SA to check — and the demo is
**name-first**, so it already does.

## 2. Mechanism A — Discoverable sign-in (roam a synced passkey) [Phase 1]

Removes the `localStorage` dependency from sign-in. At the central auth
(`<handle>.impact-agent.me`, demo-sso-next):

1. User types their name → resolve to the agent SA (existing `/connect/name-info`).
2. `navigator.credentials.get({ publicKey: { challenge, rpId: <serving host>,
   allowCredentials: [], userVerification: 'required' } })` — **empty
   allowCredentials = discoverable**; the platform offers any passkey for this RP
   (including platform-synced ones, e.g. the same Google/Apple account on a phone).
3. Encode the assertion into the on-chain signature blob (the SAME encoding the
   current flow uses); the `credentialIdDigest` is carried inside it.
4. `POST /connect/passkey { agent|name, challenge, signature }` → server calls
   `isValidSignature(agentSA, challenge, signature)` on-chain → valid iff the
   asserting credential is a registered passkey of that SA. No `pubKeyX/Y`, no
   localStorage. Issue the session/`id_token` on success.

Effect: a synced passkey signs in on any device sharing the user's
Google/Apple account. (Does NOT bridge Chrome↔Firefox on one machine — different
credential stores; that case needs Mechanism B.) When the platform offers no
passkey for the RP, the UI falls through to "set up this device" (Mechanism B).

**Client change** (`src/lib/passkey.ts`): add `signWithDiscoverablePasskey(challenge)`
(empty `allowCredentials`); the sign-in path stops calling `loadPasskey()`.
**No server contract change** — `/connect/passkey` already verifies on-chain;
it just stops requiring `pubKeyX/Y` and takes the resolved `agent`.

## 3. Mechanism B — Link a device (enroll a new per-device passkey) [Phase 2]

For browsers/devices with no synced passkey (Firefox vs Chrome on one machine).
The new device gets its OWN passkey, enrolled by the ROOT (no self-add):

1. **New device** (`<handle>.impact-agent.me`, signed in only as "needs setup"):
   `navigator.credentials.create({ ... residentKey: 'required', user.id =
   <agent-address bytes> })` → `{ credentialIdDigest, x, y }`. POST an enrollment
   REQUEST to a pending store: `KV linkreq:<code> = { agent, digest, x, y, ts }`
   (short TTL). Show the `<code>` (or a QR).
2. **Original device** (has the ROOT, signed in custody-grade): lists pending
   `linkreq`s for the agent (or scans the code), shows consent ("Add a new
   sign-in key for <name>? fingerprint <digest>"), and on approval signs
   `execute(self, addPasskey(digest,x,y))` via the hardened nonce-gated relayer
   (reuse `addPasskeyCredential`). ROOT-authorized → custody invariant intact.
3. **New device** polls `linkreq:<code>` → once `addPasskey` lands on-chain
   (`hasPasskey(agent,digest)` true), it discoverable-signs-in (Mechanism A).

Relying sites (demo-org): the same shape, but the new device's key is enrolled as
a **scoped delegate** (ERC-7710 delegation, ROOT signs `hashDelegation`) rather
than a custodian (ADR-0019) — reuse `issueSiteDelegation`.

**New surface:** a `linkreq` KV store + `POST /connect/link/request` (new device)
+ `GET /connect/link/pending` + `POST /connect/link/approve` (ROOT device). No
contract change (`addPasskey` exists).

## 4. Security invariants (DO NOT BREAK)
- **On-chain verification only** — sign-in trusts `isValidSignature` (the SA looks
  up the pubkey by digest); never a client-supplied pubkey.
- **No self-add** — a new device's key becomes a credential ONLY via a
  ROOT-signed `addPasskey`/delegation. The `linkreq` is a *request*, not a grant.
- **Consent + fingerprint** on the ROOT device names the requesting context + the
  key digest (audit F2). `linkreq` is single-use, TTL-bounded, agent-scoped.
- **userVerification: 'required'** on both create + get.

## 5. Reference: patterns to port
- agenticprimitives on-chain: `getPasskey` / `isValidSignature` / `addPasskey`
  (above). smart-agent has session-signing but **no** cross-device pattern
  (Explore-confirmed) — this is net-new; agentic-trust atp-agent's
  `session/hybrid-init` / `session/package` is the closest analog for the
  request/approve handshake shape.

## 6. Phase plan
- **P1 — Discoverable sign-in** (Mechanism A) in demo-sso-next: **IMPLEMENTED
  2026-05-27** — `signWithDiscoverablePasskey` (`src/lib/passkey.ts`, reads the
  chosen credential from `rawId`, no localStorage) + `passkeySignHash` switched to
  it (`src/connect-client.ts`), so the enroll/approve + all ROOT-signed ceremonies
  roam to any device holding the (synced) passkey. No contract/server change
  (server already verifies on-chain via `isValidSignature`). Builds clean.
- **P2 — Link-a-device** (Mechanism B): the `linkreq` store + request/approve
  endpoints + the ROOT-device approval UI + new-device polling. Covers non-synced
  browsers/devices.
- **P3 (optional) — Nameless discoverable**: encode the agent address in
  `user.id` (userHandle) at registration so `get()` returns it → sign in without
  typing the name. Removes the name-first dependency.

## 7. Out of scope
- Contract changes (none needed; on-chain reverse lookup `digest→agent` is NOT
  added — name-first + KV `facet:cred:` index suffice).
- WebAuthn cross-device hybrid (caBLE/QR phone-as-authenticator) — the platform
  handles that under `get()`; we don't implement the transport.
