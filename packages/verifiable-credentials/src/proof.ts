/**
 * Eip712Signature2026 proof builder — signs the canonical hash of a credential
 * subject + envelope metadata with EIP-712 typed data, producing an
 * ERC-1271-verifiable signature.
 *
 * Spec 242 §4.3 + ADR-0023 §D2.
 */

import { hashTypedData, hexToBytes, bytesToHex, type Address, type Hex, type WalletClient } from 'viem';

import { canonicalHash } from './canonical.js';
import {
  EIP712_SIG_2026_CONTEXT,
  VC_CONTEXT_V2,
  VC_DOMAIN_NAME,
  VC_DOMAIN_VERSION,
  VC_EIP712_TYPES,
  type Eip712Signature2026Proof,
  type Hex32,
  type Proof,
  type UnsignedCredential,
  type VerifiableCredential,
} from './types.js';

/** A signer abstraction so callers can wire viem wallet client OR a custom signer. */
export interface CredentialSigner {
  /** Address of the SA that will be the issuer (verified via ERC-1271). */
  issuerAddress: Address;
  /** EIP-712 chain id + verifying-contract anchor for the SA. */
  chainId: number;
  /** Must match the SA's verifying contract (typically the SA itself for ERC-1271). */
  verifyingContract: Address;
  /**
   * Sign an arbitrary 32-byte digest. Implementations route through whatever
   * the SA's signing path is (passkey, EOA wrap, KMS, multi-sig, etc.).
   */
  signDigest(digest: Hex32): Promise<Hex>;
}

/**
 * Compute the canonical hash of an unsigned credential — strips `proof`,
 * applies RFC 8785 JCS canonicalisation, returns keccak256.
 */
export function credentialHash(unsigned: UnsignedCredential | VerifiableCredential): Hex32 {
  // Defensive: strip proof if a signed VC was passed in.
  const { proof: _ignored, ...withoutProof } = unsigned as VerifiableCredential;
  void _ignored;
  return canonicalHash(withoutProof);
}

/**
 * Compute the EIP-712 typed-data digest the signer signs. Cross-stack typehash
 * equality test (spec 242 §4.3) verifies this matches a Solidity verifier.
 */
export function eip712Digest(args: {
  credentialBodyHash: Hex32;
  issuer: string;
  validFrom: number;
  validUntil: number; // 0 if not set
  proofPurpose: Eip712Signature2026Proof['proofPurpose'];
  chainId: number;
  verifyingContract: Address;
}): Hex32 {
  return hashTypedData({
    domain: {
      name: VC_DOMAIN_NAME,
      version: VC_DOMAIN_VERSION,
      chainId: args.chainId,
      verifyingContract: args.verifyingContract,
    },
    types: VC_EIP712_TYPES,
    primaryType: 'VerifiableCredentialAttestation',
    message: {
      credentialHash: args.credentialBodyHash,
      issuer: args.issuer,
      validFrom: BigInt(args.validFrom),
      validUntil: BigInt(args.validUntil),
      proofPurpose: args.proofPurpose,
    },
  }) as Hex32;
}

/** Convert an ISO-8601 timestamp to a uint64-safe seconds value. */
export function isoToSeconds(iso: string | undefined): number {
  if (!iso) return 0;
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * Sign an `UnsignedCredential` and return a fully formed `VerifiableCredential`.
 */
export async function signCredential<TSubject extends Record<string, unknown>>(
  unsigned: UnsignedCredential<TSubject>,
  signer: CredentialSigner,
  opts: { proofPurpose?: Eip712Signature2026Proof['proofPurpose']; delegatingSigner?: Eip712Signature2026Proof['delegatingSigner'] } = {},
): Promise<VerifiableCredential<TSubject>> {
  const proofPurpose = opts.proofPurpose ?? 'assertionMethod';
  // Expand `@context` BEFORE hashing so the emitted `credentialHash` matches the
  // canonical hash of the emitted body. (Hashing the pre-expansion body and then
  // adding the EIP-712 context to the output produced a VC whose stored hash never
  // reconciled with its own body — structural verification would reject it.)
  const contexted = { ...unsigned, '@context': ensureContexts(unsigned['@context']) } as UnsignedCredential<TSubject>;
  const bodyHash = credentialHash(contexted);
  const digest = eip712Digest({
    credentialBodyHash: bodyHash,
    issuer: contexted.issuer,
    validFrom: isoToSeconds(contexted.validFrom),
    validUntil: isoToSeconds(contexted.validUntil),
    proofPurpose,
    chainId: signer.chainId,
    verifyingContract: signer.verifyingContract,
  });
  const proofValue = await signer.signDigest(digest);

  const proof: Eip712Signature2026Proof = {
    type: 'Eip712Signature2026',
    created: new Date().toISOString(),
    verificationMethod: `eip155:${signer.chainId}:${signer.verifyingContract}#assertion-key-1`,
    proofPurpose,
    proofValue,
    eip712Domain: {
      name: VC_DOMAIN_NAME,
      version: VC_DOMAIN_VERSION,
      chainId: signer.chainId,
      verifyingContract: signer.verifyingContract,
    },
    credentialHash: bodyHash,
    ...(opts.delegatingSigner ? { delegatingSigner: opts.delegatingSigner } : {}),
  };

  return {
    ...contexted,
    proof,
  } as VerifiableCredential<TSubject>;
}

/** Convenience: a viem `WalletClient`-backed `CredentialSigner` (EOA-only path). */
export function viemSignerFromWallet(args: {
  wallet: WalletClient;
  issuerAddress: Address;
  chainId: number;
  verifyingContract: Address;
}): CredentialSigner {
  return {
    issuerAddress: args.issuerAddress,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
    async signDigest(digest) {
      return args.wallet.request({
        method: 'eth_sign',
        params: [args.issuerAddress, digest],
      } as unknown as Parameters<WalletClient['request']>[0]) as unknown as Hex;
    },
  };
}

/**
 * Minimal structural shape of a KMS signing backend (spec 276 KCS-D5). It is
 * declared HERE — not imported from `@agenticprimitives/key-custody` — because
 * `verifiable-credentials` is a leaf in the dependency graph (no `@agenticprimitives/*`
 * imports beyond types/ontology). `key-custody`'s `KmsAccountBackend` structurally
 * satisfies this, so `kmsCredentialSigner(kmsBackend, …)` just works without the
 * cross-package edge.
 */
export interface KmsSigningBackend {
  /** Sign a 32-byte digest; returns a 65-byte secp256k1 `(r,s,v)` signature. */
  signA2AAction(input: { digest: Uint8Array }): Promise<{ signature: Uint8Array }>;
  /** The signing key's EVM address (the credential the issuer SA validates via ERC-1271). */
  getSignerAddress(): Promise<Address>;
}

/**
 * Convenience: a `CredentialSigner` backed by a KMS-custodied secp256k1 key
 * (the issuer SA's master / per-subject signer). Mirrors `viemSignerFromWallet`
 * for the KMS path. `verifyingContract` defaults to the issuer SA itself (the
 * ERC-1271 self-verification anchor).
 */
export function kmsCredentialSigner(args: {
  backend: KmsSigningBackend;
  issuerAddress: Address;
  chainId: number;
  verifyingContract?: Address;
}): CredentialSigner {
  return {
    issuerAddress: args.issuerAddress,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract ?? args.issuerAddress,
    async signDigest(digest: Hex32): Promise<Hex> {
      const { signature } = await args.backend.signA2AAction({ digest: hexToBytes(digest) });
      return bytesToHex(signature);
    },
  };
}

function ensureContexts(existing: readonly string[]): readonly string[] {
  const needed = [VC_CONTEXT_V2, EIP712_SIG_2026_CONTEXT];
  const have = new Set(existing);
  return [...existing, ...needed.filter((c) => !have.has(c))];
}

/** Re-export so callers see the Proof union from one place. */
export type { Proof };
