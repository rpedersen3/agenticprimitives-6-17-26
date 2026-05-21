# Spec 202 — `@agenticprimitives/delegation`

**Capability:** EIP-712 smart-account delegations + session lifecycle. Issue, mint, validate, redeem, revoke; manage the session keys that bear delegated authority.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/packages/sdk/src/{delegation,delegation-token}.ts`, `smart-agent/apps/a2a-agent/src/routes/{session-init,session,delegation,onchain-redeem}.ts`, `smart-agent/apps/person-mcp/src/auth/verify-delegation.ts`.

> **Net change from the original 002 spec:** absorbs session lifecycle from former `kms` spec, per the unanimous KMS-landscape signal that session lifecycle lives with the authority layer, not with key material. KMS becomes a peer dep (`key-custody.encryptSessionPackage`/`decryptSessionPackage`); this package owns `SessionManager`.

---

## 1. Goal

Standalone library implementing the full delegation lifecycle as it exists in smart-agent today, without dragging any of smart-agent's app shells.

- **Browser:** build a delegation, have the user sign it (passkey or wallet → ERC-1271), and submit to their agent.
- **Node agent:** receive a signed delegation, manage the session that binds it, store it encrypted (via `key-custody`), mint scoped tokens.
- **MCP server:** verify a token end-to-end (signature → on-chain revocation → ERC-1271 → caveats → JTI replay).

---

## 2. Standard

EIP-712 typed-data delegations, **ERC-7710-aligned** but NOT the MetaMask Delegation Framework verbatim. See [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) for the concrete parity audit (which DTK shapes match byte-for-byte, which diverge intentionally, which are gaps).

```solidity
struct Delegation {
  address delegator;
  address delegate;
  bytes32 authority;     // ROOT_AUTHORITY (= 0) for top-level
  Caveat[] caveats;
  uint256 salt;
  bytes signature;       // ERC-1271 from delegator (smart account)
}

struct Caveat { address enforcer; bytes terms; bytes args; }
```

ERC-1271 signing means passkey-backed accounts can produce delegation signatures without the user holding an EOA.

Smart-agent ref: `packages/sdk/src/delegation.ts:15-60`.

---

## 3. Caveat vocabulary

### On-chain enforcers
| Enforcer | Terms | Enforced |
| --- | --- | --- |
| `TimestampEnforcer` | `abi.encode(uint validAfter, uint validUntil)` | off-chain + on-chain |
| `ValueEnforcer` | `abi.encode(uint maxValue)` | on-chain redeem |
| `AllowedTargetsEnforcer` | `abi.encode(address[])` | off-chain + on-chain |
| `AllowedMethodsEnforcer` | `abi.encode(bytes4[])` | off-chain + on-chain |
| `TaskBindingEnforcer` | `abi.encode(bytes32 taskId)` | on-chain audit |
| `CallDataHashEnforcer` | `abi.encode(bytes32 expectedHash)` | on-chain sub-delegated |
| `RecoveryEnforcer` | `abi.encode(address[] guardians, uint threshold, uint delay)` | on-chain |
| `RateLimitEnforcer` | `abi.encodePacked(bytes32 scopeKey, uint32 maxCalls, uint32 windowSec)` (40 bytes) | on-chain |

### Off-chain sentinels
| Sentinel | Terms | Purpose |
| --- | --- | --- |
| `MCP_TOOL_SCOPE_ENFORCER` (`keccak256('urn:smart-agent:mcp-tool-scope')[0:20]`) | `abi.encode(string[] allowedTools)` | restrict MCP tools |
| `DATA_SCOPE_ENFORCER` (`keccak256('urn:smart-agent:data-scope')[0:20]`) | `abi.encode(DataScopeGrant[])` | field-level resource grants |
| `DELEGATE_BINDING_ENFORCER` (`keccak256('urn:smart-agent:delegate-binding')[0:20]`) | `abi.encode(address delegateSmartAccount, address delegatePersonAgent)` | dual-address binding for cross-delegations |

```ts
interface DataScopeGrant {
  server: string;       // 'urn:mcp:server:org'
  resources: string[];  // ['profile', 'wallet']
  fields: string[];     // ['email', 'phone']
}
```

Smart-agent ref: `packages/sdk/src/delegation.ts:105-500`, `packages/sdk/src/policy/caveat-evaluator.ts:92-342`.

---

## 4. Token envelope (a2a-agent → MCP)

```ts
interface DelegationTokenClaims {
  iss: 'agenticprimitives-a2a' | string;
  aud: string;                                // e.g. 'urn:mcp:server:person'
  sub: Address;                                // smart account (delegator)
  delegation: Delegation;
  sessionKeyAddress: Address;
  jti: string;                                 // unique token id
  iat: number;
  exp: number;
  usageLimit?: number;                         // default 10
}
```

Format: `base64url(canonicalJSON(claims)) + '.' + base64url(sessionKeySig(canonicalJSON))`. Verification recovers session key address from signature; must match `claims.sessionKeyAddress`.

Smart-agent ref: `packages/sdk/src/delegation-token.ts:67-152`, `apps/a2a-agent/src/routes/delegation.ts:34-115`.

---

## 5. The session-delegation lifecycle (absorbed from former kms spec)

```
1. User logs in (identity-auth).
2. A2A: POST /session/init
   ├─ generates session keypair (sk, pk_sessionKey)
   └─ stores encrypted {sk} with status=pending (via key-custody)
3. Web: builds Delegation { delegator=user smartAccount,
                           delegate=pk_sessionKey,
                           caveats=[...time, mcp-scope, data-scope] }
   user signs (passkey or wallet → ERC-1271 against smart account)
4. A2A: POST /session/package
   ├─ verifies signature via agent-account.isValidSignature
   ├─ re-encrypts {sk, delegation} as full package (key-custody)
   └─ marks session active
5. Web: tool call → A2A
6. A2A: decrypt session (key-custody), mintDelegationToken
7. A2A → MCP: HTTP w/ HMAC envelope (key-custody/mac), body carries token
8. MCP: verifyDelegationToken — see §6
9. Tool handler runs with verified principal = delegation.delegator
```

### Session row shape
```ts
interface SessionRow {
  id: string;                           // 'sa_<uuid>'
  accountAddress: Address;
  sessionKeyAddress: Address;
  status: 'pending' | 'active' | 'revoked' | 'expired';
  encryptedPackage: Uint8Array;
  iv: Uint8Array;
  encryptedDataKey: Uint8Array;
  keyVersion: string;
  expiresAt: string;                    // ISO; clamped per risk-tier
  variant?: 'A' | 'B';                  // see §7
  createdAt: string;
  revokedAt?: string;
}

interface SessionPackage {
  sessionPrivateKey: Hex;
  delegation: Delegation;
}
```

### AAD (key-custody binding)
```
{
  session_id_h: sha256(sessionId)[0..16],
  account_address: <lowercase>,
  chain_id: '<number>',
  expires_at: <ISO>,
  key_version: <provider.keyVersion>
}
```

Smart-agent ref: `apps/a2a-agent/src/routes/session.ts:30-410`, `apps/a2a-agent/src/db/schema.ts:35-86`, `apps/a2a-agent/src/auth/encryption.ts:195-383`.

---

## 6. MCP-side verification (consumed by `@agenticprimitives/mcp-runtime`)

```
verifyDelegationToken(token, opts):
  1. recover session key from token signature → must match claims.sessionKeyAddress
  2. hashDelegation(delegation) under chainId + DelegationManager addr
  3. DelegationManager.isRevoked(hash) — on-chain
  4. AgentAccount(delegator).isValidSignature(hash, sig) — ERC-1271
  5. evaluateCaveats(...) — fail-closed
  6. atomic JTI usage tracking against usageLimit
  7. return { principal: delegation.delegator, grants?: DataScopeGrant[] }
```

Smart-agent ref: `apps/person-mcp/src/auth/verify-delegation.ts:81-493`.

---

## 7. Session variants

- **Variant A (legacy/off-chain):** delegation's `delegate` = the smart account itself; session key signs tokens.
- **Variant B (Phase B, on-chain):** delegation's `delegate` = the session key EOA directly; can also sign on-chain via `redeem-via-account`. Pre-Phase-B sessions have `variant=NULL` and are treated as A.

---

## 8. Cross-delegation

User A delegates to User B's agent. On-chain delegation is `delegator=A, delegate=B`. B's agent stores received delegations in a holder table; presents both session token AND cross-delegation when calling MCP. `DELEGATE_BINDING_ENFORCER` caveat locks delegate to `(smartAccount, personAgent)` pair preventing impersonation.

Smart-agent ref: `apps/person-mcp/src/tools/received-delegations.ts:30-194`, `apps/person-mcp/src/auth/verify-delegation.ts:261-493`.

---

## 9. Public API

```ts
// Caveat builders + hashing (universal)
export const ROOT_AUTHORITY: Hex;
export function buildCaveat(enforcer: Address, terms: Hex, args?: Hex): Caveat;
export function encodeTimestampTerms(validAfter: number, validUntil: number): Hex;
export function encodeValueTerms(maxValue: bigint): Hex;
export function encodeAllowedTargetsTerms(targets: Address[]): Hex;
export function encodeAllowedMethodsTerms(selectors: Hex[]): Hex;
export function buildMcpToolScopeCaveat(allowedTools: string[]): Caveat;
export function buildDataScopeCaveat(grants: DataScopeGrant[]): Caveat;
export function buildDelegateBindingCaveat(delegateSmartAccount: Address, delegatePersonAgent: Address): Caveat;
export function hashDelegation(d: Delegation, chainId: number, dm: Address): Hex;
export function hashCaveats(caveats: Caveat[]): Hex;
export function evaluateCaveats(caveats: Caveat[], ctx: CaveatContext, em: EnforcerAddressMap): CaveatVerdict[];

// Issuance (browser)
export class DelegationClient {
  constructor(opts: { signer: Signer; smartAccount: Address; chainId: number; delegationManager: Address });
  issueDelegation(params: { delegate: Address; caveats: Caveat[]; salt?: bigint }): Promise<Delegation>;
}

// Session lifecycle (NEW — absorbed from former kms spec)
export class SessionManager {
  constructor(opts: {
    keyCustody: A2AKeyProvider;                // from @agenticprimitives/key-custody
    store: SessionStore;
    accountClient: AgentAccountClient;         // from @agenticprimitives/agent-account
  });
  init(accountAddress: Address, chainId: number): Promise<{ sessionId: string; sessionKeyAddress: Address }>;
  package(sessionId: string, delegation: Delegation): Promise<void>;
  resolve(sessionId: string): Promise<{ signer: Signer; delegation: Delegation; meta: SessionMeta }>;
  revoke(sessionId: string): Promise<void>;
}
export interface SessionStore {
  save(row: SessionRow): Promise<void>;
  get(id: string): Promise<SessionRow | null>;
  list(accountAddress: Address): Promise<SessionRow[]>;
  revoke(id: string): Promise<void>;
}

// Token mint + verify (node)
export function mintDelegationToken(
  claims: Omit<DelegationTokenClaims, 'iat' | 'exp'>,
  signMessage: (msg: string) => Promise<Hex>,
): Promise<{ token: string; jti: string }>;

export function verifyDelegationToken(token: string, opts: VerifyOpts): Promise<{ principal: Address; grants?: DataScopeGrant[] } | VerifyError>;

export function verifyCrossDelegation(d: Delegation, callerPrincipal: Address, targetServer: string, opts: VerifyOpts): Promise<{ dataPrincipal: Address; grants: DataScopeGrant[] } | VerifyError>;

// On-chain
export function isRevoked(hash: Hex, opts: { delegationManager: Address; rpcUrl: string }): Promise<boolean>;
export function revokeDelegation(hash: Hex, ctx: TxContext): Promise<Hex>;

// Types
export type { Delegation, Caveat, DataScopeGrant, DelegationTokenClaims, EnforcerAddressMap, JtiStore, CaveatContext, CaveatVerdict, VerifyOpts, VerifyError, SessionRow, SessionPackage, SessionMeta };
```

---

## 10. Configuration

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

Synthetic sentinels are derived at runtime via keccak; no config.

---

## 11. Fail-closed evaluation rule

Unknown enforcer addresses → **reject**. No "permissive by default". From smart-agent's `caveat-evaluator.ts:332-336`; preserved verbatim.

---

## 12. Test plan (v0)

- Unit: caveat encoding round-trips, hash determinism, evaluator fail-closed.
- Integration: full session lifecycle (init → package → resolve → mint → verify) against an in-memory `SessionStore`.
- ERC-1271: signature verification against `AgentAccount` on Anvil.
- Negative: tampered token, expired delegation, exhausted JTI, missing required caveat.

---

## 13. Known in-flight items (003-intent-marketplace-proposal)

- **DelegateBinding caveat (Sprint 2 S2.3):** new; `ACCEPT_LEGACY_CROSS_DELEGATIONS` compat shim present.
- **Phase B hybrid sessions:** Variant B route exists, web client mostly Variant A.
- **RateLimitEnforcer off-chain evaluator:** stubbed; on-chain redeem enforces.

---

## 14. Smart-agent file index

| Concern | File | Lines |
| --- | --- | --- |
| Delegation core | `packages/sdk/src/delegation.ts` | 1–550 |
| Token envelope | `packages/sdk/src/delegation-token.ts` | 67–152 |
| Caveat evaluator | `packages/sdk/src/policy/caveat-evaluator.ts` | 92–342 |
| A2A token mint | `apps/a2a-agent/src/routes/delegation.ts` | 34–115 |
| A2A session init | `apps/a2a-agent/src/routes/session-init.ts` | 1–49 |
| A2A session package | `apps/a2a-agent/src/routes/session.ts` | 30–410 |
| Session encryption | `apps/a2a-agent/src/auth/encryption.ts` | 195–383 |
| MCP verifier | `apps/person-mcp/src/auth/verify-delegation.ts` | 81–493 |
| A2A DB schema | `apps/a2a-agent/src/db/schema.ts` | 35–86 |
| Cross-del schema | `apps/person-mcp/src/db/schema.ts` | 253–265 |
