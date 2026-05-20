// Passkey (WebAuthn) flow for the demo web app.
//
// Owns:
//   - Registration ceremony: `navigator.credentials.create` →
//     attestation → extract P-256 (x, y) + credentialId.
//   - Signing ceremony: `navigator.credentials.get` → build
//     `WebAuthnAssertion` → encode on-chain wire format
//     (`0x01 || abi.encode(Assertion)`).
//   - localStorage persistence of (credentialId, x, y), analogous to
//     the EOA flow's mnemonic-in-localStorage pattern. Demo-only;
//     production must use platform secure storage or hardware-backed
//     IDB.
//
// All ceremony helpers come from `@agenticprimitives/identity-auth/passkey`;
// the on-chain wire encoder from `@agenticprimitives/agent-account`.
// This module is the glue between the browser's WebAuthn API and the
// abstract primitives our other packages export.

import { keccak256 } from 'viem';
import {
  parseAttestationObject,
  buildWebAuthnAssertion,
} from '@agenticprimitives/identity-auth/passkey';
import type { WebAuthnAssertion } from '@agenticprimitives/identity-auth/passkey';
import { encodeWebAuthnSignature } from '@agenticprimitives/agent-account';
import type { Hex } from '@agenticprimitives/types';

const STORAGE_KEY = 'agenticprimitives:demo:passkey';

export interface DemoPasskey {
  /** keccak256(credentialId) — the bytes32 the on-chain code keys by. */
  credentialIdDigest: Hex;
  /** Raw credential ID as a base64url-encoded string. */
  credentialIdB64: string;
  /** P-256 public key X coordinate (uint256). */
  pubKeyX: bigint;
  /** P-256 public key Y coordinate (uint256). */
  pubKeyY: bigint;
  /** UI label (e.g. user-chosen "Demo passkey 1"). */
  label: string;
}

// Storage form — bigints serialised as decimal strings.
interface StoredPasskey {
  credentialIdDigest: Hex;
  credentialIdB64: string;
  pubKeyX: string;
  pubKeyY: string;
  label: string;
}

function toStored(p: DemoPasskey): StoredPasskey {
  return {
    credentialIdDigest: p.credentialIdDigest,
    credentialIdB64: p.credentialIdB64,
    pubKeyX: p.pubKeyX.toString(),
    pubKeyY: p.pubKeyY.toString(),
    label: p.label,
  };
}

function fromStored(s: StoredPasskey): DemoPasskey {
  return {
    credentialIdDigest: s.credentialIdDigest,
    credentialIdB64: s.credentialIdB64,
    pubKeyX: BigInt(s.pubKeyX),
    pubKeyY: BigInt(s.pubKeyY),
    label: s.label,
  };
}

export function loadPasskey(): DemoPasskey | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return fromStored(JSON.parse(raw) as StoredPasskey);
  } catch {
    return null;
  }
}

export function clearPasskey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function b64uEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice((2 - (s.length & 3)) & 3);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Registration: prompts the user to create a new passkey credential.
 * Parses the attestation object to extract the P-256 public key, then
 * persists everything in localStorage.
 *
 * Returns the registered DemoPasskey. Throws if the user cancels or
 * the platform doesn't support WebAuthn.
 */
export async function registerPasskey(label: string): Promise<DemoPasskey> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn unavailable — this browser does not support passkeys.');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const userId = new Uint8Array(16);
  crypto.getRandomValues(userId);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: window.location.hostname, name: 'agenticprimitives demo' },
      user: { id: userId, name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 / P-256
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('passkey registration cancelled');

  const response = credential.response as AuthenticatorAttestationResponse;
  const attestationBytes = new Uint8Array(response.attestationObject);
  const parsed = parseAttestationObject(attestationBytes);

  const passkey: DemoPasskey = {
    credentialIdDigest: hashCredentialIdDigest(parsed.credentialId),
    credentialIdB64: parsed.credentialIdBase64Url,
    pubKeyX: parsed.pubKeyX,
    pubKeyY: parsed.pubKeyY,
    label,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStored(passkey)));
  return passkey;
}

/**
 * Signing: prompts the user (TouchID/FaceID/etc.) to sign a 32-byte
 * digest. Returns the on-chain-ready signature blob
 * (`0x01 || abi.encode(WebAuthnAssertion)`) that AgentAccount's
 * `_validateSig` will dispatch through `_verifyWebAuthn`.
 *
 * Throws if no passkey is registered, the user cancels, or the
 * platform/browser refuses.
 */
export async function signWithPasskey(digest: Hex): Promise<Hex> {
  const passkey = loadPasskey();
  if (!passkey) {
    throw new Error('signWithPasskey: no registered passkey in localStorage');
  }
  const credentialIdBytes = b64uDecode(passkey.credentialIdB64);

  // WebAuthn signs sha256(authenticatorData || sha256(clientDataJSON)).
  // We can't control that hashing — but we DO control what goes into the
  // clientDataJSON challenge field. The WebAuthn library on-chain
  // reconstructs the digest from clientDataJSON.challenge, so we just
  // need the same base64url-encoded form here.
  const challengeBytes = hexToBytes(digest);
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes as BufferSource,
      allowCredentials: [
        { id: credentialIdBytes as BufferSource, type: 'public-key' },
      ],
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('passkey signing cancelled');

  const response = credential.response as AuthenticatorAssertionResponse;
  const assertion = buildWebAuthnAssertion({
    credentialIdBytes,
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    derSignature: new Uint8Array(response.signature),
  });

  return encodeWebAuthnSignature(assertion);
}

/**
 * Lower-level helper: produces the structured `WebAuthnAssertion`
 * struct without ABI-encoding. Useful for callers that want to embed
 * the assertion in another wrapper (e.g. ERC-6492).
 */
export async function buildPasskeyAssertion(digest: Hex): Promise<WebAuthnAssertion> {
  const passkey = loadPasskey();
  if (!passkey) {
    throw new Error('buildPasskeyAssertion: no registered passkey in localStorage');
  }
  const credentialIdBytes = b64uDecode(passkey.credentialIdB64);
  const challengeBytes = hexToBytes(digest);

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes as BufferSource,
      allowCredentials: [{ id: credentialIdBytes as BufferSource, type: 'public-key' }],
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('passkey signing cancelled');

  const response = credential.response as AuthenticatorAssertionResponse;
  return buildWebAuthnAssertion({
    credentialIdBytes,
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    derSignature: new Uint8Array(response.signature),
  });
}

// ─── helpers ──────────────────────────────────────────────────────────

function hexToBytes(hex: Hex): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) throw new Error('hex length not even');
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex as Hex;
}

function hashCredentialIdDigest(credentialId: Uint8Array): Hex {
  return keccak256(bytesToHex(credentialId)) as Hex;
}

// Re-export the bytes <-> hex helpers — useful for ERC-6492 wrapping.
export { hexToBytes, bytesToHex };
