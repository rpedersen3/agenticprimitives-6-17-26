// createKmsViemAccount — wrap a KmsAccountBackend as a viem LocalAccount
// so it can be plugged into viem's writeContract / sendTransaction / etc.
// anywhere a privateKeyToAccount(...) account would go.
//
// Why a separate file from src/account.ts (createKmsAccount):
//   - createKmsAccount produces an connect-auth `Signer` shape
//     (signMessage / signTypedData only) for the identity layer.
//   - createKmsViemAccount produces a viem `LocalAccount` (adds
//     signTransaction) for the wallet/broadcast layer.
//   - Different consumers, different layers — separating them keeps
//     each surface minimal.
//
// Signing flow (all routes funnel into backend.signA2AAction):
//   - signMessage:     EIP-191 hash via viem.hashMessage → 32-byte digest → KMS sign
//   - signTransaction: viem.serializeTransaction (unsigned) → keccak256 → KMS sign,
//                      then viem.serializeTransaction with the signature
//   - signTypedData:   viem.hashTypedData → 32-byte digest → KMS sign
//
// The private key never leaves Cloud KMS / AWS KMS / etc. — the HSM signs
// the digest; viem assembles the signed RLP / serialized signature locally.

import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  serializeSignature,
  bytesToHex,
  hexToBytes,
  type Hex,
  type LocalAccount,
  type SignableMessage,
} from 'viem';
import type { KmsAccountBackend } from './types';

interface ParsedSignature {
  r: Hex;
  s: Hex;
  v: number;
  yParity: 0 | 1;
}

async function signDigestViaBackend(
  backend: KmsAccountBackend,
  digest: Hex,
): Promise<ParsedSignature> {
  const { signature } = await backend.signA2AAction({ digest: hexToBytes(digest) });
  if (signature.length !== 65) {
    throw new Error(`KMS signer returned ${signature.length}-byte signature; expected 65 (r||s||v)`);
  }
  const r = bytesToHex(signature.slice(0, 32)) as Hex;
  const s = bytesToHex(signature.slice(32, 64)) as Hex;
  const vByte = signature[64]!;
  if (vByte !== 27 && vByte !== 28) {
    throw new Error(`KMS signer returned non-canonical v=${vByte}; expected 27 or 28`);
  }
  return { r, s, v: vByte, yParity: (vByte - 27) as 0 | 1 };
}

export async function createKmsViemAccount(backend: KmsAccountBackend): Promise<LocalAccount> {
  const address = await backend.getSignerAddress();

  return {
    address,
    type: 'local',
    source: 'kms',
    // publicKey is optional on LocalAccount; we'd need the uncompressed
    // secp256k1 point to populate it. Skipping — viem only needs it for
    // a few utility paths that don't apply to our use case.
    publicKey: '0x' as Hex,

    async signMessage({ message }: { message: SignableMessage }) {
      const digest = hashMessage(message);
      const { r, s, v } = await signDigestViaBackend(backend, digest);
      return serializeSignature({ r, s, v: BigInt(v) });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTransaction(transaction: any, options?: any): Promise<Hex> {
      // Match viem's privateKeyToAccount pattern: serialize unsigned →
      // keccak256 → sign → re-serialize with signature. viem dispatches
      // legacy/EIP-1559/EIP-4844 internally based on transaction shape.
      const serializer = options?.serializer ?? serializeTransaction;
      const unsigned = serializer(transaction);
      const digest = keccak256(unsigned);
      const { r, s, v, yParity } = await signDigestViaBackend(backend, digest);
      // Pass both v (legacy) and yParity (EIP-1559+).
      return serializer(transaction, { r, s, v: BigInt(v), yParity });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async signTypedData(args: any): Promise<Hex> {
      // viem's TypedDataDefinition is heavily generic; we accept whatever
      // viem's hashTypedData accepts and forward it verbatim.
      const digest = hashTypedData(args);
      const { r, s, v } = await signDigestViaBackend(backend, digest);
      return serializeSignature({ r, s, v: BigInt(v) });
    },
  } satisfies LocalAccount;
}
