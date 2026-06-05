/**
 * GcpKmsSigner unit tests — fetch is mocked; no real Cloud KMS calls.
 *
 * Strategy:
 *   - Pure helper tests (parseDerEcdsa, normalizeLowS, parseSpki*, etc.) use
 *     synthetic fixtures built locally with @noble/curves.
 *   - Class tests stub globalThis.fetch via vi.stubGlobal and program the
 *     token + KMS responses. JWTs are signed with a freshly-generated RSA
 *     keypair so the token step is exercised end-to-end via Web Crypto.
 *   - A test secp256k1 keypair is used to construct the "Cloud KMS" SPKI
 *     PEM and to produce DER-encoded signatures that the class then decodes.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from 'viem';
import {
  GcpKmsSigner,
  signJwt,
  pemToDer,
  parseDerEcdsa,
  normalizeLowS,
  parseSpkiUncompressedSecp256k1PubKey,
  publicKeyToAddress,
  findRecoveryByte,
  bigIntTo32Bytes,
} from '../../src/providers/gcp';

// ─── Helpers ────────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pkcs8DerToPem(der: Uint8Array): string {
  const b64 = bytesToBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

function spkiDerToPem(der: Uint8Array): string {
  const b64 = bytesToBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Build an X.509 SubjectPublicKeyInfo DER for an uncompressed secp256k1 point.
 * OID id-ecPublicKey (1.2.840.10045.2.1) + secp256k1 (1.3.132.0.10).
 */
function buildSecp256k1Spki(pubKey65: Uint8Array): Uint8Array {
  if (pubKey65.length !== 65 || pubKey65[0] !== 0x04) {
    throw new Error('buildSecp256k1Spki: expected 65-byte uncompressed point starting with 0x04');
  }
  const prefix = Uint8Array.from([
    0x30, 0x56,                                            // SEQUENCE 86 bytes
    0x30, 0x10,                                            // SEQUENCE 16 (AlgorithmIdentifier)
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,  // OID id-ecPublicKey
    0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a,              // OID secp256k1
    0x03, 0x42, 0x00,                                      // BIT STRING 66 bytes, 0 unused
  ]);
  const out = new Uint8Array(prefix.length + pubKey65.length);
  out.set(prefix, 0);
  out.set(pubKey65, prefix.length);
  return out;
}

/** DER-encode an ECDSA signature: SEQUENCE { INTEGER r, INTEGER s }. */
function derEncodeEcdsaSig(r: bigint, s: bigint): Uint8Array {
  const rBytes = bigIntToMinDerInteger(r);
  const sBytes = bigIntToMinDerInteger(s);
  const body = new Uint8Array(rBytes.length + sBytes.length + 4);
  body[0] = 0x02;
  body[1] = rBytes.length;
  body.set(rBytes, 2);
  body[2 + rBytes.length] = 0x02;
  body[3 + rBytes.length] = sBytes.length;
  body.set(sBytes, 4 + rBytes.length);
  const out = new Uint8Array(body.length + 2);
  out[0] = 0x30;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

function bigIntToMinDerInteger(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const parts = hex.match(/.{2}/g) ?? [];
  let bytes = Uint8Array.from(parts.map((b) => parseInt(b, 16)));
  // DER INTEGERs are signed; prepend 0x00 if top bit is set.
  if (bytes.length > 0 && (bytes[0]! & 0x80) !== 0) {
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes, 1);
    bytes = padded;
  }
  return bytes;
}

function decodeBase64Url(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const std = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(std);
}

// ─── Fixtures ───────────────────────────────────────────────────────────

const SECP_PRIV_HEX = '0x1111111111111111111111111111111111111111111111111111111111111111';
const SECP_PRIV = Uint8Array.from(SECP_PRIV_HEX.slice(2).match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const SECP_PUB_65 = secp256k1.getPublicKey(SECP_PRIV, false); // uncompressed, 65 bytes
const SECP_SPKI_PEM = spkiDerToPem(buildSecp256k1Spki(SECP_PUB_65));
const EXPECTED_ADDR = publicKeyToAddress(SECP_PUB_65);

const TEST_KEY_NAME =
  'projects/test-project/locations/us-central1/keyRings/test-ring/cryptoKeys/agent-master/cryptoKeyVersions/1';

let rsaPrivPem: string;
let serviceAccountJson: string;
let rsaPubForVerify: CryptoKey;

beforeAll(async () => {
  const { privateKey, publicKey } = (await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await globalThis.crypto.subtle.exportKey('pkcs8', privateKey);
  rsaPrivPem = pkcs8DerToPem(new Uint8Array(pkcs8));
  rsaPubForVerify = publicKey;
  serviceAccountJson = JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'test-signer@test-project.iam.gserviceaccount.com',
    private_key: rsaPrivPem,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Pure helper tests ──────────────────────────────────────────────────

describe('pemToDer', () => {
  it('strips headers and decodes base64', () => {
    const der = pemToDer(SECP_SPKI_PEM);
    expect(der).toBeInstanceOf(Uint8Array);
    expect(der.length).toBe(88); // 23 prefix bytes + 65 pubkey
  });
});

describe('parseSpkiUncompressedSecp256k1PubKey', () => {
  it('extracts the 65-byte uncompressed point from a valid SPKI', () => {
    const der = pemToDer(SECP_SPKI_PEM);
    const pub = parseSpkiUncompressedSecp256k1PubKey(der);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    expect(Array.from(pub)).toEqual(Array.from(SECP_PUB_65));
  });

  it('throws if the last byte block does not start with 0x04', () => {
    const bad = new Uint8Array(67);
    bad[bad.length - 65] = 0x03; // not the uncompressed marker
    expect(() => parseSpkiUncompressedSecp256k1PubKey(bad)).toThrow(
      /uncompressed point marker/,
    );
  });
});

describe('publicKeyToAddress', () => {
  it('matches keccak256(uncompressed-pubkey[1:]).slice(-20)', () => {
    const addr = publicKeyToAddress(SECP_PUB_65);
    expect(addr.startsWith('0x')).toBe(true);
    expect(addr.length).toBe(42);
    // Cross-check by recomputing manually:
    const raw = SECP_PUB_65.slice(1);
    const expected = bytesToHex(keccak_256(raw).slice(12));
    expect(addr.toLowerCase()).toBe(expected.toLowerCase());
  });
});

describe('parseDerEcdsa', () => {
  it('decodes a typical ECDSA signature', () => {
    const r = 0x1122334455667788_99aabbccddeeff00_1122334455667788_99aabbccddeeff00n;
    const s = 0x0011223344556677_8899aabbccddeeff_0011223344556677_8899aabbccddeeffn;
    const der = derEncodeEcdsaSig(r, s);
    const out = parseDerEcdsa(der);
    expect(out.r).toBe(r);
    expect(out.s).toBe(s);
  });

  it('handles leading-zero padding for high-bit r', () => {
    // r with the high bit set requires a 0x00 prefix byte in DER. Use a
    // valid 32-byte value (top bit set, < curve order n) so it exercises
    // the leading-zero path AND passes the r/s range check (F-7).
    const r = 0x8000000000000000000000000000000000000000000000000000000000000001n;
    const s = 0x01n;
    const der = derEncodeEcdsaSig(r, s);
    const out = parseDerEcdsa(der);
    expect(out.r).toBe(r);
    expect(out.s).toBe(s);
  });

  it('throws on missing SEQUENCE tag', () => {
    expect(() => parseDerEcdsa(Uint8Array.from([0x31, 0x00]))).toThrow(/SEQUENCE/);
  });

  it('throws on out-of-bounds read', () => {
    expect(() => parseDerEcdsa(Uint8Array.from([0x30]))).toThrow(/unexpected end/);
  });
});

describe('normalizeLowS', () => {
  it('returns s unchanged when s <= N/2', () => {
    const lowS = 1n;
    expect(normalizeLowS(lowS)).toBe(lowS);
  });

  it('flips s when s > N/2', () => {
    const N = secp256k1.Point.Fn.ORDER;
    const highS = N - 1n;
    const flipped = normalizeLowS(highS);
    expect(flipped).toBe(1n);
  });
});

describe('findRecoveryByte', () => {
  it('returns 27 or 28 and recovers the correct pubkey', async () => {
    const digest = keccak_256(new TextEncoder().encode('test'));
    // Sign with @noble to get a deterministic signature + recovery
    const sig = secp256k1.Signature.fromBytes(
      secp256k1.sign(digest, SECP_PRIV, { prehash: false, format: "recovered" }),
      "recovered",
    );
    const v = findRecoveryByte(sig.r, sig.s, digest, SECP_PUB_65);
    expect([27, 28]).toContain(v);
    expect(v - 27).toBe(sig.recovery);
  });

  it('throws when the signature does not match the known pubkey', () => {
    const digest = keccak_256(new TextEncoder().encode('test'));
    // Use a totally bogus r,s pair
    expect(() => findRecoveryByte(1n, 1n, digest, SECP_PUB_65)).toThrow(/Recovery byte search failed/);
  });
});

// ─── JWT signing tests ──────────────────────────────────────────────────

describe('signJwt', () => {
  it('produces a valid 3-segment JWT with correct claims and verifiable signature', async () => {
    const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
    const jwt = await signJwt(sa, 'https://www.googleapis.com/auth/cloudkms');
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]!)));
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]!)));
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
    expect(payload.iss).toBe(sa.client_email);
    expect(payload.scope).toBe('https://www.googleapis.com/auth/cloudkms');
    expect(payload.aud).toBe('https://oauth2.googleapis.com/token');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp).toBe(payload.iat + 3600);
    // Verify the signature with the matching public key
    const sig = decodeBase64Url(parts[2]!);
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await globalThis.crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      rsaPubForVerify,
      sig,
      signingInput,
    );
    expect(ok).toBe(true);
  });
});

// ─── Full GcpKmsSigner integration with mocked fetch ─────────────────────

describe('GcpKmsSigner (mocked fetch)', () => {
  function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>): void {
    vi.stubGlobal('fetch', vi.fn(impl) as unknown as typeof fetch);
  }

  function tokenResponse(): Response {
    return new Response(
      JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600, token_type: 'Bearer' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  function publicKeyResponse(): Response {
    return new Response(
      JSON.stringify({ pem: SECP_SPKI_PEM, algorithm: 'EC_SIGN_SECP256K1_SHA256' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  function signResponseForDigest(digest: Uint8Array): Response {
    const sig = secp256k1.Signature.fromBytes(
      secp256k1.sign(digest, SECP_PRIV, { prehash: false, format: "recovered" }),
      "recovered",
    );
    const der = derEncodeEcdsaSig(sig.r, sig.s);
    return new Response(
      JSON.stringify({ signature: bytesToBase64(der) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('constructor throws when GCP_KMS_KEY_NAME is missing', () => {
    expect(
      () => new GcpKmsSigner({ serviceAccountJson }),
    ).toThrow(/GCP_KMS_KEY_NAME/);
  });

  it('constructor throws when service account JSON is not parseable', () => {
    expect(
      () => new GcpKmsSigner({ cryptoKeyVersionName: TEST_KEY_NAME, serviceAccountJson: 'not json' }),
    ).toThrow(/not valid JSON/);
  });

  it('getSignerAddress fetches publicKey, derives address, and caches', async () => {
    let pubKeyCallCount = 0;
    let tokenCallCount = 0;
    mockFetch((url) => {
      if (url.includes('/oauth2.googleapis.com/token')) {
        tokenCallCount++;
        return tokenResponse();
      }
      if (url.endsWith('/publicKey')) {
        pubKeyCallCount++;
        return publicKeyResponse();
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const signer = new GcpKmsSigner({
      cryptoKeyVersionName: TEST_KEY_NAME,
      serviceAccountJson,
    });
    const addr1 = await signer.getSignerAddress();
    const addr2 = await signer.getSignerAddress();
    expect(addr1.toLowerCase()).toBe(EXPECTED_ADDR.toLowerCase());
    expect(addr2).toBe(addr1);
    expect(pubKeyCallCount).toBe(1); // cached
    expect(tokenCallCount).toBe(1); // also cached
  });

  it('signA2AAction returns a 65-byte signature that recovers to the known pubkey', async () => {
    const digest = keccak_256(new TextEncoder().encode('hello kms'));
    mockFetch((url) => {
      if (url.includes('/oauth2.googleapis.com/token')) return tokenResponse();
      if (url.endsWith('/publicKey')) return publicKeyResponse();
      if (url.endsWith(':asymmetricSign')) return signResponseForDigest(digest);
      throw new Error(`Unexpected URL ${url}`);
    });

    const signer = new GcpKmsSigner({
      cryptoKeyVersionName: TEST_KEY_NAME,
      serviceAccountJson,
    });
    const { signature, keyId, signerAddress } = await signer.signA2AAction({ digest });
    expect(signature.length).toBe(65);
    expect(keyId).toBe(TEST_KEY_NAME);
    expect(signerAddress.toLowerCase()).toBe(EXPECTED_ADDR.toLowerCase());
    expect([27, 28]).toContain(signature[64]!);

    // Recover pubkey from the assembled signature to confirm round-trip.
    const r = signature.slice(0, 32);
    const s = signature.slice(32, 64);
    const recovery = signature[64]! - 27;
    const compact = new Uint8Array(64);
    compact.set(r, 0);
    compact.set(s, 32);
    const recovered = secp256k1.Signature.fromBytes(compact)
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toBytes(false);
    expect(Array.from(recovered)).toEqual(Array.from(SECP_PUB_65));
  });

  it('signA2AAction throws for non-32-byte digest', async () => {
    mockFetch(() => tokenResponse());
    const signer = new GcpKmsSigner({
      cryptoKeyVersionName: TEST_KEY_NAME,
      serviceAccountJson,
    });
    await expect(
      signer.signA2AAction({ digest: new Uint8Array(31) }),
    ).rejects.toThrow(/32-byte digest/);
  });

  it('signA2AAction surfaces a clear error on KMS 4xx', async () => {
    mockFetch((url) => {
      if (url.includes('/oauth2.googleapis.com/token')) return tokenResponse();
      if (url.endsWith('/publicKey')) return publicKeyResponse();
      return new Response('Permission denied on resource', { status: 403 });
    });
    const signer = new GcpKmsSigner({
      cryptoKeyVersionName: TEST_KEY_NAME,
      serviceAccountJson,
    });
    const digest = keccak_256(new TextEncoder().encode('x'));
    await expect(signer.signA2AAction({ digest })).rejects.toThrow(/HTTP 403/);
  });

  it('surfaces a clear error when token exchange fails', async () => {
    mockFetch(() => new Response('invalid_grant', { status: 400 }));
    const signer = new GcpKmsSigner({
      cryptoKeyVersionName: TEST_KEY_NAME,
      serviceAccountJson,
    });
    await expect(signer.getSignerAddress()).rejects.toThrow(/GCP token exchange failed: HTTP 400/);
  });
});
