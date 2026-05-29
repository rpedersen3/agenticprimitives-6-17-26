// deriveSubjectSigner — a per-(iss,sub) custodian signer (spec 235).
//
// Given a Google subject `(iss, sub)`, derive a secp256k1 signing key bound to
// that subject from the server master, and return a `KmsAccountBackend` whose
// address is the per-subject custodian `C_sub`. demo-a2a uses `C_sub` as the
// SOLE custodian of the member's Smart Agent, so signing in with Google alone
// = full custody (the server signs on the member's behalf — see spec 235 §3
// for the trust model: master compromise = all Google members; per-subject
// keys bound only the single-leak blast radius).
//
// Divergence from smart-agent (spec 235 §2): smart-agent uses ONE shared
// bootstrap signer + a per-subject CREATE2 *salt*. We derive a per-subject
// signing KEY so the custodian address itself differs per member — a single
// leaked derived key cannot custody another member's agent.
//
// Derivation (local-aes, the demo backend):
//   canonical = "kms-custodian:v1:<enc(iss)>:<enc(sub)>:<rotation>"
//   okm       = HKDF-SHA256(ikm = master, salt = "kms-custodian:v1", info = canonical, 32)
//   priv      = (be(okm) mod (n-1)) + 1     // uniform-ish in [1, n-1], never 0, always < n
// `enc()` is encodeURIComponent so a `:` inside iss/sub can't forge the field
// separators (key-isolation invariant — spec 235 §9.3).
//
// KMS backends (gcp-kms / aws-kms): NOT YET BUILT. The prod providers expose
// no `generateMac`, so there is no KMS-side per-subject seed today. We FAIL
// CLOSED (no silent fallback to local-aes — ADR-0013) and point at the
// follow-up (spec 235 §10: a per-subject KMS HMAC or asymmetric key).

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes, bytesToHex, type Hex } from 'viem';
import type { BuildOpts, KmsAccountBackend, KmsBackend } from './types';
import { LocalSecp256k1Signer } from './providers/local';

const DERIVE_INFO_PREFIX = 'kms-custodian:v1';
const SECP256K1_N = secp256k1.CURVE.n;

/** The Google (OIDC) subject a custodian key is bound to. */
export interface SubjectId {
  /** OIDC issuer, e.g. `https://accounts.google.com`. */
  iss: string;
  /** OIDC subject (stable per Google account). */
  sub: string;
  /** Bump to rotate a subject's custodian key (defaults to 0). */
  rotation?: number;
}

export interface DeriveSubjectOpts extends BuildOpts {
  subject: SubjectId;
}

/**
 * The exact message the per-subject key is derived over. Each component is
 * percent-encoded so the `:` separators are unforgeable (so `(iss,sub:x)` and
 * `(iss:sub,x)` can never derive the same key).
 */
export function subjectCanonicalMessage(subject: SubjectId): string {
  const iss = subject.iss?.trim();
  const sub = subject.sub?.trim();
  if (!iss) throw new Error('deriveSubjectSigner: subject.iss is required');
  if (!sub) throw new Error('deriveSubjectSigner: subject.sub is required');
  const rotation = subject.rotation ?? 0;
  if (!Number.isInteger(rotation) || rotation < 0) {
    throw new Error('deriveSubjectSigner: subject.rotation must be a non-negative integer');
  }
  return `${DERIVE_INFO_PREFIX}:${encodeURIComponent(iss)}:${encodeURIComponent(sub)}:${rotation}`;
}

function beBytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Pure derivation: expand a 32-byte master into the per-subject secp256k1
 * private key. Deterministic (same master + subject → same key); distinct
 * subject/rotation → distinct key. Exported for unit tests.
 */
export function deriveSubjectPrivateKeyHex(master: Uint8Array, subject: SubjectId): Hex {
  if (master.length < 32) {
    throw new Error(`deriveSubjectSigner: master must be ≥ 32 bytes; got ${master.length}`);
  }
  const canonical = subjectCanonicalMessage(subject);
  const okm = hkdf(
    sha256,
    master,
    new TextEncoder().encode(DERIVE_INFO_PREFIX),
    new TextEncoder().encode(canonical),
    32,
  );
  // Map uniformly into [1, n-1]: (x mod (n-1)) + 1. Never 0, always < n.
  const priv = (beBytesToBigInt(okm) % (SECP256K1_N - 1n)) + 1n;
  return bytesToHex(bigIntTo32Bytes(priv));
}

function loadDerivationMaster(opts: DeriveSubjectOpts): Uint8Array {
  // The master the subject keys are derived from. In the demo this is the
  // server's master signing key (the server IS the trusted custodian for all
  // Google members — spec 235 §3). `config.derivationSecretHex` lets a deploy
  // point at a SEPARATE secret (master-key-separation invariant) without code
  // changes; default is A2A_MASTER_PRIVATE_KEY.
  const hex = opts.config?.derivationSecretHex ?? process.env.A2A_MASTER_PRIVATE_KEY;
  if (!hex) {
    throw new Error(
      'deriveSubjectSigner (local-aes): A2A_MASTER_PRIVATE_KEY (or config.derivationSecretHex) ' +
        'is required to derive per-subject custodian keys.',
    );
  }
  const cleaned = hex.startsWith('0x') ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`);
  const bytes = hexToBytes(cleaned);
  if (bytes.length < 32) {
    throw new Error(`deriveSubjectSigner: derivation master must be ≥ 32 bytes; got ${bytes.length}`);
  }
  return bytes;
}

function backendOf(opts: DeriveSubjectOpts): KmsBackend {
  if (opts.backend) return opts.backend;
  try {
    const env = process.env?.A2A_KMS_BACKEND as KmsBackend | undefined;
    if (env) return env;
  } catch {
    /* Workers may throw on process access */
  }
  // No silent local default here — deriving custody keys is security-sensitive.
  // The caller (demo-a2a) sets A2A_KMS_BACKEND explicitly.
  return 'local-aes';
}

/**
 * Build the per-subject custodian signer. The returned backend's
 * `getSignerAddress()` is `C_sub`; `signA2AAction` signs 32-byte userOp /
 * EIP-712 digests with the derived key.
 *
 * local-aes: HKDF-derive the key, wrap it in `LocalSecp256k1Signer` (which
 *   enforces the production guard — refuses NODE_ENV=production unless
 *   `A2A_ALLOW_LOCAL_MASTER_KEY=true`).
 * gcp-kms / aws-kms: not yet built — fail closed (spec 235 §10).
 */
export function deriveSubjectSigner(opts: DeriveSubjectOpts): KmsAccountBackend {
  const backend = backendOf(opts);
  if (backend === 'local-aes') {
    const master = loadDerivationMaster(opts);
    const privateKeyHex = deriveSubjectPrivateKeyHex(master, opts.subject);
    return new LocalSecp256k1Signer({ privateKeyHex, auditSink: opts.auditSink });
  }
  throw new Error(
    `deriveSubjectSigner: per-subject derivation is not yet implemented for backend "${backend}". ` +
      `The KMS providers expose no per-subject MAC/key today. Use local-aes for the demo, or build ` +
      `the production path per spec 235 §10 (a per-subject KMS HMAC or asymmetric key). ` +
      `There is no silent fallback to local-aes (ADR-0013).`,
  );
}
