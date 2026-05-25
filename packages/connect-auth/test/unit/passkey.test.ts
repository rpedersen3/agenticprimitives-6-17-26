import { describe, it, expect } from 'vitest';
import {
  base64urlEncode,
  base64urlDecode,
  parseDerSignature,
  normaliseLowS,
  P256_N,
  buildWebAuthnAssertion,
  hashToWebAuthnChallenge,
  parseAttestationObject,
  parseAuthData,
} from '../../src/methods/passkey';

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 31, 32, 33, 64]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 7 + 3) & 0xff;
      const enc = base64urlEncode(bytes);
      const dec = base64urlDecode(enc);
      expect(Array.from(dec)).toEqual(Array.from(bytes));
    }
  });

  it('uses url-safe alphabet without padding', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xfe]); // would produce + and / in base64
    const enc = base64urlEncode(bytes);
    expect(enc).not.toContain('+');
    expect(enc).not.toContain('/');
    expect(enc).not.toContain('=');
  });
});

describe('parseDerSignature', () => {
  it('extracts r and s from a canonical DER blob', () => {
    // 0x30 0x44 [r: 0x02 0x20 …32 bytes…] [s: 0x02 0x20 …32 bytes…]
    const r = new Uint8Array(32).fill(0xaa);
    const s = new Uint8Array(32).fill(0xbb);
    const der = new Uint8Array([
      0x30,
      0x44,
      0x02,
      0x20,
      ...r,
      0x02,
      0x20,
      ...s,
    ]);
    const out = parseDerSignature(der);
    expect(out.r.toString(16)).toBe('aa'.repeat(32));
    expect(out.s.toString(16)).toBe('bb'.repeat(32));
  });

  it('throws on a malformed sequence', () => {
    // 0x31 in the first byte = bad SEQUENCE tag, but pad to >= 8 so the
    // length guard doesn't fire first.
    const bad = new Uint8Array(10);
    bad[0] = 0x31;
    expect(() => parseDerSignature(bad)).toThrow(/sequence tag/);
  });

  it('throws when r tag is missing', () => {
    // Valid sequence header, but byte [2] (where the r INTEGER tag
    // should be) is not 0x02.
    const bad = new Uint8Array(10);
    bad[0] = 0x30;
    bad[2] = 0x99; // wrong r tag
    expect(() => parseDerSignature(bad)).toThrow(/r tag/);
  });
});

describe('normaliseLowS', () => {
  it('returns s unchanged when already low-s', () => {
    const low = P256_N / 2n - 1n;
    expect(normaliseLowS(low)).toBe(low);
  });

  it('flips high-s to its low-s complement', () => {
    const high = P256_N / 2n + 1n;
    const flipped = normaliseLowS(high);
    expect(flipped).toBe(P256_N - high);
    // N is odd, so for high = N/2+1 the flipped value lands at exactly
    // N/2 (integer division). That still qualifies as low-s under the
    // standard convention (s ≤ N/2).
    expect(flipped <= P256_N / 2n).toBe(true);
  });

  it('treats exactly N/2 as low-s (boundary)', () => {
    const half = P256_N / 2n;
    expect(normaliseLowS(half)).toBe(half);
  });
});

describe('hashToWebAuthnChallenge', () => {
  it('encodes the 32-byte hash as url-safe base64 without padding', () => {
    const challenge = hashToWebAuthnChallenge(
      '0x' + 'ab'.repeat(32) as `0x${string}`,
    );
    expect(challenge.length).toBeGreaterThan(40);
    expect(challenge).not.toContain('=');
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
    // Round-trip back: decode should give exactly the hash bytes.
    const back = base64urlDecode(challenge);
    expect(back.length).toBe(32);
    for (const b of back) expect(b).toBe(0xab);
  });
});

describe('buildWebAuthnAssertion', () => {
  it('extracts r, s, indices, and credentialIdDigest from a raw assertion', () => {
    const credentialIdBytes = Uint8Array.from([1, 2, 3, 4]);
    const authenticatorData = new Uint8Array(37);
    authenticatorData[32] = 0x05; // some flags
    const clientDataJSON = new TextEncoder().encode(
      '{"type":"webauthn.get","challenge":"abc","origin":"https://example.com"}',
    );

    // Construct a low-s DER signature (rValue and sValue both 32 bytes).
    const rValue = new Uint8Array(32).fill(0x01);
    const sValue = new Uint8Array(32).fill(0x02);
    const der = new Uint8Array([
      0x30,
      0x44,
      0x02,
      0x20,
      ...rValue,
      0x02,
      0x20,
      ...sValue,
    ]);

    const a = buildWebAuthnAssertion({
      credentialIdBytes,
      authenticatorData,
      clientDataJSON,
      derSignature: der,
    });

    // bigint.toString(16) strips leading zeros; compare numerically.
    expect(a.r).toBe(BigInt('0x' + '01'.repeat(32)));
    expect(a.s).toBe(BigInt('0x' + '02'.repeat(32)));
    // typeIndex and challengeIndex must be the actual byte offsets within
    // the clientDataJSON string.
    expect(Number(a.typeIndex)).toBe(1); // '{"' then '"type":...'
    expect(Number(a.challengeIndex)).toBeGreaterThan(Number(a.typeIndex));
    // credentialIdDigest = keccak256([1,2,3,4]). Stable value:
    expect(a.credentialIdDigest).toBe(
      '0xa6885b3731702da62e8e4a8f584ac46a7f6822f4e2ba50fba902f67b1588d23b',
    );
    // authenticatorData is hex-encoded with 0x prefix.
    expect(a.authenticatorData.startsWith('0x')).toBe(true);
    expect(a.authenticatorData.length).toBe(2 + 37 * 2);
  });

  it('normalises high-s signatures', () => {
    const credentialIdBytes = Uint8Array.from([9]);
    const authenticatorData = new Uint8Array(37);
    const clientDataJSON = new TextEncoder().encode(
      '{"type":"webauthn.get","challenge":"x"}',
    );

    // Encode (P256_N - 1) as the s value — high-s, should flip to 1.
    const highS = P256_N - 1n;
    const sBytes = bigintToBytes32(highS);
    const rBytes = new Uint8Array(32).fill(0x07);
    const der = new Uint8Array([
      0x30,
      0x44,
      0x02,
      0x20,
      ...rBytes,
      0x02,
      0x20,
      ...sBytes,
    ]);

    const a = buildWebAuthnAssertion({
      credentialIdBytes,
      authenticatorData,
      clientDataJSON,
      derSignature: der,
    });

    expect(a.s).toBe(1n);
  });

  it('throws when clientDataJSON lacks the type marker', () => {
    expect(() =>
      buildWebAuthnAssertion({
        credentialIdBytes: Uint8Array.from([1]),
        authenticatorData: new Uint8Array(37),
        clientDataJSON: new TextEncoder().encode('{"foo":"bar"}'),
        derSignature: new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]),
      }),
    ).toThrow(/missing "type"/);
  });
});

describe('COSE attestation parsing', () => {
  it('parses a minimal hand-crafted authData with an ES256 COSE_Key', () => {
    // Build a minimal authData:
    //   rpIdHash(32) | flags(1) | signCount(4) | aaguid(16) |
    //   credIdLen(2) | credentialId | COSE_Key
    const rpIdHash = new Uint8Array(32).fill(0x11);
    const flags = 0x41; // AT (0x40) | UP (0x01)
    const signCount = Uint8Array.from([0, 0, 0, 7]);
    const aaguid = new Uint8Array(16).fill(0x22);
    const credentialId = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const credIdLen = Uint8Array.from([0, credentialId.length]);
    const x = new Uint8Array(32).fill(0xaa);
    const y = new Uint8Array(32).fill(0xbb);
    const coseKey = buildEs256CoseKey(x, y);

    const authData = concat([
      rpIdHash,
      Uint8Array.from([flags]),
      signCount,
      aaguid,
      credIdLen,
      credentialId,
      coseKey,
    ]);

    const parsed = parseAuthData(authData);
    expect(Array.from(parsed.credentialId)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(parsed.credentialIdBase64Url).toBe('3q2-7w'); // base64url of deadbeef
    expect(parsed.pubKeyX).toBe(BigInt('0x' + 'aa'.repeat(32)));
    expect(parsed.pubKeyY).toBe(BigInt('0x' + 'bb'.repeat(32)));
    expect(Array.from(parsed.aaguid)).toEqual(Array.from(aaguid));
    expect(parsed.signCount).toBe(7);
    expect(parsed.flagAttestedCredentialData).toBe(true);
    expect(parsed.flagUserPresent).toBe(true);
    expect(parsed.flagUserVerified).toBe(false);
  });

  it('throws when the AT flag is not set', () => {
    const authData = new Uint8Array(37); // all zeros — no AT flag
    expect(() => parseAuthData(authData)).toThrow(/attested credential data flag/);
  });

  it('throws on too-short authData', () => {
    expect(() => parseAuthData(new Uint8Array(10))).toThrow(/too short/);
  });

  it('parses a CBOR-wrapped attestationObject', () => {
    // Build a tiny attestationObject = CBOR map { "authData": <bytes> }.
    const rpIdHash = new Uint8Array(32).fill(0x33);
    const aaguid = new Uint8Array(16).fill(0x44);
    const credentialId = new Uint8Array([0xca, 0xfe]);
    const x = new Uint8Array(32).fill(0x55);
    const y = new Uint8Array(32).fill(0x66);
    const coseKey = buildEs256CoseKey(x, y);

    const authData = concat([
      rpIdHash,
      Uint8Array.from([0x40]), // AT only, no UP
      Uint8Array.from([0, 0, 0, 1]),
      aaguid,
      Uint8Array.from([0, 2]),
      credentialId,
      coseKey,
    ]);

    // CBOR map(1): { "authData": bytes(authData.length) }
    const attestationObject = concat([
      Uint8Array.from([0xa1]), // map of 1 entry
      cborText('authData'),
      cborBytes(authData),
    ]);

    const parsed = parseAttestationObject(attestationObject);
    expect(parsed.pubKeyX).toBe(BigInt('0x' + '55'.repeat(32)));
    expect(parsed.pubKeyY).toBe(BigInt('0x' + '66'.repeat(32)));
    expect(parsed.flagUserPresent).toBe(false);
    expect(parsed.flagAttestedCredentialData).toBe(true);
  });
});

// ─── Test helpers ────────────────────────────────────────────────────

function bigintToBytes32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** CBOR-encode a small text string (assumes length < 24). */
function cborText(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length >= 24) throw new Error('helper supports short strings only');
  return concat([Uint8Array.from([0x60 | bytes.length]), bytes]);
}

/** CBOR-encode a byte string (handles length encoding for AT data sizes). */
function cborBytes(b: Uint8Array): Uint8Array {
  if (b.length < 24) {
    return concat([Uint8Array.from([0x40 | b.length]), b]);
  }
  if (b.length < 0x100) {
    return concat([Uint8Array.from([0x58, b.length]), b]);
  }
  if (b.length < 0x10000) {
    return concat([
      Uint8Array.from([0x59, (b.length >> 8) & 0xff, b.length & 0xff]),
      b,
    ]);
  }
  throw new Error('helper supports up to 65535 byte strings');
}

/**
 * Build a CBOR ES256 COSE_Key map:
 *   { 1: 2, 3: -7, -1: 1, -2: x(32), -3: y(32) }
 * 5 entries, all keys < 24 (small int) — major-type 5 (map) with len 5
 * is one byte: 0xa5.
 */
function buildEs256CoseKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  if (x.length !== 32 || y.length !== 32) {
    throw new Error('x and y must be 32 bytes');
  }
  // CBOR small ints/negatives encoded as a single byte for [-24, 23].
  // key 1 → 0x01; value 2 → 0x02
  // key 3 → 0x03; value -7 → 0x26 (major 1, minor 6 → -(6+1) = -7)
  // key -1 → 0x20; value 1 → 0x01
  // key -2 → 0x21; value bytes(32) → 0x58 0x20 ...32...
  // key -3 → 0x22; value bytes(32) → 0x58 0x20 ...32...
  return concat([
    Uint8Array.from([0xa5]), // map(5)
    Uint8Array.from([0x01, 0x02]),
    Uint8Array.from([0x03, 0x26]),
    Uint8Array.from([0x20, 0x01]),
    Uint8Array.from([0x21, 0x58, 0x20]),
    x,
    Uint8Array.from([0x22, 0x58, 0x20]),
    y,
  ]);
}
