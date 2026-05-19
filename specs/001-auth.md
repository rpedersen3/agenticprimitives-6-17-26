# Spec 001 — `@agenticprimitives/auth`

**Capability:** Privy-style user authentication, federated identity, and deterministic ERC-4337 smart account initiation.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/apps/web/src/lib/auth/*`, `smart-agent/apps/web/src/app/api/auth/*`, `smart-agent/packages/sdk/src/account.ts`

> **Important finding from research:** Smart-agent originally integrated Privy but replaced it with its own auth stack. The env vars `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` remain in `.env.example` for historical reasons, but the Privy SDK is no longer a dependency. The current stack — passkey + SIWE + Google OAuth + JWT sessions + deterministic ERC-4337 accounts — is exactly the "Privy-style abstraction" we want.

---

## 1. Goal

Give any web app three things in one cohesive flow:

1. A way to **authenticate a user** via passkey (WebAuthn), SIWE (wallet signature), or OAuth (Google initially).
2. A **session** (JWT in an httpOnly cookie) that downstream services can verify without re-asking the IdP.
3. A **deterministic ERC-4337 smart account** address bound to the authenticated user, deployable on first action (lazy).

Out of scope: KYC, account recovery flows beyond signer rotation, multi-tenant org switching (lives in the consuming app).

---

## 2. Auth methods (v0)

| Method | Identifier | Initial smart-account owner | Smart-agent ref |
| --- | --- | --- | --- |
| **Passkey (WebAuthn)** | label hash → CREATE2 salt | `auth-bootstrap` relayer signer | `api/auth/passkey-signup/route.ts:90-381` |
| **SIWE (EOA wallet)** | EOA address | the user's EOA | `api/auth/siwe-verify/route.ts:41-144` |
| **Google OAuth** | email hash → CREATE2 salt | `auth-bootstrap` relayer signer | `api/auth/google-callback/route.ts:40-100+` |

A consumer can enable any subset. The package ships method modules that share session/account types but don't depend on each other.

### Why these three (and not Privy directly)
Privy is a hosted IdP — fine for many apps, but creates lock-in. Smart-agent demonstrated that a thin self-hosted stack covers the same UX: passkey for new users without wallets, SIWE for crypto-native users, Google for the broad consumer case. We preserve that flexibility.

---

## 3. Session model

- **Cookie:** `agentic-session` (configurable name), `httpOnly`, `Secure`, `SameSite=Lax`, default 24h TTL.
- **Signing:** HS256 JWT with key rotation. Env: `SESSION_JWT_SECRETS=kid:hexsecret,kid:hexsecret`. The leftmost key signs; all keys verify.
- **Claims:**
  ```ts
  interface JwtClaims {
    sub: string;                // DID (did:ethr:<chainId>:<address> for SIWE, app-specific for others)
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

## 4. Smart account model

- **Standard:** ERC-4337 v0.8 (`@account-abstraction/contracts`).
- **Account contract:** `AgentAccount` (UUPS upgradeable, owner-based, supports ERC-1271 for delegation signatures, supports passkey assertion).
- **Factory:** `AgentAccountFactory.getAddress(owner, salt)` / `.createAccount(owner, salt)` — CREATE2 for deterministic address before deploy.
- **Deployment:** lazy. Address is known after auth; contract deploys on first UserOp (typically when the user issues their first delegation).

### Salt derivation per auth method
| Method | Salt |
| --- | --- |
| Passkey | `BigInt(keccak256(label).slice(0, 18))` |
| SIWE | `0n` |
| Google | `deriveSaltFromEmail(email, rotation)` (rotation enables "Start Fresh") |

### Required env (consumer-supplied)
```
NEXT_PUBLIC_CHAIN_ID
RPC_URL
ENTRYPOINT_ADDRESS                  # ERC-4337 v0.8 EntryPoint
AGENT_FACTORY_ADDRESS               # AgentAccountFactory
AGENT_NAME_REGISTRY_ADDRESS         # optional, for .agent ENS
SESSION_JWT_SECRETS                 # kid:hex,kid:hex
SESSION_COOKIE_NAME                 # optional override
SESSION_TTL_SECONDS                 # optional override (default 86400)
```

Smart-agent ref: `packages/sdk/src/account.ts:1-88`, `packages/contracts/src/AgentAccount.sol`.

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

// Smart account
export class AgentAccountClient {
  constructor(opts: { rpcUrl: string; chainId: number; entryPoint: Address; factory: Address });
  getAddress(owner: Address, salt: bigint): Promise<Address>;
  createAccount(params: CreateAgentAccountParams): Promise<Address>;
  isOwner(account: Address, address: Address): Promise<boolean>;
  isDeployed(account: Address): Promise<boolean>;
}

// Auth method modules (tree-shakable)
export * as passkey from './methods/passkey';   // beginSignup / completeSignup / beginLogin / completeLogin
export * as siwe from './methods/siwe';         // buildMessage / verify
export * as google from './methods/google';     // buildAuthUrl / handleCallback

// Types
export type { AuthenticatedUser, JwtClaims, AuthMethod, CreateAgentAccountParams };
```

### What stays in the consumer
- HTTP route wiring (Next.js / Express / Hono — the package is framework-agnostic).
- Cookie writing/reading (Node `Set-Cookie` vs Next `cookies()` vs Express `res.cookie`).
- Database adapters for OAuth profile cache (passkey + SIWE are stateless and need no DB).
- OAuth client IDs/secrets and redirect URIs.
- "Hub routing" / post-login redirect logic.
- UI: login screens, `AuthGate` component, account-creation progress UI.

---

## 6. Security boundaries

- **No plaintext private keys.** Passkey private material stays in the authenticator. SIWE wallets stay in the wallet. Google flow uses a relayer signer (which lives in `@agenticprimitives/kms`, not here).
- **JWT secrets** never logged; redaction in error paths. Rotation supported via `SESSION_JWT_SECRETS` comma list.
- **CSRF** enforced on auth state-changing endpoints (signup/login/logout). Origin allowlist is exact-match parsed URL, not substring. Ref: `apps/web/src/lib/auth/csrf.ts`.
- **Replay** on passkey assertions guarded by WebAuthn challenge nonces (`api/auth/passkey-challenge`).
- **Account hijack via salt collision:** prevented because salt is derived from a stable user identifier (label / email) under a strong hash; collisions are cryptographically infeasible.

---

## 7. Test plan (v0)

- Unit: `mintSession` round-trip, `verifySession` with rotated keys, salt derivation determinism, CSRF allowlist.
- Integration: deterministic-address-then-deploy on local Anvil, passkey assertion verification via fixture, SIWE EIP-191 verification, Google OAuth state+nonce roundtrip with mocked IdP.
- Browser: WebAuthn ceremony via Playwright virtual authenticator.

---

## 8. Open questions

1. **Email/password fallback?** Smart-agent has none; reasonable to keep that stance. Consumers who need it can layer their own.
2. **Apple Sign In?** Out of scope v0; structurally identical to Google flow.
3. **Account abstraction migration when ERC-4337 v0.9 ships?** Address determinism breaks across EntryPoint versions; we'll need a migration path. Note for v0.1.
4. **Telemetry hooks?** Smart-agent emits audit events at signup/login. Worth exposing as a `onAuthEvent` callback.

---

## 9. Smart-agent file index (provenance)

| Concern | File | Lines |
| --- | --- | --- |
| Session JWT | `apps/web/src/lib/auth/native-session.ts` | 1–79 |
| JWT signing/rotation | `apps/web/src/lib/auth/jwt.ts` | full |
| CSRF | `apps/web/src/lib/auth/csrf.ts` | full |
| Passkey signup | `apps/web/src/app/api/auth/passkey-signup/route.ts` | 90–381 |
| SIWE verify | `apps/web/src/app/api/auth/siwe-verify/route.ts` | 41–144 |
| Google callback | `apps/web/src/app/api/auth/google-callback/route.ts` | 40–100+ |
| Account client | `packages/sdk/src/account.ts` | 1–88 |
| `AgentAccount` contract | `packages/contracts/src/AgentAccount.sol` | full |
| `AgentAccountFactory` | `packages/contracts/src/AgentAccountFactory.sol` | full |
