/**
 * Passkey (WebAuthn) auth method.
 *
 * This module is the home of the WebAuthn ceremony for the agenticprimitives
 * stack:
 *   - challenge encoding (32-byte hash → base64url challenge)
 *   - DER signature parsing → (r, s)
 *   - low-s normalisation (P-256 group order)
 *   - WebAuthn `Assertion` struct building from a raw browser response
 *     (the structured form that `AgentAccount._verifyWebAuthn` consumes)
 *   - COSE attestation parsing → P-256 (x, y) public key for on-chain
 *     credential registration via `AgentAccountFactory.createAccountWithPasskey`
 *
 * Doctrine: passkey ceremony belongs in connect-auth per the package's
 * CLAUDE.md. Downstream packages (`agent-account`) consume the
 * `WebAuthnAssertion` struct produced here and encode it into the
 * smart-account signature wire format (`0x01 || abi.encode(...)`).
 *
 * Ported from smart-agent `packages/sdk/src/{passkey,cose-parse}.ts`
 * (branch 003-intent-marketplace-proposal) — adapted to agenticprimitives
 * package boundaries.
 */

import { keccak256, toHex, toBytes } from 'viem';
import type { Hex } from '../types';

// ─── Constants ───────────────────────────────────────────────────────

/** secp256r1 (P-256) group order. */
export const P256_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// ─── Base64url codec ─────────────────────────────────────────────────

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice((2 - (s.length & 3)) & 3);
  const bin =
    typeof atob === 'function'
      ? atob(padded)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(padded, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── DER signature parsing + low-s normalisation ─────────────────────

export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der.length < 8) throw new Error('DER: too short');
  if (der[0] !== 0x30) throw new Error('DER: missing sequence tag');
  let i = 2;
  if (der[i] !== 0x02) throw new Error('DER: missing r tag');
  i++;
  const rLen = der[i]!;
  i++;
  const rBytes = der.slice(i, i + rLen);
  i += rLen;
  if (der[i] !== 0x02) throw new Error('DER: missing s tag');
  i++;
  const sLen = der[i]!;
  i++;
  const sBytes = der.slice(i, i + sLen);
  i += sLen;
  return { r: bytesToBigInt(rBytes), s: bytesToBigInt(sBytes) };
}

/**
 * Many WebAuthn authenticators emit high-s signatures (allowed by FIPS
 * 186-4). The on-chain RIP-7212 precompile accepts both halves, but we
 * normalise defensively so we stay compatible with stricter off-chain
 * verifiers.
 */
export function normaliseLowS(s: bigint): bigint {
  return s > P256_N / 2n ? P256_N - s : s;
}

// ─── Assertion struct (structured WebAuthn assertion) ────────────────

/**
 * Structured WebAuthn assertion in the shape `AgentAccount._verifyWebAuthn`
 * consumes (the contract decodes this struct from the signature blob).
 *
 * Distinct from `PasskeyAssertion` (in `../types`), which is the
 * protocol-level raw form returned by `PasskeySigner.assert()`.
 */
export interface WebAuthnAssertion {
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeIndex: bigint;
  typeIndex: bigint;
  r: bigint;
  s: bigint;
  credentialIdDigest: Hex;
}

/**
 * Build a `WebAuthnAssertion` from a raw browser
 * `navigator.credentials.get()` response.
 *
 * @param credentialIdBytes  raw credentialId bytes
 * @param authenticatorData  response.authenticatorData
 * @param clientDataJSON     response.clientDataJSON (UTF-8 bytes)
 * @param derSignature       response.signature (DER ECDSA)
 */
export function buildWebAuthnAssertion(args: {
  credentialIdBytes: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  derSignature: Uint8Array;
}): WebAuthnAssertion {
  const cdjStr = new TextDecoder().decode(args.clientDataJSON);
  const cdjBytes = args.clientDataJSON;

  const typeMarker = new TextEncoder().encode('"type":"webauthn.get"');
  const typeIndex = findIndex(cdjBytes, typeMarker);
  if (typeIndex < 0) {
    throw new Error('clientDataJSON: missing "type":"webauthn.get"');
  }

  const challengeMarker = new TextEncoder().encode('"challenge":"');
  const challengeIndex = findIndex(cdjBytes, challengeMarker);
  if (challengeIndex < 0) {
    throw new Error('clientDataJSON: missing "challenge" key');
  }

  const { r, s } = parseDerSignature(args.derSignature);

  return {
    authenticatorData: toHex(args.authenticatorData),
    clientDataJSON: cdjStr,
    challengeIndex: BigInt(challengeIndex),
    typeIndex: BigInt(typeIndex),
    r,
    s: normaliseLowS(s),
    credentialIdDigest: keccak256(args.credentialIdBytes),
  };
}

/**
 * Convert a 32-byte hash to the base64url-encoded challenge string
 * `navigator.credentials.get({ publicKey: { challenge } })` accepts.
 */
export function hashToWebAuthnChallenge(hash: Hex): string {
  return base64urlEncode(toBytes(hash));
}

// ─── COSE attestation parsing (registration ceremony) ────────────────

export interface ParsedAttestation {
  credentialId: Uint8Array;
  credentialIdBase64Url: string;
  pubKeyX: bigint;
  pubKeyY: bigint;
  aaguid: Uint8Array;
  signCount: number;
  flagAttestedCredentialData: boolean;
  flagUserPresent: boolean;
  flagUserVerified: boolean;
}

/**
 * Parse a WebAuthn `attestationObject` (CBOR-encoded) returned by
 * `navigator.credentials.create()` → P-256 public key (x, y) plus
 * credentialId, suitable for on-chain registration via
 * `AgentAccountFactory.createAccountWithPasskey(credentialIdDigest, x, y, salt)`.
 */
export function parseAttestationObject(
  attestationObject: Uint8Array,
): ParsedAttestation {
  const top = cborDecode(attestationObject);
  if (!isMap(top)) throw new Error('attestationObject: expected CBOR map');
  const authData = mapGet(top, 'authData') as Uint8Array | undefined;
  if (!(authData instanceof Uint8Array)) {
    throw new Error('attestationObject: missing authData');
  }
  return parseAuthData(authData);
}

export function parseAuthData(authData: Uint8Array): ParsedAttestation {
  if (authData.length < 37) throw new Error('authData too short');
  const flags = authData[32]!;
  const signCount = new DataView(
    authData.buffer,
    authData.byteOffset + 33,
    4,
  ).getUint32(0, false);
  const flagUP = (flags & 0x01) !== 0;
  const flagUV = (flags & 0x04) !== 0;
  const flagAT = (flags & 0x40) !== 0;
  if (!flagAT) {
    throw new Error('authData: attested credential data flag not set');
  }
  if (authData.length < 37 + 16 + 2) {
    throw new Error('authData too short for attested credential data');
  }
  let i = 37;
  const aaguid = authData.slice(i, i + 16);
  i += 16;
  const credIdLen = (authData[i]! << 8) | authData[i + 1]!;
  i += 2;
  const credentialId = authData.slice(i, i + credIdLen);
  i += credIdLen;
  const cosePubKeyBytes = authData.slice(i);
  const coseMap = cborDecode(cosePubKeyBytes);
  if (!isMap(coseMap)) throw new Error('COSE_Key: expected map');
  const x = mapGet(coseMap, -2) as Uint8Array | undefined;
  const y = mapGet(coseMap, -3) as Uint8Array | undefined;
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error('COSE_Key: missing x/y coordinates');
  }
  return {
    credentialId,
    credentialIdBase64Url: base64urlFromBytes(credentialId),
    pubKeyX: bytesToBigInt(x),
    pubKeyY: bytesToBigInt(y),
    aaguid,
    signCount,
    flagAttestedCredentialData: flagAT,
    flagUserPresent: flagUP,
    flagUserVerified: flagUV,
  };
}

// ─── Login/signup stubs (real ceremony deferred to apps) ─────────────

export interface PasskeySignupInput {
  label: string;
  challenge: Hex;
}

export async function beginSignup(_input: { label: string }): Promise<never> {
  throw new Error('connect-auth/passkey: beginSignup not implemented yet.');
}

export async function completeSignup(_req: unknown): Promise<never> {
  throw new Error('connect-auth/passkey: completeSignup not implemented yet.');
}

export async function beginLogin(_input: { credentialId: string }): Promise<never> {
  throw new Error('connect-auth/passkey: beginLogin not implemented yet.');
}

export async function completeLogin(_req: unknown): Promise<never> {
  throw new Error('connect-auth/passkey: completeLogin not implemented yet.');
}

// ─── Private helpers ─────────────────────────────────────────────────

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function base64urlFromBytes(b: Uint8Array): string {
  return base64urlEncode(b);
}

function findIndex(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ─── Minimal CBOR decoder (RFC 8949 subset) ──────────────────────────

type CborMap = Map<CborKey, CborValue>;
type CborKey = number | bigint | string;
type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | CborValue[]
  | CborMap
  | boolean
  | null;

function isMap(v: unknown): v is CborMap {
  return v instanceof Map;
}

function mapGet(m: CborMap, key: CborKey): CborValue | undefined {
  if (m.has(key)) return m.get(key);
  if (typeof key === 'number') {
    const bk = BigInt(key);
    if (m.has(bk)) return m.get(bk);
  }
  return undefined;
}

function cborDecode(bytes: Uint8Array): CborValue {
  const reader = {
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    pos: 0,
  };
  return decodeOne(reader);

  function decodeOne(r: { view: DataView; pos: number }): CborValue {
    const first = r.view.getUint8(r.pos++);
    const major = first >> 5;
    const minor = first & 0x1f;
    const len = readLength(r, minor);
    switch (major) {
      case 0:
        return len as number | bigint;
      case 1:
        return typeof len === 'bigint'
          ? -(len + 1n)
          : -(len as number) - 1;
      case 2: {
        const b = new Uint8Array(
          r.view.buffer,
          r.view.byteOffset + r.pos,
          Number(len),
        );
        r.pos += Number(len);
        return b.slice();
      }
      case 3: {
        const b = new Uint8Array(
          r.view.buffer,
          r.view.byteOffset + r.pos,
          Number(len),
        );
        r.pos += Number(len);
        return new TextDecoder().decode(b);
      }
      case 4: {
        const out: CborValue[] = [];
        for (let i = 0n; i < BigInt(len); i++) out.push(decodeOne(r));
        return out;
      }
      case 5: {
        const m: CborMap = new Map();
        for (let i = 0n; i < BigInt(len); i++) {
          const k = decodeOne(r) as CborKey;
          const v = decodeOne(r);
          m.set(k, v);
        }
        return m;
      }
      case 7:
        if (minor === 20) return false;
        if (minor === 21) return true;
        if (minor === 22) return null;
        throw new Error('CBOR: unsupported simple/float value');
      default:
        throw new Error(`CBOR: unsupported major type ${major}`);
    }
  }

  function readLength(
    r: { view: DataView; pos: number },
    minor: number,
  ): number | bigint {
    if (minor < 24) return minor;
    if (minor === 24) {
      const v = r.view.getUint8(r.pos);
      r.pos += 1;
      return v;
    }
    if (minor === 25) {
      const v = r.view.getUint16(r.pos, false);
      r.pos += 2;
      return v;
    }
    if (minor === 26) {
      const v = r.view.getUint32(r.pos, false);
      r.pos += 4;
      return v;
    }
    if (minor === 27) {
      const hi = r.view.getUint32(r.pos, false);
      const lo = r.view.getUint32(r.pos + 4, false);
      r.pos += 8;
      return (BigInt(hi) << 32n) | BigInt(lo);
    }
    throw new Error('CBOR: indefinite-length / reserved length not supported');
  }
}
