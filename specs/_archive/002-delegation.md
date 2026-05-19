# Spec 002 — `@agenticprimitives/delegation`

**Capability:** Smart-account delegation manager. Issue, mint, validate, redeem, and revoke EIP-712 delegations spanning web app → A2A agent → MCP server.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/packages/sdk/src/delegation.ts`, `delegation-token.ts`, `policy/caveat-evaluator.ts`; `apps/a2a-agent/src/routes/{session-init,session,delegation}.ts`; `apps/person-mcp/src/auth/verify-delegation.ts`.

---

## 1. Goal

A standalone library that implements the full delegation lifecycle as it exists in smart-agent today, without dragging any of smart-agent's app shells. A consumer should be able to:

- **In the browser:** build a delegation, have the user sign it (wallet popup or passkey assertion), and submit it to their agent.
- **In a node agent:** receive a signed delegation, store it encrypted, and mint scoped tokens redeemable by downstream MCPs.
- **In an MCP server:** verify a token end-to-end (signature → on-chain revocation → ERC-1271 → caveats → replay).

This is described by the product owner as "a very strong pattern" — the spec preserves its structure rather than reinventing it.

---

## 2. Standard

EIP-712 typed-data delegations, **ERC-7710-aligned** but **not** the MetaMask Delegation Framework verbatim. The `Delegation` struct:

```solidity
struct Delegation {
  address delegator;     // smart account that grants authority
  address delegate;      // who can act under that authority (session key in v0)
  bytes32 authority;     // ROOT_AUTHORITY (= 0) for top-level; otherwise parent delegation hash
  Caveat[] caveats;      // scope restrictions
  uint256 salt;          // uniqueness
  bytes signature;       // ERC-1271 signature from delegator (the smart account)
}

struct Caveat {
  address enforcer;
  bytes terms;
  bytes args;            // optional, runtime-supplied
}
```

The delegator signs via ERC-1271 — i.e., the smart account's `isValidSignature(hash, sig)` returns the EIP-1271 magic value `0x1626ba7e`. This lets passkey-backed accounts produce delegation signatures without the user holding an EOA.

Smart-agent ref: `packages/sdk/src/delegation.ts:15-60`.

---

## 3. Caveat vocabulary

Two categories: **on-chain enforcers** (deployed contracts) and **off-chain sentinels** (synthetic addresses recognized by the evaluator only).

### On-chain enforcers
| Enforcer | Terms | Enforced |
| --- | --- | --- |
| `TimestampEnforcer` | `abi.encode(uint validAfter, uint validUntil)` | off-chain + on-chain |
| `ValueEnforcer` | `abi.encode(uint maxValue)` | on-chain redeem |
| `AllowedTargetsEnforcer` | `abi.encode(address[])` | off-chain (if target known) + on-chain |
| `AllowedMethodsEnforcer` | `abi.encode(bytes4[])` | off-chain (if selector known) + on-chain |
| `TaskBindingEnforcer` | `abi.encode(bytes32 taskId)` | on-chain audit annotation |
| `CallDataHashEnforcer` | `abi.encode(bytes32 expectedHash)` | on-chain sub-delegated redeem |
| `RecoveryEnforcer` | `abi.encode(address[] guardians, uint threshold, uint delay)` | on-chain |
| `RateLimitEnforcer` | `abi.encodePacked(bytes32 scopeKey, uint32 maxCalls, uint32 windowSec)` (40 bytes) | on-chain |

### Off-chain sentinels (synthetic enforcer addresses)
| Sentinel | Terms | Purpose |
| --- | --- | --- |
| `MCP_TOOL_SCOPE_ENFORCER` (`keccak256('urn:smart-agent:mcp-tool-scope')[0:20]`) | `abi.encode(string[] allowedTools)` | restrict which MCP tools the delegation authorizes |
| `DATA_SCOPE_ENFORCER` (`keccak256('urn:smart-agent:data-scope')[0:20]`) | `abi.encode(DataScopeGrant[])` | field-level resource access grants |
| `DELEGATE_BINDING_ENFORCER` (`keccak256('urn:smart-agent:delegate-binding')[0:20]`) | `abi.encode(address delegateSmartAccount, address delegatePersonAgent)` | dual-address binding for cross-delegations |

```ts
interface DataScopeGrant {
  server: string;       // 'urn:mcp:server:org'
  resources: string[];  // ['profile', 'wallet']
  fields: string[];     // ['email', 'phone']
}
```

Smart-agent ref: `packages/sdk/src/delegation.ts` (lines 105–500), `packages/sdk/src/policy/caveat-evaluator.ts` (lines 92–342).

---

## 4. Token envelope (a2a-agent → MCP)

A2A agents do **not** re-sign delegations on the user's behalf. Instead, they mint a **DelegationToken** — a JWT-like envelope — signed by the **session key** named as `delegate` in the underlying delegation.

```ts
interface DelegationTokenClaims {
  iss: 'agenticprimitives-a2a' | string;     // agent identifier
  aud: string;                                // e.g. 'urn:mcp:server:person'
  sub: string;                                // smart account address (delegator)
  delegation: Delegation;                     // the user-signed delegation struct
  sessionKeyAddress: Address;
  jti: string;                                // unique token id, for replay protection
  iat: number;
  exp: number;
  usageLimit?: number;                        // default 10
}
```

Format: **base64url(canonicalJSON(claims)) + '.' + base64url(sessionKeySig(canonicalJSON))**. Verification recovers the session key address from the signature and asserts it equals `claims.sessionKeyAddress`.

Smart-agent ref: `packages/sdk/src/delegation-token.ts` (lines 67–152), `apps/a2a-agent/src/routes/delegation.ts` (lines 34–115).

---

## 5. The session-delegation lifecycle

```
1. User logs in (auth package).
2. A2A: POST /session/init
   ├─ generates session keypair (sk, pk_sessionKey)
   └─ stores encrypted {sk} with status=pending
3. Web: builds Delegation { delegator=user smartAccount,
                           delegate=pk_sessionKey,
                           caveats=[...time, mcp-scope, data-scope] }
   user signs (passkey or wallet → ERC-1271 against smart account)
4. A2A: POST /session/package
   ├─ verifies signature via smart account's isValidSignature
   ├─ re-encrypts {sk, delegation} as full package
   └─ marks session active
5. Web: tool call → A2A
6. A2A: decrypt session, mintDelegationToken(claims, sk.signMessage)
7. A2A → MCP: HTTP w/ HMAC envelope (kms package), body carries token
8. MCP: verifyDelegationToken(token):
   ├─ recover sessionKey from token signature
   ├─ hashDelegation(delegation) under chainId + DelegationManager addr
   ├─ DelegationManager.isRevoked(hash) — on-chain check
   ├─ AgentAccount(delegator).isValidSignature(hash, sig) — ERC-1271
   ├─ evaluateCaveats(...) — fail-closed dispatcher
   └─ atomic JTI usage tracking against usageLimit
9. Tool handler runs with verified principal = delegation.delegator
```

Two **session variants** exist:
- **Variant A (legacy/off-chain):** delegation's `delegate` = the smart account itself; session key signs tokens.
- **Variant B (Phase B, on-chain):** delegation's `delegate` = the session key EOA directly; session key can also sign on-chain via `redeem-via-account`. Pre-Phase-B sessions have `variant=NULL` and are treated as A.

Smart-agent ref: `apps/a2a-agent/src/routes/session-init.ts`, `apps/a2a-agent/src/routes/onchain-redeem.ts`.

---

## 6. Cross-delegation (delegated-to-third-party)

When User A delegates to User B's agent (e.g., a coach reading A's profile via B's agent):

- The on-chain delegation is **delegator=A, delegate=B**.
- B's agent stores the received delegation in a **`received_delegations`** table keyed by `(holderPrincipal=B, delegatorPrincipal=A, audience, delegationHash)`.
- When B's agent calls the MCP, it presents both its own session token AND the cross-delegation. The MCP runs both verification paths.
- The **`DELEGATE_BINDING_ENFORCER`** caveat locks the delegate to a `(smartAccount, personAgent)` pair, preventing impersonation by an unrelated session.

Smart-agent ref: `apps/person-mcp/src/tools/received-delegations.ts`, `apps/person-mcp/src/auth/verify-delegation.ts` (lines 261–493).

---

## 7. Public API

### Core (universal, no IO)
```ts
// Types
export type { Delegation, Caveat, DataScopeGrant, DelegationTokenClaims };

// Caveat builders
export const ROOT_AUTHORITY: Hex;  // 0x00...00
export function buildCaveat(enforcer: Address, terms: Hex, args?: Hex): Caveat;
export function encodeTimestampTerms(validAfter: number, validUntil: number): Hex;
export function encodeValueTerms(maxValue: bigint): Hex;
export function encodeAllowedTargetsTerms(targets: Address[]): Hex;
export function encodeAllowedMethodsTerms(selectors: Hex[]): Hex;
export function buildMcpToolScopeCaveat(allowedTools: string[]): Caveat;
export function buildDataScopeCaveat(grants: DataScopeGrant[]): Caveat;
export function buildDelegateBindingCaveat(delegateSmartAccount: Address, delegatePersonAgent: Address): Caveat;

// Hashing
export function hashDelegation(d: Delegation, chainId: number, delegationManager: Address): Hex;
export function hashCaveats(caveats: Caveat[]): Hex;

// Caveat evaluation (fail-closed)
export function evaluateCaveats(
  caveats: Caveat[],
  ctx: CaveatContext,
  enforcerMap: EnforcerAddressMap
): CaveatVerdict[];
```

### Browser (issuance)
```ts
export class DelegationClient {
  constructor(opts: { walletClient: WalletLike; smartAccount: Address; chainId: number; delegationManager: Address });
  issueDelegation(params: {
    delegate: Address;
    caveats: Caveat[];
    salt?: bigint;
  }): Promise<Delegation>;
}
```

### Node (token mint + verify)
```ts
export function mintDelegationToken(
  claims: Omit<DelegationTokenClaims, 'iat' | 'exp'>,
  signMessage: (msg: string) => Promise<Hex>
): Promise<{ token: string; jti: string }>;

export function verifyDelegationToken(
  token: string,
  opts: {
    chainId: number;
    delegationManager: Address;
    rpcUrl: string;
    audience: string;
    enforcerMap: EnforcerAddressMap;
    jtiStore: JtiStore;
    now?: () => number;
  }
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | VerifyError>;

export async function verifyCrossDelegation(
  delegation: Delegation,
  callerPrincipal: Address,
  targetServer: string,
  opts: VerifyOpts
): Promise<{ dataPrincipal: Address; grants: DataScopeGrant[] } | VerifyError>;

export interface JtiStore {
  trackUsage(jti: string, limit: number): Promise<{ usage: number; allowed: boolean }>;
}

// Pluggable persistence
export interface DelegationStore {
  save(d: Delegation, audience: string): Promise<void>;
  get(hash: Hex): Promise<Delegation | null>;
  revoke(hash: Hex): Promise<void>;
  list(principal: Address, kind?: string): Promise<Delegation[]>;
}
```

### On-chain helpers
```ts
export async function revokeDelegation(hash: Hex, ctx: TxContext): Promise<Hex /* txHash */>;
export async function isRevoked(hash: Hex, opts: { delegationManager: Address; rpcUrl: string }): Promise<boolean>;
```

---

## 8. Configuration

Consumer must provide a map of enforcer addresses for their chain:

```ts
interface EnforcerAddressMap {
  delegationManager: Address;
  timestamp: Address;
  value: Address;
  allowedTargets: Address;
  allowedMethods: Address;
  taskBinding?: Address;
  callDataHash?: Address;
  recovery?: Address;
  rateLimit?: Address;
}
```

Synthetic sentinel enforcers (`MCP_TOOL_SCOPE`, `DATA_SCOPE`, `DELEGATE_BINDING`) are derived at runtime via keccak and never need configuration.

---

## 9. Fail-closed evaluation rule

Unknown enforcer addresses → **reject**. No "permissive by default". This invariant comes from smart-agent's caveat evaluator (`packages/sdk/src/policy/caveat-evaluator.ts:332-336`) and must be preserved verbatim.

---

## 10. Test plan (v0)

- Unit: caveat encoding round-trips, hash determinism vs. a recorded golden, evaluator fail-closed under unknown enforcer.
- Integration: full mint→verify loop with a stub `JtiStore`, ERC-1271 signature verification against `AgentAccount` on Anvil, revocation triggers rejection.
- Negative: tampered token (signature swap, claim mutation), expired delegation, exhausted JTI usage, missing required caveat.

---

## 11. Known in-flight items on `003-intent-marketplace-proposal`

These exist in smart-agent but are mid-rollout. The spec inherits them as-is and the package implements them; consumers see a stable surface.

- **DelegateBinding caveat (Sprint 2 S2.3):** new; `ACCEPT_LEGACY_CROSS_DELEGATIONS` compat shim present in smart-agent.
- **Phase B hybrid sessions:** Variant B route exists, web client still mostly Variant A.
- **RateLimitEnforcer off-chain evaluator:** stubbed; on-chain redeem enforces.
- **Sub-delegated redeem path:** route exists, spec coverage thin.

We carry these forward intentionally — the package is a faithful port, not a rewrite.

---

## 12. Smart-agent file index (provenance)

| Concern | File | Lines |
| --- | --- | --- |
| Delegation core | `packages/sdk/src/delegation.ts` | 1–550 |
| Token envelope | `packages/sdk/src/delegation-token.ts` | 67–152 |
| Caveat evaluator | `packages/sdk/src/policy/caveat-evaluator.ts` | 92–342 |
| Web hook | `apps/web/src/hooks/use-a2a-session.ts` | 77–211 |
| A2A token mint | `apps/a2a-agent/src/routes/delegation.ts` | 34–115 |
| A2A session init | `apps/a2a-agent/src/routes/session-init.ts` | 1–49 |
| A2A session package | `apps/a2a-agent/src/routes/session.ts` | 30–410 |
| MCP verifier | `apps/person-mcp/src/auth/verify-delegation.ts` | 81–493 |
| A2A DB schema | `apps/a2a-agent/src/db/schema.ts` | 35–86 |
| Person-MCP cross-delegations | `apps/person-mcp/src/db/schema.ts` | 253–265 |
