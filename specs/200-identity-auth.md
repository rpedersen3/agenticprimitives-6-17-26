# Spec 200 — `@agenticprimitives/identity-auth`

**Capability:** Authenticate a user via passkey + SIWE + Google OAuth, mint sessions, expose pluggable signer interfaces that `agent-account` and `delegation` consume.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/apps/web/src/lib/auth/*`, `smart-agent/apps/web/src/app/api/auth/*` on branch `003-intent-marketplace-proposal`.

> **Important finding from research:** Smart-agent originally integrated Privy but replaced it with its own auth stack. The current stack — passkey + SIWE + Google OAuth + JWT sessions + signer interfaces — IS the "Privy-style abstraction" the user wants, with the upside that no SaaS dependency is required.

---

## 1. Goal

Three things in one cohesive flow:

1. **Authenticate a user** via passkey (WebAuthn), SIWE (wallet signature), or OAuth (Google initially).
2. **Mint a session** (JWT in an httpOnly cookie) that downstream services can verify without re-asking the IdP.
3. **Expose pluggable `Signer` interfaces** that `@agenticprimitives/agent-account` and `@agenticprimitives/delegation` consume — abstracting how the user signs (passkey assertion vs EOA personal_sign vs KMS-backed signing) from the consuming packages.

Out of scope (by design): the smart account itself (`agent-account`), KMS backends (`key-custody`), HTTP wiring, cookie I/O specifics, UI.

---

## 2. Auth methods (v0)

| Method | Identifier | Initial smart-account owner | Smart-agent ref |
| --- | --- | --- | --- |
| **Passkey (WebAuthn)** | label hash → CREATE2 salt | `auth-bootstrap` relayer signer | `api/auth/passkey-signup/route.ts:90-381` |
| **SIWE (EOA wallet)** | EOA address | the user's EOA | `api/auth/siwe-verify/route.ts:41-144` |
| **Google OAuth** | email hash → CREATE2 salt | `auth-bootstrap` relayer signer | `api/auth/google-callback/route.ts:40-100+` |

Tree-shakable: importing `@agenticprimitives/identity-auth/passkey` does NOT pull SIWE or Google code.

### Why these three (and not Privy directly)
Privy is a hosted IdP — fine for many apps, but creates lock-in. Smart-agent demonstrated that a thin self-hosted stack covers the same UX: passkey for new users without wallets, SIWE for crypto-native users, Google for the broad consumer case.

---

## 3. Session model

- **Cookie:** `agentic-session` (configurable name), `httpOnly`, `Secure`, `SameSite=Lax`, default 24h TTL.
- **Signing:** HS256 JWT with key rotation. Env: `SESSION_JWT_SECRETS=kid:hexsecret,kid:hexsecret`. The leftmost key signs; all keys verify.
- **Claims:**
  ```ts
  interface JwtClaims {
    sub: string;                // DID
    walletAddress: Address | null;
    smartAccountAddress: Address;
    name: string;
    email: string | null;
    via: 'passkey' | 'siwe' | 'google';
    kind: 'session' | 'session-grant';
    iat: number;
    exp: number;
  }
  ```
- **Verification:** `verifySession(cookieValue)` returns claims or `null`. Constant-time signature comparison.

Smart-agent ref: `apps/web/src/lib/auth/native-session.ts:1-79`, `apps/web/src/lib/auth/jwt.ts`.

---

## 4. The Signer interface contract

The package's most important architectural commitment: a single `Signer` interface that downstream packages (`agent-account`, `delegation`) consume without knowing whether the signer is a passkey credential, an EOA wallet, or a KMS-backed key. This makes the auth stack swappable without touching account / delegation code.

```ts
export interface Signer {
  readonly address: Address;
  signMessage(msg: string | { raw: Hex }): Promise<Hex>;
  signTypedData(args: {
    domain: TypedDataDomain;
    types: TypedDataTypes;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

// Specializations carry method-specific metadata when needed
export interface PasskeySigner extends Signer {
  readonly credentialId: string;
  assert(challenge: Hex): Promise<PasskeyAssertion>;
}

export interface EOASigner extends Signer { /* viem-compatible */ }

export interface KMSSigner extends Signer {
  readonly keyId: string;
  readonly provider: 'local-aes' | 'aws-kms' | 'gcp-kms';
}
```

Concrete implementations of `KMSSigner` are produced by `@agenticprimitives/key-custody` (via `createKmsAccount(backend)`); concrete implementations of `EOASigner` come from `viem` (`privateKeyToAccount`); `PasskeySigner` is produced by this package's `passkey` module.

---

## 5. Public API

```ts
// Session
export function mintSession(claims: Omit<JwtClaims, 'iat' | 'exp'>): string;
export function verifySession(cookieValue: string): JwtClaims | null;
export const SESSION_COOKIE: string;
export const SESSION_TTL_SECONDS: number;

// CSRF
export function csrfTokenFor(origin: string): string;
export function verifyCsrf(token: string, allowedOrigins: string[]): boolean;

// Signer interfaces
export type { Signer, PasskeySigner, EOASigner, KMSSigner };

// Salt derivation (consumed by agent-account for deterministic addressing)
export function deriveSaltFromLabel(label: string): bigint;
export function deriveSaltFromEmail(email: string, rotation: number): bigint;

// Auth method subpaths (tree-shakable)
import * as passkey from '@agenticprimitives/identity-auth/passkey';
import * as siwe from '@agenticprimitives/identity-auth/siwe';
import * as google from '@agenticprimitives/identity-auth/google';

// Types
export type { JwtClaims, AuthenticatedUser, AuthMethod };
```

### What stays in the consumer
- HTTP route wiring (Next.js / Express / Hono — package is framework-agnostic).
- Cookie writing/reading.
- Database adapters for OAuth profile cache.
- OAuth client IDs/secrets and redirect URIs.
- UI: login screens, `AuthGate`, account-creation progress.

---

## 6. Security boundaries

- **No plaintext private keys.** Passkey material stays in the authenticator. SIWE wallets stay in the wallet. Google flow uses a relayer signer from `key-custody`.
- **JWT secrets** never logged; redaction in error paths. Rotation via `SESSION_JWT_SECRETS` comma list.
- **CSRF** enforced on state-changing auth endpoints. Origin allowlist is exact-match parsed URL, not substring.
- **Replay** on passkey assertions guarded by WebAuthn challenge nonces.
- **No account-hijack via salt collision:** salt derives from a stable identifier under a strong hash; collisions are cryptographically infeasible.

---

## 7. Test plan (v0)

- Unit: `mintSession` round-trip, `verifySession` with rotated keys, salt derivation determinism, CSRF allowlist.
- Integration: passkey assertion verification, SIWE EIP-191 verification, Google OAuth state+nonce roundtrip with mocked IdP.
- Browser: WebAuthn ceremony via Playwright virtual authenticator.

---

## 8. Open questions

1. **Email/password fallback?** Smart-agent has none; keep stance.
2. **Apple Sign In?** Out of scope v0; structurally identical to Google flow.
3. **Telemetry hooks** (`onAuthEvent` callback) for audit emission?

---

## 9. Smart-agent file index

| Concern | File | Lines |
| --- | --- | --- |
| Session JWT | `apps/web/src/lib/auth/native-session.ts` | 1–79 |
| JWT signing/rotation | `apps/web/src/lib/auth/jwt.ts` | full |
| CSRF | `apps/web/src/lib/auth/csrf.ts` | full |
| Passkey signup | `apps/web/src/app/api/auth/passkey-signup/route.ts` | 90–381 |
| SIWE verify | `apps/web/src/app/api/auth/siwe-verify/route.ts` | 41–144 |
| Google callback | `apps/web/src/app/api/auth/google-callback/route.ts` | 40–100+ |
