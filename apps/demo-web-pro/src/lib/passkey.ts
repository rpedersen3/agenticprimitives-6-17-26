/**
 * WebAuthn / passkey enrollment + signing helpers for demo-web-pro.
 * Mirrors apps/demo-web/src/passkey-flow.ts at a smaller surface —
 * we only need the registration ceremony here (enrollment), not the
 * full session-signing path that demo-web does.
 *
 * The registered passkey is persisted in localStorage so subsequent
 * sessions can sign with it. Demo-only — production must use
 * platform secure storage.
 */

import { keccak256 } from 'viem';
import { parseAttestationObject } from '@agenticprimitives/identity-auth/passkey';
import type { Hex } from '@agenticprimitives/types';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:passkeys';

export interface DemoPasskey {
  /** keccak256(credentialId) — the bytes32 the on-chain code keys by. */
  credentialIdDigest: Hex;
  /** Raw credential ID as a base64url-encoded string. */
  credentialIdB64: string;
  /** P-256 public key X coordinate (uint256). */
  pubKeyX: bigint;
  /** P-256 public key Y coordinate (uint256). */
  pubKeyY: bigint;
  /** UI label (e.g. user-chosen "Phone passkey"). */
  label: string;
  /** Account address this passkey was enrolled onto (for indexing). */
  account?: string;
}

interface StoredPasskey {
  credentialIdDigest: Hex;
  credentialIdB64: string;
  pubKeyX: string;
  pubKeyY: string;
  label: string;
  account?: string;
}

function toStored(p: DemoPasskey): StoredPasskey {
  return {
    credentialIdDigest: p.credentialIdDigest,
    credentialIdB64: p.credentialIdB64,
    pubKeyX: p.pubKeyX.toString(),
    pubKeyY: p.pubKeyY.toString(),
    label: p.label,
    account: p.account,
  };
}

function fromStored(s: StoredPasskey): DemoPasskey {
  return {
    credentialIdDigest: s.credentialIdDigest,
    credentialIdB64: s.credentialIdB64,
    pubKeyX: BigInt(s.pubKeyX),
    pubKeyY: BigInt(s.pubKeyY),
    label: s.label,
    account: s.account,
  };
}

export function loadPasskeys(): DemoPasskey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredPasskey[];
    return parsed.map(fromStored);
  } catch {
    return [];
  }
}

export function savePasskey(passkey: DemoPasskey): void {
  const existing = loadPasskeys();
  // Replace by credentialIdDigest if already present.
  const filtered = existing.filter((p) => p.credentialIdDigest !== passkey.credentialIdDigest);
  filtered.push(passkey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.map(toStored)));
}

/**
 * Registration: prompts the user (TouchID / FaceID / security key) to
 * create a new passkey credential. Parses the attestation object to
 * extract the P-256 public key.
 *
 * Returns the registered passkey; does NOT persist (caller decides
 * whether to call `savePasskey` after a successful chain enrollment).
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
      rp: { id: window.location.hostname, name: 'agenticprimitives demo-web-pro' },
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

  return {
    credentialIdDigest: hashCredentialIdDigest(parsed.credentialId),
    credentialIdB64: parsed.credentialIdBase64Url,
    pubKeyX: parsed.pubKeyX,
    pubKeyY: parsed.pubKeyY,
    label,
  };
}

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex as Hex;
}

function hashCredentialIdDigest(credentialId: Uint8Array): Hex {
  return keccak256(bytesToHex(credentialId)) as Hex;
}
