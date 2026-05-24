/**
 * WebAuthn / passkey enrollment + signing helpers for demo-web-pro.
 *
 * Storage layout (spec 211 § 4 — multi-seat demo):
 *
 *   passkeys[seatId] = DemoPasskey
 *
 * Each seat (Alice, Bob, …) gets its own passkey. The visitor is the
 * SAME human across seats — the demo asks them to register a NEW
 * passkey per seat so the "two-admin org" picture is visible. The
 * registration ceremony's `user.id` is the seat id, which the
 * authenticator uses to disambiguate.
 *
 * The "active seat" lives in seats.ts. Helpers here look up the passkey
 * by seat. Demo-only; production must use platform secure storage.
 */

import { keccak256, type Hex } from 'viem';
import {
  parseAttestationObject,
  buildWebAuthnAssertion,
  type WebAuthnAssertion,
} from '@agenticprimitives/identity-auth/passkey';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:passkeys';

export interface DemoPasskey {
  /** keccak256(credentialId) — the bytes32 the on-chain code keys by. */
  credentialIdDigest: Hex;
  /** Raw credential ID as base64url. */
  credentialIdB64: string;
  /** P-256 public key X coordinate. */
  pubKeyX: bigint;
  /** P-256 public key Y coordinate. */
  pubKeyY: bigint;
  /** UI label (typically the seat name). */
  label: string;
  /**
   * Predicted / claimed `.agent` name that this passkey controls. Set
   * BEFORE WebAuthn registration so the OS shows the credential as
   * "alice3.demo.agent" rather than "demo-web-pro" + a seat id. Per
   * ADR-0010 (canonical-identifier doctrine) the credential is a
   * facet pointing AT the SA — the credential's human label here
   * matches the SA's primary `.agent` name.
   */
  agentName?: string;
  /** Person Smart Agent address — set once the account is deployed. */
  account?: string;
}

interface StoredPasskey {
  credentialIdDigest: Hex;
  credentialIdB64: string;
  pubKeyX: string;
  pubKeyY: string;
  label: string;
  agentName?: string;
  account?: string;
}

type StoredRecord = Record<string, StoredPasskey>;

function toStored(p: DemoPasskey): StoredPasskey {
  return {
    credentialIdDigest: p.credentialIdDigest,
    credentialIdB64: p.credentialIdB64,
    pubKeyX: p.pubKeyX.toString(),
    pubKeyY: p.pubKeyY.toString(),
    label: p.label,
    agentName: p.agentName,
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
    agentName: s.agentName,
    account: s.account,
  };
}

function readRecord(): StoredRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredRecord;
  } catch {
    return {};
  }
}

function writeRecord(record: StoredRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function getPasskeyForSeat(seatId: string): DemoPasskey | null {
  const record = readRecord();
  return record[seatId] ? fromStored(record[seatId]) : null;
}

export function savePasskeyForSeat(seatId: string, passkey: DemoPasskey): void {
  const record = readRecord();
  record[seatId] = toStored(passkey);
  writeRecord(record);
}

export function clearPasskeyForSeat(seatId: string): void {
  const record = readRecord();
  delete record[seatId];
  writeRecord(record);
}

export function listPasskeys(): Record<string, DemoPasskey> {
  const record = readRecord();
  const out: Record<string, DemoPasskey> = {};
  for (const [k, v] of Object.entries(record)) out[k] = fromStored(v);
  return out;
}

/**
 * Register a new passkey for the given seat. Prompts the user via
 * WebAuthn (TouchID / FaceID / security key). Does NOT persist —
 * caller saves via savePasskeyForSeat after chain confirmation.
 *
 * `agentName` (optional, e.g. `"alice3.demo.agent"`) lets the OS-level
 * passkey display match the SA's predicted primary `.agent` name. The
 * caller pre-computes it via `predictUniqueAgentLabel` BEFORE this
 * call so the WebAuthn ceremony writes the matching `user.name` /
 * `user.displayName` (the strings the OS keychain shows). After
 * registration the SA is deployed and `subregistry.register` claims
 * the same label, so the passkey ↔ SA name pair lines up end-to-end.
 *
 * If `agentName` is omitted (older flow) the OS shows
 * `<seatId>@agenticprimitives.demo` as before.
 */
export async function registerPasskeyForSeat(
  seatId: string,
  label: string,
  agentName?: string,
): Promise<DemoPasskey> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn unavailable — this browser does not support passkeys.');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  // Seat id encodes which actor is being created. Authenticators can
  // use this to display "Create credential for Alice@…" prompts.
  const userId = new TextEncoder().encode(`agenticprimitives:demo-web-pro:${seatId}`);

  // Per ADR-0010 the credential is a facet pointing AT the SA. We make
  // that explicit in the OS keychain entry by using the `.agent` name
  // for `user.name` and a "<seat> — <agent-name>" pair for
  // `user.displayName`. Falls back to the prior shape when no
  // agentName was predicted.
  const credentialUserName = agentName ?? `${seatId}@agenticprimitives.demo`;
  const credentialDisplayName = agentName ? `${label} — ${agentName}` : label;

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        id: window.location.hostname,
        name: 'agenticprimitives Treasury demo',
      },
      user: {
        id: userId,
        name: credentialUserName,
        displayName: credentialDisplayName,
      },
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
    agentName,
  };
}

/**
 * Build a WebAuthn assertion over `digest` using the given passkey.
 * The browser prompts the user via TouchID / FaceID / security key
 * for the credential identified by passkey.credentialIdB64.
 *
 * Returns the structured assertion — callers wrap it via
 * `encodeWebAuthnSignature` to produce the 0x01-prefixed blob the
 * on-chain `_verifyWebAuthn` expects.
 */
export async function assertWithPasskey(
  passkey: DemoPasskey,
  digest: Hex,
): Promise<WebAuthnAssertion> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn unavailable — this browser does not support passkeys.');
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

function bytesToHex(bytes: Uint8Array): Hex {
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex as Hex;
}

function hexToBytes(hex: Hex): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) throw new Error('hex length not even');
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function b64uDecode(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hashCredentialIdDigest(credentialId: Uint8Array): Hex {
  return keccak256(bytesToHex(credentialId));
}
