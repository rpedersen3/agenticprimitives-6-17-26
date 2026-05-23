// DelegationToken envelope (per spec 202 §4):
//   base64url(canonicalJSON(claims)) + '.' + base64url(sessionKeySig)
//
// Verification (per spec 202 §6):
//   1. recover session key from signature → must match claims.sessionKeyAddress
//   2. check claims.aud matches expected audience + claims.exp not past
//   3. EIP-712 hashDelegation
//   4. on-chain DelegationManager.isRevoked
//   5. on-chain AgentAccount.isValidSignature (ERC-1271)
//   6. evaluateCaveats (fail-closed) — pass toolName via opts for tool-scope
//   7. atomic JTI usage tracking
//   8. return { principal: delegator }

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import type {
  Delegation,
  DelegationTokenClaims,
  VerifyError,
  VerifyOpts,
  DataScopeGrant,
} from './types';
import { hashDelegation } from './hash';
import { evaluateCaveats } from './evaluator';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';

// ─── base64url + canonical JSON helpers ──────────────────────────────────

function base64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeStr(s: string): string {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

function base64urlEncodeBytes(b: Uint8Array): string {
  return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeBytes(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

/** Sorted-key JSON; BigInt → numeric string. Both sides must produce the
 *  exact same bytes for the signature to round-trip.
 *
 *  Exported for cross-runtime golden-test fixtures. Stability of this
 *  function is a SECURITY INVARIANT — any byte-level drift across
 *  runtimes (Node, Bun, browser, Cloudflare Workers) means the same
 *  claims hash to different signatures, breaking token verification
 *  silently. */
export function canonicalJSON(value: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: unknown): string => {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'bigint') return JSON.stringify(v.toString());
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) {
      return '[' + v.map((x) => (x === undefined ? 'null' : stringify(x))).join(',') + ']';
    }
    if (typeof v === 'object') {
      if (seen.has(v as object)) throw new Error('canonicalJSON: circular reference');
      seen.add(v as object);
      const obj = v as Record<string, unknown>;
      // Drop undefined keys (standard JSON behavior).
      const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringify(obj[k])).join(',') + '}';
    }
    throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
  };
  return stringify(value);
}

function eip191Digest(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix, 0);
  combined.set(bytes, prefix.length);
  return keccak_256(combined);
}

function recoverEoaFromEip191Sig(message: string, signature: Hex): Address {
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  if (sig.length !== 130) throw new Error(`signature must be 65 bytes (130 hex chars); got ${sig.length}`);
  const r = BigInt('0x' + sig.slice(0, 64));
  const s = BigInt('0x' + sig.slice(64, 128));
  const v = parseInt(sig.slice(128, 130), 16);
  const recovery = v >= 27 ? v - 27 : v;
  const eipSig = new secp256k1.Signature(r, s).addRecoveryBit(recovery);
  const digest = eip191Digest(message);
  const pub = eipSig.recoverPublicKey(digest).toRawBytes(false);
  const hash = keccak_256(pub.slice(1));
  let hex = '0x';
  for (const b of hash.slice(12)) hex += b.toString(16).padStart(2, '0');
  return hex as Address;
}

function randomJti(): string {
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  let s = 'jti_';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

// ─── Mint ──────────────────────────────────────────────────────────────────

/**
 * Production hard-ceilings on token lifespan + reuse. Callers may set
 * tighter limits via `opts.maxAllowedTtlSeconds` / `opts.maxAllowedUsageLimit`;
 * setting LOOSER values requires explicit `opts.acceptElevatedRisk: true`.
 *
 * Rationale: a leaked long-lived high-usage token is an authority leak
 * for its full window. Today's defaults (1h TTL, 100 uses) are aggressive
 * enough that a missed-rotation incident has bounded blast radius.
 */
const DEFAULT_MAX_TTL_SECONDS = 60 * 60; // 1 hour
const DEFAULT_MAX_USAGE_LIMIT = 100;

export async function mintDelegationToken(
  claims: Omit<DelegationTokenClaims, 'iat' | 'exp' | 'jti'> & { jti?: string; ttlSeconds?: number },
  signMessage: (msg: string) => Promise<Hex>,
  opts?: {
    /** Audit sink (C3 pass 3c). Emits `delegation.mint` per call. */
    auditSink?: AuditSink;
    correlationId?: string;
    /**
     * Production guard — reject mints whose `ttlSeconds` exceeds this.
     * Defaults to `DEFAULT_MAX_TTL_SECONDS` (1h). Set higher only with
     * `acceptElevatedRisk: true`.
     */
    maxAllowedTtlSeconds?: number;
    /**
     * Production guard — reject mints whose `usageLimit` exceeds this.
     * Defaults to `DEFAULT_MAX_USAGE_LIMIT` (100). Set higher only with
     * `acceptElevatedRisk: true`.
     */
    maxAllowedUsageLimit?: number;
    /**
     * Required when caller wants TTL > 1h OR usage > 100. Forces a
     * deliberate "I know this is a long-lived elevated-blast-radius
     * token" decision rather than silent permissive defaults.
     */
    acceptElevatedRisk?: boolean;
  },
): Promise<{ token: string; jti: string }> {
  const jti = claims.jti ?? randomJti();
  const ttl = claims.ttlSeconds ?? 600; // 10 minutes default; tokens are short-lived

  // Production ceiling enforcement.
  const ttlCeiling = opts?.maxAllowedTtlSeconds ?? DEFAULT_MAX_TTL_SECONDS;
  if (ttl > ttlCeiling && !opts?.acceptElevatedRisk) {
    throw new Error(
      `mintDelegationToken: ttlSeconds=${ttl} exceeds ceiling=${ttlCeiling}. ` +
        `Tighten TTL or set { acceptElevatedRisk: true } to acknowledge ` +
        `the elevated blast-radius of a long-lived token.`,
    );
  }
  if (
    typeof claims.usageLimit === 'number' &&
    claims.usageLimit > (opts?.maxAllowedUsageLimit ?? DEFAULT_MAX_USAGE_LIMIT) &&
    !opts?.acceptElevatedRisk
  ) {
    throw new Error(
      `mintDelegationToken: usageLimit=${claims.usageLimit} exceeds ceiling=` +
        `${opts?.maxAllowedUsageLimit ?? DEFAULT_MAX_USAGE_LIMIT}. ` +
        `Tighten usageLimit or set { acceptElevatedRisk: true }.`,
    );
  }
  if (ttl <= 0) {
    throw new Error(`mintDelegationToken: ttlSeconds must be positive; got ${ttl}`);
  }
  if (typeof claims.usageLimit === 'number' && claims.usageLimit <= 0) {
    throw new Error(`mintDelegationToken: usageLimit must be positive when set; got ${claims.usageLimit}`);
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttl;
  const full: DelegationTokenClaims = {
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    delegation: claims.delegation,
    sessionKeyAddress: claims.sessionKeyAddress,
    jti,
    iat,
    exp,
    usageLimit: claims.usageLimit,
  };
  const canonical = canonicalJSON(full);
  const sig = await signMessage(canonical);
  const sigHex = sig.startsWith('0x') ? sig.slice(2) : sig;
  const sigBytes = new Uint8Array(Buffer.from(sigHex, 'hex'));
  const token = `${base64urlEncode(canonical)}.${base64urlEncodeBytes(sigBytes)}`;
  // Audit emit (C3 pass 3c). Fail-soft. JTI is logged because it's the
  // correlation primitive for downstream verify events — not secret.
  if (opts?.auditSink) {
    try {
      await opts.auditSink.write(
        buildEvent({
          action: 'delegation.mint',
          outcome: 'success',
          correlationId: opts.correlationId,
          actor: { type: 'user', id: claims.delegation.delegator },
          subject: { type: 'jti', id: jti },
          audience: claims.aud,
          context: {
            iss: claims.iss,
            sub: claims.sub,
            sessionKeyAddress: claims.sessionKeyAddress,
            ttlSeconds: ttl,
            usageLimit: claims.usageLimit ?? null,
          },
        }),
      );
    } catch {
      /* fail-soft */
    }
  }
  return { token, jti };
}

// ─── Verify ────────────────────────────────────────────────────────────────

const DELEGATION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'isRevoked',
    stateMutability: 'view',
    inputs: [{ name: 'hash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const ACCOUNT_ABI_ERC1271 = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
] as const;

const ACCEPTED_SESSION_DELEGATION_ABI = [
  {
    type: 'function',
    name: 'isAcceptedSessionDelegation',
    stateMutability: 'view',
    inputs: [{ name: 'sessionDelegationHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const ERC1271_MAGIC = '0x1626ba7e';

export interface VerifyOptsExt extends VerifyOpts {
  /** Tool name for mcp-tool-scope caveat evaluation. */
  toolName?: string;
  /**
   * Whether to require the delegator's smart account to be on-chain.
   * Default: `true` (fail-closed). When the account isn't deployed,
   * ERC-1271 can't be verified and the security model is broken.
   *
   * Demo flows that intentionally use counterfactual addresses without
   * deploying may pass `false` to tolerate the undeployed state. Production
   * code MUST keep the default — there's no scenario where an undeployed
   * delegator should be honored.
   */
  requireDeployed?: boolean;
  /**
   * Revocation read failure behavior. Audit finding H3.
   *
   * - `'closed'` (default in production via NODE_ENV check below):
   *   if `isRevoked()` RPC read throws, the whole verification fails
   *   with `revocation check unavailable`. Safe under RPC outage:
   *   a revoked delegation cannot be silently accepted.
   * - `'open'`: tolerate the RPC failure and continue. This was the
   *   pre-2026-05-20 behavior and is appropriate for explicit
   *   demo/dev paths where RPC flakiness is expected.
   *
   * When omitted, defaults to `'closed'` if `process.env.NODE_ENV === 'production'`,
   * `'open'` otherwise.
   */
  revocationFailMode?: 'closed' | 'open';
  /**
   * Audit sink (audit C3 pass 3b). When provided, every verify outcome
   * emits a `delegation.verify.{accept,reject}` event. The principal
   * goes in `actor`, the delegation hash in `subject`. The token JTI
   * (claims.jti) is hashed before logging to avoid surfacing the
   * one-shot identifier in the forensics trail beyond the minimum
   * needed for correlation.
   *
   * Fail-soft: emit failures never break the verify flow.
   */
  auditSink?: AuditSink;
  /** Correlation ID threaded into emitted events. */
  correlationId?: string;

  // ─── Spec 207 threshold-policy gates ────────────────────────────────
  //
  // Set by the caller (typically mcp-runtime.withDelegation) based on
  // the tool's threshold-policy decision from
  // tool-policy.evaluateThresholdPolicy(...). delegation doesn't import
  // tool-policy directly — these opts are the cross-layer contract.

  /**
   * When set, the delegation MUST carry a caveat with an `enforcer`
   * matching this address. The redeem-time signature check happens
   * on-chain inside the `QuorumEnforcer.beforeHook` (apps/contracts/
   * src/enforcers/QuorumEnforcer.sol); this opt's role is to fail
   * closed at the OFF-CHAIN layer when a delegation was issued
   * without the required quorum caveat at all. Without this opt set,
   * delegation does NOT require quorum — backwards-compatible for
   * T1/T2 tier flows that don't need it.
   *
   * Use case (mcp-runtime sets it for T3+ tools):
   *   evaluateThresholdPolicy(classification).requiresQuorum
   *     ? { enforcer: deployments.quorumEnforcer }
   *     : undefined
   */
  requireQuorumCaveat?: { enforcer: Address };

  /**
   * When `true`, verify that the delegator's smart account has
   * pre-blessed this delegation hash on-chain via
   * `acceptSessionDelegation(hash)`. Spec 207 § 6 high-risk gate —
   * critical-tier tool calls require an explicit on-chain
   * authorization so a quorum at issuance isn't sufficient on its
   * own; the user must additionally commit the specific delegation
   * hash with a chain-visible transaction.
   *
   * Audit emit captures this as `context.acceptedOnChain: true` on
   * the accept row so forensics can distinguish high-value flows.
   */
  requireAcceptedOnChain?: boolean;
}

interface DecodedToken {
  claims: DelegationTokenClaims;
  canonical: string;
  signature: Hex;
}

function decodeToken(token: string): DecodedToken | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let canonical: string;
  let claims: DelegationTokenClaims;
  try {
    canonical = base64urlDecodeStr(parts[0]!);
    const parsed = JSON.parse(canonical) as DelegationTokenClaims & {
      delegation: Delegation & { salt: string | bigint };
    };
    if (typeof parsed.delegation.salt === 'string') {
      parsed.delegation = { ...parsed.delegation, salt: BigInt(parsed.delegation.salt) };
    }
    claims = parsed;
  } catch {
    return null;
  }
  const sigBytes = base64urlDecodeBytes(parts[1]!);
  let sigHex = '0x';
  for (const b of sigBytes) sigHex += b.toString(16).padStart(2, '0');
  return { claims, canonical, signature: sigHex as Hex };
}

/**
 * Full verification pipeline. Caller passes `toolName` in opts for tool-scope
 * caveat evaluation; without it the mcp-tool-scope caveat denies.
 */
export async function verifyDelegationToken(
  token: string,
  opts: VerifyOptsExt,
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | VerifyError> {
  // Audit emit helper (audit C3 pass 3b). Fail-soft: an emit failure
  // never breaks the verify flow.
  const emit = async (
    outcome: 'success' | 'denied',
    reason: string | undefined,
    principal: Address | undefined,
    delegationDigest: Hex | undefined,
  ) => {
    if (!opts.auditSink) return;
    try {
      await opts.auditSink.write(
        buildEvent({
          action:
            outcome === 'success'
              ? 'delegation.verify.accept'
              : 'delegation.verify.reject',
          outcome,
          correlationId: opts.correlationId,
          actor: principal ? { type: 'user', id: principal } : { type: 'unknown' },
          subject: delegationDigest
            ? { type: 'delegation', id: delegationDigest }
            : undefined,
          audience: opts.audience,
          chainId: opts.chainId,
          digest: delegationDigest,
          reason,
          context: opts.toolName ? { tool: opts.toolName } : undefined,
        }),
      );
    } catch {
      /* fail-soft */
    }
  };
  const rejectWith = async (
    reason: string,
    principal?: Address,
    delegationDigest?: Hex,
  ): Promise<VerifyError> => {
    await emit('denied', reason, principal, delegationDigest);
    return { error: reason };
  };

  const decoded = decodeToken(token);
  if (!decoded) return rejectWith('malformed token');
  const { claims, canonical, signature } = decoded;

  if (claims.aud !== opts.audience) return rejectWith('audience mismatch');
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) return rejectWith('token expired');

  // 1. recover session key
  let recovered: Address;
  try {
    recovered = recoverEoaFromEip191Sig(canonical, signature);
  } catch (e) {
    return rejectWith(`signature recovery failed: ${e instanceof Error ? e.message : e}`);
  }
  if (recovered.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return rejectWith('session-key signature mismatch');
  }

  // 2. EIP-712 hash
  const eip712Hash = hashDelegation(claims.delegation, opts.chainId, opts.delegationManager);

  // 3. on-chain checks
  const requireDeployed = opts.requireDeployed ?? true;
  const revocationFailMode =
    opts.revocationFailMode ??
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
      ? 'closed'
      : 'open');
  const publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
  try {
    const revoked = (await publicClient.readContract({
      address: opts.delegationManager,
      abi: DELEGATION_MANAGER_ABI,
      functionName: 'isRevoked',
      args: [eip712Hash],
    })) as boolean;
    if (revoked) {
      return rejectWith('delegation revoked', claims.delegation.delegator, eip712Hash);
    }
  } catch (e) {
    if (revocationFailMode === 'closed') {
      return rejectWith(
        'revocation check unavailable; refusing to verify (set revocationFailMode=open only for explicit dev/demo paths)',
        claims.delegation.delegator,
        eip712Hash,
      );
    }
    void e;
  }

  try {
    const code = await publicClient.getCode({ address: claims.delegation.delegator });
    const isDeployed = !!(code && code !== '0x' && code.length > 2);
    if (!isDeployed) {
      if (requireDeployed) {
        return rejectWith(
          `delegator smart account ${claims.delegation.delegator} is not deployed — cannot verify ERC-1271. Set verifyDelegationToken opt requireDeployed=false only for explicit counterfactual-demo use cases.`,
          claims.delegation.delegator,
          eip712Hash,
        );
      }
      // Tolerated: caller opted into the undeployed path explicitly.
    } else {
      const magic = (await publicClient.readContract({
        address: claims.delegation.delegator,
        abi: ACCOUNT_ABI_ERC1271,
        functionName: 'isValidSignature',
        args: [eip712Hash, claims.delegation.signature],
      })) as Hex;
      if (magic.toLowerCase() !== ERC1271_MAGIC) {
        return rejectWith('erc1271 validation failed', claims.delegation.delegator, eip712Hash);
      }
    }
  } catch (e) {
    return rejectWith(
      `erc1271 call reverted: ${e instanceof Error ? e.message : e}`,
      claims.delegation.delegator,
      eip712Hash,
    );
  }

  // 4. caveat evaluation
  const verdicts = evaluateCaveats(
    claims.delegation.caveats,
    { timestamp: now, mcpTool: opts.toolName },
    opts.enforcerMap,
  );
  for (const v of verdicts) {
    if (!v.allowed) {
      return rejectWith(`caveat denied (${v.reason})`, claims.delegation.delegator, eip712Hash);
    }
  }

  // 4.5. Spec 207 threshold-policy gates.
  //   - requireQuorumCaveat: the delegation MUST carry a caveat whose
  //     enforcer matches the caller's expected QuorumEnforcer address.
  //     Caller decides which delegations need this based on the tool's
  //     tool-policy decision (`requiresQuorum`). Without this opt set
  //     we don't require quorum — backwards-compatible.
  if (opts.requireQuorumCaveat) {
    const target = opts.requireQuorumCaveat.enforcer.toLowerCase();
    const hasQuorum = claims.delegation.caveats.some(
      (c) => c.enforcer.toLowerCase() === target,
    );
    if (!hasQuorum) {
      return rejectWith(
        'tier requires quorum caveat but delegation lacks one',
        claims.delegation.delegator,
        eip712Hash,
      );
    }
  }

  //   - requireAcceptedOnChain: account.isAcceptedSessionDelegation(hash)
  //     must return true. Spec § 6 high-risk gate. Single extra chain
  //     read; only fires when the tool-policy decision flips this on
  //     (typically critical-tier tools).
  let acceptedOnChain = false;
  if (opts.requireAcceptedOnChain) {
    try {
      acceptedOnChain = (await publicClient.readContract({
        address: claims.delegation.delegator,
        abi: ACCEPTED_SESSION_DELEGATION_ABI,
        functionName: 'isAcceptedSessionDelegation',
        args: [eip712Hash],
      })) as boolean;
    } catch (e) {
      return rejectWith(
        `acceptSessionDelegation check reverted: ${e instanceof Error ? e.message : e}`,
        claims.delegation.delegator,
        eip712Hash,
      );
    }
    if (!acceptedOnChain) {
      return rejectWith(
        'tier requires on-chain acceptSessionDelegation blessing; not present',
        claims.delegation.delegator,
        eip712Hash,
      );
    }
  }

  // 5. JTI replay
  const limit = claims.usageLimit ?? 10;
  const usage = await opts.jtiStore.trackUsage(claims.jti, limit);
  if (!usage.allowed) {
    return rejectWith('token usage limit exceeded', claims.delegation.delegator, eip712Hash);
  }

  // Accept emit — extended context to capture the threshold-policy
  // outcome (`acceptedOnChain`) for forensics + dashboards. Reuses the
  // same `emit` shape as the reject path but with extra context fields.
  if (opts.auditSink) {
    try {
      const context: Record<string, string | number | boolean | null> = {};
      if (opts.toolName) context.tool = opts.toolName;
      if (opts.requireAcceptedOnChain !== undefined) {
        context.acceptedOnChain = acceptedOnChain;
      }
      await opts.auditSink.write(
        buildEvent({
          action: 'delegation.verify.accept',
          outcome: 'success',
          correlationId: opts.correlationId,
          actor: { type: 'user', id: claims.delegation.delegator },
          subject: { type: 'delegation', id: eip712Hash },
          audience: opts.audience,
          chainId: opts.chainId,
          digest: eip712Hash,
          context: Object.keys(context).length > 0 ? context : undefined,
        }),
      );
    } catch {
      /* fail-soft */
    }
  }

  return { principal: claims.delegation.delegator };
}

export async function verifyCrossDelegation(
  _delegation: Delegation,
  _callerPrincipal: Address,
  _targetServer: string,
  _opts: VerifyOpts,
): Promise<{ dataPrincipal: Address; grants: DataScopeGrant[] } | VerifyError> {
  return {
    error:
      'verifyCrossDelegation: cross-delegation (DELEGATE_BINDING + DATA_SCOPE bridging) lands in v0.1; demo step 3 uses direct delegation only.',
  };
}
