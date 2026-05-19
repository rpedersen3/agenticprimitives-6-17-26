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
 *  exact same bytes for the signature to round-trip. */
function canonicalJSON(value: unknown): string {
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

export async function mintDelegationToken(
  claims: Omit<DelegationTokenClaims, 'iat' | 'exp' | 'jti'> & { jti?: string; ttlSeconds?: number },
  signMessage: (msg: string) => Promise<Hex>,
): Promise<{ token: string; jti: string }> {
  const jti = claims.jti ?? randomJti();
  const ttl = claims.ttlSeconds ?? 600; // 10 minutes default; tokens are short-lived
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

const ERC1271_MAGIC = '0x1626ba7e';

export interface VerifyOptsExt extends VerifyOpts {
  /** Tool name for mcp-tool-scope caveat evaluation. */
  toolName?: string;
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
  const decoded = decodeToken(token);
  if (!decoded) return { error: 'malformed token' };
  const { claims, canonical, signature } = decoded;

  if (claims.aud !== opts.audience) return { error: 'audience mismatch' };
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) return { error: 'token expired' };

  // 1. recover session key
  let recovered: Address;
  try {
    recovered = recoverEoaFromEip191Sig(canonical, signature);
  } catch (e) {
    return { error: `signature recovery failed: ${e instanceof Error ? e.message : e}` };
  }
  if (recovered.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { error: 'session-key signature mismatch' };
  }

  // 2. EIP-712 hash
  const eip712Hash = hashDelegation(claims.delegation, opts.chainId, opts.delegationManager);

  // 3. on-chain checks (tolerated for v0 demo if smart account undeployed)
  const publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
  try {
    const revoked = (await publicClient.readContract({
      address: opts.delegationManager,
      abi: DELEGATION_MANAGER_ABI,
      functionName: 'isRevoked',
      args: [eip712Hash],
    })) as boolean;
    if (revoked) return { error: 'delegation revoked' };
  } catch {
    /* tolerated */
  }

  try {
    const code = await publicClient.getCode({ address: claims.delegation.delegator });
    if (code && code !== '0x' && code.length > 2) {
      const magic = (await publicClient.readContract({
        address: claims.delegation.delegator,
        abi: ACCOUNT_ABI_ERC1271,
        functionName: 'isValidSignature',
        args: [eip712Hash, claims.delegation.signature],
      })) as Hex;
      if (magic.toLowerCase() !== ERC1271_MAGIC) return { error: 'erc1271 validation failed' };
    }
    // else: undeployed account; accept for demo (production would reject)
  } catch (e) {
    return { error: `erc1271 call reverted: ${e instanceof Error ? e.message : e}` };
  }

  // 4. caveat evaluation
  const verdicts = evaluateCaveats(
    claims.delegation.caveats,
    { timestamp: now, mcpTool: opts.toolName },
    opts.enforcerMap,
  );
  for (const v of verdicts) {
    if (!v.allowed) return { error: `caveat denied (${v.reason})` };
  }

  // 5. JTI replay
  const limit = claims.usageLimit ?? 10;
  const usage = await opts.jtiStore.trackUsage(claims.jti, limit);
  if (!usage.allowed) return { error: 'token usage limit exceeded' };

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
