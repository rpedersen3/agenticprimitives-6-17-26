// spec 276 KCS-D5 — the KMS-backed CredentialSigner adapter. A `KmsSigningBackend`
// (structurally, key-custody's `KmsAccountBackend`) becomes a `CredentialSigner`,
// so a KMS-custodied issuer SA signs W3C VC proofs without VC depending on key-custody.
import { describe, it, expect } from 'vitest';
import { bytesToHex, type Address } from 'viem';
import {
  kmsCredentialSigner,
  signCredential,
  credentialHash,
  verifyCredentialStructural,
  type KmsSigningBackend,
  type UnsignedCredential,
  VC_CONTEXT_V2,
} from '../../src/index.js';

const ISSUER_SA = '0x1111111111111111111111111111111111111111' as Address;

function fakeBackend(): { backend: KmsSigningBackend; seenDigests: Uint8Array[]; sig65: Uint8Array } {
  const seenDigests: Uint8Array[] = [];
  const sig65 = new Uint8Array(65).fill(7);
  sig65[64] = 27;
  return {
    seenDigests,
    sig65,
    backend: {
      async signA2AAction({ digest }) {
        seenDigests.push(digest);
        return { signature: sig65 };
      },
      async getSignerAddress() {
        return ISSUER_SA;
      },
    },
  };
}

describe('kmsCredentialSigner', () => {
  const unsigned: UnsignedCredential = {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'AssociationCredential'],
    issuer: `eip155:8453:${ISSUER_SA}`,
    validFrom: '2026-06-02T00:00:00Z',
    credentialSubject: { id: '0xholder', membershipClass: 'member' },
  };

  it('defaults verifyingContract to the issuer SA and signs a 32-byte digest', async () => {
    const { backend, seenDigests, sig65 } = fakeBackend();
    const signer = kmsCredentialSigner({ backend, issuerAddress: ISSUER_SA, chainId: 8453 });
    expect(signer.verifyingContract).toBe(ISSUER_SA);

    const vc = await signCredential(unsigned, signer);
    // the backend saw exactly one 32-byte digest
    expect(seenDigests).toHaveLength(1);
    expect(seenDigests[0]!.length).toBe(32);
    // proofValue is the 0x-hex of the 65-byte KMS signature
    expect(vc.proof.proofValue).toBe(bytesToHex(sig65));
    expect(vc.proof.eip712Domain.verifyingContract).toBe(ISSUER_SA);
    expect(vc.proof.eip712Domain.chainId).toBe(8453);
    // self-consistent: the stored hash equals the canonical hash of the emitted body
    expect(vc.proof.credentialHash).toBe(credentialHash(vc));
  });

  it('produces a structurally valid VC bound to the issuer SA', async () => {
    const { backend } = fakeBackend();
    const signer = kmsCredentialSigner({ backend, issuerAddress: ISSUER_SA, chainId: 8453 });
    const vc = await signCredential(unsigned, signer);
    const r = verifyCredentialStructural(vc);
    expect(r.issues).toEqual([]);
    expect(r.structural).toBe(true);
    expect(r.issuerCaip10).toBe(`eip155:8453:${ISSUER_SA}`);
  });

  it('honors an explicit verifyingContract override', () => {
    const { backend } = fakeBackend();
    const vc = '0x2222222222222222222222222222222222222222' as Address;
    const signer = kmsCredentialSigner({ backend, issuerAddress: ISSUER_SA, chainId: 8453, verifyingContract: vc });
    expect(signer.verifyingContract).toBe(vc);
  });
});
