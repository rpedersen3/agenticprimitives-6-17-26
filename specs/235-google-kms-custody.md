# Spec 235 — Google × KMS custody (social sign-in as a full custody path)

Status: PLANNED 2026-05-29. Architect-of-record for a credential path where **Google OAuth
identifies a member and a per-Google-subject key derived from the HSM/KMS custodies their Smart
Agent** — so signing in with Google ALONE grants full custody (deploy, name, grant, act), with
no device gesture. Sits alongside passkey + SIWE/EOA in `apps/demo-sso-next`. Google and the KMS
signer each exist today, but **the combination is not coded** — this builds it.

## 1. Why

Faith-community members who don't want a passkey or a crypto wallet should still get a real,
owned agent. Google is the lowest-friction identity; an HSM/KMS-backed key gives that identity
on-chain custody without the member holding a key. The member can later **graduate** to a
passkey/wallet and drop the server custodian (§7).

## 2. Reference: smart-agent patterns to port

- `smart-agent apps/web/src/lib/auth/oauth-salt.ts` — `deriveOauthSalt(email,rotation)` = KMS-HMAC
  over a canonical message → 32-byte CREATE2 salt (a deterministic, KMS-bound derivation that
  never leaks the master).
- `smart-agent .../google-callback/route.ts` — `deploySmartAccountWithBootstrap(serverEOA, salt,
  bootstrap)`: a server KMS signer (`auth-bootstrap` tool-executor) is the SA's initial custodian
  and signs deploy/userOps on the member's behalf until they enroll their own credential.
- `packages/key-custody` — `buildSignerBackend` / `createKmsViemAccount` / `GcpKmsProvider` /
  `generateMac`. ADR-0010 (address = identity), ADR-0011 (credentials are replaceable facets),
  ADR-0017 (login-grade vs custody-grade).

**Deliberate divergence:** smart-agent uses a SHARED bootstrap signer + per-subject *salt*
(address isolation, one signing key for everyone). We derive a **per-(iss,sub) signing key** so
the *custodian itself* differs per member — a single leaked derived key cannot custody another
member's agent. (`key-custody` marks per-subject derivation as a not-yet-built v0.1 TODO; this
spec builds it.)

## 3. Trust model (the crown jewel — read first)

- The server (demo-a2a relayer) holds the **master / KMS root** and can derive ANY member's
  custodian key `C_sub`. It is therefore a **fully-trusted custodian** for every Google member.
  **Master/KMS-root compromise = compromise of every Google-custodied member.** This is the same
  posture as smart-agent's shared bootstrap signer; per-subject keys only narrow the blast radius
  of a *single derived-key* leak, not a root compromise.
- **Signing in with Google alone = full control by design.** A Google-account takeover becomes an
  agent takeover. Mitigations: the per-subject key gate (§5), surfacing this in consent copy, and
  **graduation** (§7) — adding a passkey/wallet + removing `C_sub` so the agent no longer depends
  on server custody.
- The member never holds `C_sub`; the server derives + signs on their behalf, gated by a valid
  Google session (§5).

## 4. The derivation + the agent shape

- **Per-subject custodian** `C_sub` = a secp256k1 signer whose private key is derived from the
  master, bound to the Google subject. Canonical message: `kms-custodian:v1:{iss}:{sub}:{rotation}`.
  - **local-aes (demo):** `HKDF(master, salt = canonical, info = "kms-custodian:v1")` → 32-byte
    secp256k1 private key. (KMS deferred for the demo, per the local-key pattern + production guards.)
  - **gcp-kms / aws-kms (prod):** `generateMac(canonical)` → 32 bytes → reduce mod n → secp256k1
    private key. The MAC never leaves the KMS boundary; the derived key is deterministic.
  - Output: a viem account whose ADDRESS is `C_sub` (signs 32-byte userOp/EIP-712 hashes).
- **The agent** `SA_expected = getAddressForAgentAccount({ mode:0, custodians:[C_sub], salt:0n })`
  — deterministic per subject (same shape as the SIWE/EOA path, with the derived address as the
  custodian). New API: `key-custody` `deriveSubjectSigner({subject:{iss,sub,rotation?}, backend})`.

## 5. The security gate (the boundary)

All server custody happens in **demo-a2a** (it holds the master); authorization crosses the
boundary as a **broker-minted Google session**. Two gasless endpoints, both behind the SAME gate:

- `POST /custody/google/bootstrap-and-claim { googleSession, base }` — deploy `SA_expected` +
  claim `<base>` + setPrimary, signed by `C_sub`.
- `POST /custody/google/sign { googleSession, hash, sender }` — return the `C_sub` signature for a
  userOp/delegation digest (post-onboarding actions, incl. graduation).

**THE GATE (every call):**
1. Verify `googleSession` against the **broker JWKS** (pin `iss` = the Connect origin, `aud` =
   the demo-sso AUD). Require `assurance:'onchain-confirmed'` + `role:'custody-grade'` for the
   Google+KMS facet. Reject otherwise. Fail-closed if the JWKS is unreachable.
2. Read `(iss,sub)` **from the verified session** — never from the request body.
3. Derive `C_sub`; compute `SA_expected(iss,sub)`.
4. **Invariant: act ONLY for `SA_expected`.** `bootstrap-and-claim` deploys/claims for it only;
   `sign` requires `sender == SA_expected`. No client-supplied target/sender is honored.

The broker (`server/oidc/google/callback.ts`) mints the custody-grade session (§4 shape) +
records `facet:oidc:{iss}#{sub} → SA_expected`. **Existing facet wins:** a returning Google
member resolves to their already-linked SA; only a truly-new `(iss,sub)` gets a fresh
KMS-custodied `SA_expected` (no two SAs per Google account).

## 6. Custody invariants (ADR-0010 / 0011)

The SA address is canonical and never changes. `C_sub` is a **credential facet** — replaceable.
The Google session is custody-grade because `C_sub` is a real on-chain custodian of `SA_expected`
(not a login-grade assertion needing step-up).

## 7. Graduation (off server custody)

A Google member can add their own credential and remove the server custodian: add a passkey/wallet
(`addPasskey`/`addCustodian`, `onlySelf` — signed by `C_sub` via `/custody/google/sign`), then
`removeCustodian(C_sub)` once the new credential is on-chain. Endpoint accepts those calldatas
(invariant: `sender == SA_expected`). **Recommend graduation on first real action** to avoid
permanent server custody. (Endpoint built now; UI is a follow-up.) **Recovery/lockout:** if the
KMS key rotates/is lost before graduation, an un-graduated member is locked out — graduation is
the mitigation; state it in the member-facing copy.

## 8. Phases

W1 `key-custody.deriveSubjectSigner` (+ tests, spec 203). W2 demo-a2a endpoints + the gate.
W3 broker callback → custody-grade session + facet. W4 client/UI (Continue/Create with Google;
`secureHome('google')`/`givePermission('google')` via the server). W5 graduation endpoint.
W6 security-auditor pass.

## 9. Security checklist (acceptance gate — security-auditor pass)

1. The gate: never derive/sign without a valid JWKS-verified, custody-grade, aud-pinned Google
   session for that exact `(iss,sub)`; `SA == derived` invariant on BOTH endpoints; no
   client-supplied sender/target honored.
2. Master/KMS-root = crown jewel (documented; per-subject keys bound single-leak only).
3. Key isolation: distinct address per `sub`; one-way derivation; mod-n reduction sound (reject 0).
4. Google-takeover → agent-takeover surfaced in consent copy; graduation as mitigation.
5. Session replay / `aud` confusion between broker session + the demo-a2a gate (pin iss/aud).
6. Production guards: local-aes derivation refuses production without `A2A_ALLOW_LOCAL_MASTER_KEY`;
   no silent fallback.

## 10. Out of scope

- A dedicated per-subject KMS *asymmetric* key (vs HMAC-derived) — a possible hardening follow-up.
- Graduation UI (endpoint only this wave).
- Non-Google OIDC providers (the pattern generalizes; not built here).
