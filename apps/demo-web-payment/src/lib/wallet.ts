/**
 * Viem clients + a thin wallet-signer adapter.
 *
 * demo-web-payment is wallet-only (no passkey): the connected wagmi wallet is
 * the custodian of the reader's Person SA, signs the payment delegation
 * (EIP-712 → the SA's ERC-1271), and submits the on-chain redemption tx.
 */

import { createPublicClient, http, type Address, type Hex, type PublicClient } from 'viem';
import { config } from '../config';

// No `chain` here on purpose: read-only calls don't need it, and pinning an
// OP-stack chain pulls in deposit-tx formatters that collide with the bare
// `PublicClient` annotation across viem's nested versions.
export const publicClient: PublicClient = createPublicClient({
  transport: http(config.rpcUrl),
});

/** Minimal wallet surface this app needs (satisfied by a wagmi WalletClient). */
export interface PaymentWallet {
  account?: { address: Address };
  signTypedData(args: {
    account?: Address | { address: Address };
    domain: Record<string, unknown>;
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
  sendTransaction(args: {
    account?: Address | { address: Address };
    to: Address;
    data?: Hex;
    value?: bigint;
    chain?: unknown;
  }): Promise<Hex>;
  /** Sign the userOpHash for a gasless sponsored UserOp (EIP-191 raw). */
  signMessage(args: { account?: Address | { address: Address }; message: { raw: Hex } }): Promise<Hex>;
}

/** Native ETH balance (gas) for an address. */
export async function readEthBalance(addr: Address): Promise<bigint> {
  return publicClient.getBalance({ address: addr });
}

export interface GasSeedResult {
  ok: boolean;
  hash?: Hex;
  skipped?: boolean;
  balance?: string;
  amount?: string;
  error?: string;
  detail?: string;
}

/**
 * Ask the dev gas faucet to drip a little Base Sepolia ETH to `to`. Backed by
 * the deployer key in the dev-server process (see vite.config.ts) — dev only.
 */
export async function seedGas(to: Address): Promise<GasSeedResult> {
  const res = await fetch('/api/dev-gas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to }),
  });
  return (await res.json()) as GasSeedResult;
}

/**
 * Adapt a wagmi WalletClient into the `DelegationClientOpts.signer` shape.
 * `address` is the custodian EOA (= the SA's owner); `smartAccount` (the
 * delegator) is supplied separately to the DelegationClient.
 */
export function delegationSigner(wallet: PaymentWallet, address: Address) {
  return {
    address,
    signTypedData: (args: {
      domain: { name: string; version: string; chainId: number; verifyingContract: Address };
      types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> =>
      wallet.signTypedData({
        account: address,
        domain: args.domain,
        types: args.types as Record<string, readonly { name: string; type: string }[]>,
        primaryType: args.primaryType,
        message: args.message,
      }),
  };
}
