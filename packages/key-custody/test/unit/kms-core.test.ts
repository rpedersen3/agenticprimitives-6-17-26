// spec 276 KCS-D1 — the consumer-safe KMS core. Two guarantees:
//   1. The core (and everything it imports) is peer-dependency-free: ONLY
//      @noble/* + built-ins. No `viem`, no `@agenticprimitives/*`. This is the
//      whole point — an external app imports it without those peers.
//   2. The high-level `signDigestWithKms` / `gcpSignDigest` produce a valid
//      Ethereum (r,s,v) signature recoverable to the signing key's address.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  signDigestWithKms,
  addressFromSpkiPem,
  publicKeyToAddress,
  parseDerEcdsa,
  bytesToHex,
} from '../../src/kms/secp256k1-core.js';
import { gcpSignDigest, type GcpKmsTransport } from '../../src/kms/gcp-transport.js';

const KMS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'kms');

// ── helpers: build an SPKI PEM + a DER signer from a raw secp256k1 key ──
function spkiPemFor(pub65: Uint8Array): string {
  // SPKI prefix for an id-ecPublicKey on secp256k1 (1.2.840.10045.2.1 / 1.3.132.0.10),
  // followed by the 0x00 unused-bits byte + the 65-byte uncompressed point.
  const prefix = Uint8Array.from([
    0x30, 0x56, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b,
    0x81, 0x04, 0x00, 0x0a, 0x03, 0x42, 0x00,
  ]);
  const der = new Uint8Array(prefix.length + pub65.length);
  der.set(prefix, 0);
  der.set(pub65, prefix.length);
  let b64 = '';
  for (let i = 0; i < der.length; i++) b64 += String.fromCharCode(der[i]!);
  const body = btoa(b64).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

function derSign(priv: Uint8Array, digest: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(digest, priv, { prehash: false });
  return secp256k1.Signature.fromBytes(sig).toBytes('der');
}

describe('kms-core import graph (KCS-D1: peer-dependency-free)', () => {
  it('no kms/* source file imports viem or @agenticprimitives/*', () => {
    const files = readdirSync(KMS_DIR).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(KMS_DIR, f), 'utf8');
      // Match real import/export-from specifiers only.
      const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const spec = m[1]!;
        if (spec === 'viem' || spec.startsWith('viem/') || spec.startsWith('@agenticprimitives/')) {
          offenders.push(`${f} → ${spec}`);
        }
      }
    }
    expect(offenders, `kms-core must not import viem / @agenticprimitives/*:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('signDigestWithKms', () => {
  const priv = secp256k1.utils.randomSecretKey();
  const pub65 = secp256k1.getPublicKey(priv, false);
  const pem = spkiPemFor(pub65);

  it('addressFromSpkiPem matches publicKeyToAddress', () => {
    expect(addressFromSpkiPem(pem).toLowerCase()).toBe(publicKeyToAddress(pub65).toLowerCase());
  });

  it('produces a 65-byte (r,s,v) signature that recovers to the signer address', async () => {
    const digest = keccak_256(new TextEncoder().encode('verifiable content'));
    const sigHex = await signDigestWithKms({
      digest,
      publicKeyPem: pem,
      asymmetricSign: async (d) => derSign(priv, d),
    });
    expect(sigHex.startsWith('0x')).toBe(true);
    expect(sigHex.length).toBe(2 + 130); // 65 bytes
    const v = parseInt(sigHex.slice(-2), 16);
    expect([27, 28]).toContain(v);

    // Recover the pubkey from the assembled compact sig and confirm the address.
    const bytes = Uint8Array.from(sigHex.slice(2).match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const compact = bytes.slice(0, 64);
    const recovered = secp256k1.Signature.fromBytes(compact).addRecoveryBit(v - 27).recoverPublicKey(digest).toBytes(false);
    expect(bytesToHex(recovered)).toBe(bytesToHex(pub65));
  });

  it('rejects a non-32-byte digest', async () => {
    await expect(
      signDigestWithKms({ digest: new Uint8Array(31), publicKeyPem: pem, asymmetricSign: async () => new Uint8Array() }),
    ).rejects.toThrow(/32-byte digest/);
  });

  it('gcpSignDigest threads an injected transport (no network)', async () => {
    const digest = keccak_256(new TextEncoder().encode('one-shot'));
    const transport: GcpKmsTransport = {
      getPublicKeyPem: async () => pem,
      asymmetricSign: async (_k, d) => derSign(priv, d),
    };
    const sigHex = await gcpSignDigest({
      serviceAccount: { client_email: 'x', private_key: 'x' },
      cryptoKeyVersionName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
      digest,
      transport,
    });
    const der = derSign(priv, digest); // sanity: same key path parses
    expect(parseDerEcdsa(der).r).toBeGreaterThan(0n);
    expect(sigHex.length).toBe(2 + 130);
  });
});
