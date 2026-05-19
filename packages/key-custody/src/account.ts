// createKmsAccount — viem adapter that turns a KmsAccountBackend into a
// KMSSigner conforming to identity-auth's Signer interface contract.

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, hashTypedData, type Hex, type Address } from 'viem';
import type { KmsAccountBackend } from './types';

interface KMSSignerShape {
  readonly address: Address;
  readonly keyId: string;
  readonly provider: 'local-aes' | 'aws-kms' | 'gcp-kms';
  signMessage(msg: string | { raw: Hex }): Promise<Hex>;
  signTypedData(args: {
    domain: unknown;
    types: unknown;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

function eip191Digest(message: string | Uint8Array): Uint8Array {
  const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix, 0);
  combined.set(bytes, prefix.length);
  return keccak_256(combined);
}

export async function createKmsAccount(
  backend: KmsAccountBackend,
  opts?: { sessionId?: string; chainId?: number; provider?: 'local-aes' | 'aws-kms' | 'gcp-kms' },
): Promise<KMSSignerShape> {
  const address = await backend.getSignerAddress();
  const provider = opts?.provider ?? 'local-aes';

  return {
    address,
    keyId: `${provider}:${address.toLowerCase()}`,
    provider,

    async signMessage(msg: string | { raw: Hex }): Promise<Hex> {
      let digest: Uint8Array;
      if (typeof msg === 'string') {
        digest = eip191Digest(msg);
      } else {
        // raw hex — treat as already-hashed payload signed verbatim
        digest = hexToBytes(msg.raw);
        if (digest.length !== 32) {
          // EIP-191 of raw bytes
          digest = eip191Digest(digest);
        }
      }
      const { signature } = await backend.signA2AAction({
        digest,
        auditContext: opts?.sessionId ? { sessionId: opts.sessionId } : undefined,
      });
      return bytesToHex(signature) as Hex;
    },

    async signTypedData(args): Promise<Hex> {
      // viem.hashTypedData computes the EIP-712 digest exactly the way wallets do.
      const digestHex = hashTypedData(args as Parameters<typeof hashTypedData>[0]);
      const digest = hexToBytes(digestHex);
      const { signature } = await backend.signA2AAction({
        digest,
        auditContext: opts?.sessionId ? { sessionId: opts.sessionId } : undefined,
      });
      return bytesToHex(signature) as Hex;
    },
  };
}
