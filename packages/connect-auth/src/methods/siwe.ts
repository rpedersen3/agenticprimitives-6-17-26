// Sign-In with Ethereum (EIP-4361) message build + verify.
//
// Build is a string template. Verify parses the message, computes EIP-191
// digest, recovers signer address, and asserts it matches the address in
// the message.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { Address, Hex } from '@agenticprimitives/types';

export interface SiweMessageInput {
  domain: string;             // RFC 4501 dnsauthority, e.g. 'app.example'
  address: Address;
  statement?: string;
  uri: string;                // e.g. 'http://127.0.0.1:5173'
  chainId: number;
  nonce: string;              // caller-supplied; should be random
  issuedAt?: string;          // ISO; defaults to now
  expirationTime?: string;    // ISO; optional
}

export interface SiweParsed {
  domain: string;
  address: Address;
  statement: string | null;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string | null;
}

/** Build an EIP-4361 message string from structured input. */
export function buildMessage(input: SiweMessageInput): string {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const lines: string[] = [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    '',
  ];
  if (input.statement) {
    lines.push(input.statement);
    lines.push('');
  }
  lines.push(`URI: ${input.uri}`);
  lines.push(`Version: 1`);
  lines.push(`Chain ID: ${input.chainId}`);
  lines.push(`Nonce: ${input.nonce}`);
  lines.push(`Issued At: ${issuedAt}`);
  if (input.expirationTime) {
    lines.push(`Expiration Time: ${input.expirationTime}`);
  }
  return lines.join('\n');
}

/**
 * Parse a SIWE message into its fields. Strict: rejects messages that don't
 * match the EIP-4361 shape we produce. We deliberately don't accept every
 * valid SIWE message variant — only what we generate.
 */
export function parseMessage(text: string): SiweParsed {
  const lines = text.split('\n');
  if (lines.length < 7) {
    throw new Error('SIWE parse: message too short');
  }
  const domainMatch = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/);
  if (!domainMatch) throw new Error('SIWE parse: missing/malformed domain line');
  const domain = domainMatch[1]!;
  const address = lines[1] as Address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('SIWE parse: malformed address');
  if (lines[2] !== '') throw new Error('SIWE parse: missing blank line after address');

  let i = 3;
  let statement: string | null = null;
  // Statement is optional and ends with a blank line if present
  if (lines[i] && !lines[i]!.startsWith('URI: ')) {
    statement = lines[i] ?? null;
    i++;
    if (lines[i] !== '') throw new Error('SIWE parse: missing blank line after statement');
    i++;
  }
  const required = ['URI: ', 'Version: ', 'Chain ID: ', 'Nonce: ', 'Issued At: '];
  const fields: Record<string, string> = {};
  for (const prefix of required) {
    const line = lines[i++];
    if (!line || !line.startsWith(prefix)) {
      throw new Error(`SIWE parse: expected line starting with "${prefix}"`);
    }
    fields[prefix.replace(/[:\s]/g, '').toLowerCase()] = line.slice(prefix.length).trim();
  }
  let expirationTime: string | null = null;
  if (lines[i] && lines[i]!.startsWith('Expiration Time: ')) {
    expirationTime = lines[i]!.slice('Expiration Time: '.length).trim();
  }
  return {
    domain,
    address,
    statement,
    uri: fields.uri!,
    version: fields.version!,
    chainId: Number(fields.chainid),
    nonce: fields.nonce!,
    issuedAt: fields.issuedat!,
    expirationTime,
  };
}

function eip191Digest(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix, 0);
  combined.set(bytes, prefix.length);
  return keccak_256(combined);
}

function recoverAddress(digest: Uint8Array, sigHex: Hex): Address {
  const sig = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex;
  if (sig.length !== 130) throw new Error('SIWE verify: signature must be 65 bytes');
  const r = BigInt('0x' + sig.slice(0, 64));
  const s = BigInt('0x' + sig.slice(64, 128));
  const v = parseInt(sig.slice(128, 130), 16);
  const recovery = v >= 27 ? v - 27 : v;
  const signature = new secp256k1.Signature(r, s).addRecoveryBit(recovery);
  const pub = signature.recoverPublicKey(digest).toBytes(false);
  const hash = keccak_256(pub.slice(1));
  let hex = '0x';
  for (const b of hash.slice(12)) hex += b.toString(16).padStart(2, '0');
  return hex as Address;
}

export interface SiweVerifyResult {
  ok: true;
  address: Address;
  parsed: SiweParsed;
}
export interface SiweVerifyError {
  ok: false;
  reason: string;
}

/**
 * Pure parse-and-validate — checks version, domain, nonce, expiration,
 * and computes the EIP-191 digest. Does NOT verify the signature.
 *
 * Used by `verify` (ECDSA path) and `verifyOnchain` (ERC-1271/6492 path).
 * Splitting this out lets callers verify signatures against a contract
 * (e.g. `UniversalSignatureValidator`) without re-implementing the SIWE
 * field validation.
 */
export function parseAndValidate(
  message: string,
  opts: { now?: () => number; allowedDomains?: string[]; expectedNonce: string },
): { ok: true; parsed: SiweParsed; digest: Uint8Array } | SiweVerifyError {
  // CA-001 (audit 2026-06-09): the nonce is REQUIRED. Replay protection is void without it — a
  // captured signature would replay for the message's whole validity window. The caller issues a
  // one-shot nonce and consumes it from its own store (this package is stateless by design).
  if (typeof opts?.expectedNonce !== 'string' || opts.expectedNonce.length === 0) {
    return { ok: false, reason: 'expectedNonce is required (CA-001)' };
  }
  let parsed: SiweParsed;
  try {
    parsed = parseMessage(message);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'parse error' };
  }
  if (parsed.version !== '1') return { ok: false, reason: 'SIWE version not 1' };

  if (opts.allowedDomains && !opts.allowedDomains.includes(parsed.domain)) {
    return { ok: false, reason: `domain "${parsed.domain}" not allowed` };
  }
  if (opts.expectedNonce !== parsed.nonce) {
    return { ok: false, reason: 'nonce mismatch' };
  }

  const nowMs = (opts?.now ?? Date.now)();
  if (parsed.expirationTime) {
    const exp = Date.parse(parsed.expirationTime);
    if (Number.isNaN(exp) || exp < nowMs) {
      return { ok: false, reason: 'message expired' };
    }
  }
  const issued = Date.parse(parsed.issuedAt);
  if (Number.isNaN(issued)) return { ok: false, reason: 'issuedAt unparseable' };
  if (issued > nowMs + 60_000) return { ok: false, reason: 'issuedAt is in the future' };

  return { ok: true, parsed, digest: eip191Digest(message) };
}

/**
 * Verify a SIWE message via a caller-supplied async signature verifier
 * (typically `verifyUserSignature` from `./verify-signature`, which calls
 * the on-chain `UniversalSignatureValidator`).
 *
 * Per spec 130 and the `demo-a2a is signer-agnostic` doctrine: when the
 * SIWE `address` is a smart account, this is how we verify — the
 * validator dispatches between ECDSA / ERC-1271 / ERC-6492 on-chain,
 * supporting EOA-owned, passkey-owned, and counterfactual accounts
 * without the caller branching on signer type.
 */
export async function verifyOnchain(
  message: string,
  signature: Hex,
  signatureVerifier: (args: {
    signer: Address;
    hash: Hex;
    signature: Hex;
  }) => Promise<boolean>,
  // CA-001: `expectedNonce` is required (single-use, caller-consumed).
  opts: { now?: () => number; allowedDomains?: string[]; expectedNonce: string },
): Promise<SiweVerifyResult | SiweVerifyError> {
  const pre = parseAndValidate(message, opts);
  if (!pre.ok) return pre;

  // Render digest as 0x-hex for the verifier API.
  let hexDigest = '0x';
  for (const b of pre.digest) hexDigest += b.toString(16).padStart(2, '0');

  let valid: boolean;
  try {
    valid = await signatureVerifier({
      signer: pre.parsed.address,
      hash: hexDigest as Hex,
      signature,
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'verifier threw' };
  }
  if (!valid) {
    return { ok: false, reason: 'on-chain signature verification rejected' };
  }
  return { ok: true, address: pre.parsed.address, parsed: pre.parsed };
}

/**
 * Legacy ECDSA-only SIWE verifier. Recovers the signer address from the
 * 65-byte signature and compares against the message's `address` field.
 *
 * Prefer `verifyOnchain` for new code — it goes through the universal
 * validator and works for both EOA-owned and smart-account-owned
 * (passkey, multisig, etc.) signers. Kept here for backward compat with
 * the existing `verify` tests and the EOA-only siwe verifier path.
 */
export function verify(
  message: string,
  signature: Hex,
  // CA-001: `expectedNonce` is required (single-use, caller-consumed).
  opts: { now?: () => number; allowedDomains?: string[]; expectedNonce: string },
): SiweVerifyResult | SiweVerifyError {
  const pre = parseAndValidate(message, opts);
  if (!pre.ok) return pre;

  let recovered: Address;
  try {
    recovered = recoverAddress(pre.digest, signature);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'signature recovery failed' };
  }
  if (recovered.toLowerCase() !== pre.parsed.address.toLowerCase()) {
    return { ok: false, reason: 'recovered signer does not match message address' };
  }
  return { ok: true, address: pre.parsed.address, parsed: pre.parsed };
}
