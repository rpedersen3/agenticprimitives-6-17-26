// SessionWallet — narrow abstraction over the three sign operations the
// demo flows need. Lets siwe / deploy / authorize accept either the
// browser-generated mnemonic test wallet (today) or a wagmi-connected
// external wallet (phase 6a.2). Server-side is already signer-agnostic
// via UniversalSignatureValidator; this layer just unifies the browser
// caller surface.
//
// Three sign ops:
//  - signMessage  : EIP-191 message (SIWE login statement).
//  - signHash     : 32-byte digest (userOp hash for ERC-4337 deploy).
//                   Implementations may produce raw ECDSA or EIP-191-wrapped
//                   bytes — AgentAccount accepts both (see apps/contracts/
//                   src/AgentAccount.sol around line 956).
//  - signTypedData: EIP-712 (Delegation).
//
// Passkey-backed flows have their own dedicated signer (PasskeySigner)
// because the wire format is 0x01-prefixed WebAuthn assertions, not
// ECDSA. The SessionWallet interface here is for the ECDSA/EIP-191
// world.

import type { Address, Hex } from '@agenticprimitives/types';
import type { TypedDataDomain, WalletClient } from 'viem';
import type { DemoUser } from './test-user';

export type SessionWalletKind = 'test-eoa' | 'injected' | 'walletconnect';

export interface SessionWallet {
  readonly address: Address;
  readonly kind: SessionWalletKind;
  signMessage(args: { message: string }): Promise<Hex>;
  signHash(args: { hash: Hex }): Promise<Hex>;
  signTypedData(args: {
    domain: TypedDataDomain;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

/**
 * Wrap the demo's mnemonic-derived viem account as a SessionWallet.
 * Used as the default / fallback when no external wallet is connected.
 * Produces raw 65-byte ECDSA signatures (no EIP-191 prefix) for
 * signHash — AgentAccount's ECDSA path recovers these directly.
 */
export function demoUserSessionWallet(user: DemoUser): SessionWallet {
  return {
    address: user.address,
    kind: 'test-eoa',
    signMessage: async ({ message }) =>
      (await user.account.signMessage({ message })) as Hex,
    signHash: async ({ hash }) =>
      (await user.account.sign({ hash })) as Hex,
    signTypedData: async (args) =>
      (await user.account.signTypedData({
        domain: args.domain,
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
      })) as Hex,
  };
}

/**
 * Wrap a wagmi-connected viem WalletClient as a SessionWallet.
 *
 * Routes signHash through `signMessage({ raw })` so MetaMask /
 * Rainbow / Coinbase / etc. produce an EIP-191-wrapped signature.
 * AgentAccount._verifyEcdsa tries raw recovery first, then falls back
 * to EIP-191 — both formats validate (apps/contracts/src/AgentAccount.sol
 * around line 956), so userOp signing works without any contract
 * changes when the user switches between the test wallet and an
 * injected wallet.
 *
 * Connector kind is supplied by the caller (we don't introspect
 * wagmi's connector.uid here; the App-level useMemo knows whether
 * the active connector is `injected` vs `walletConnect`).
 */
export function wagmiSessionWallet(
  walletClient: WalletClient,
  address: Address,
  kind: 'injected' | 'walletconnect',
): SessionWallet {
  return {
    address,
    kind,
    signMessage: async ({ message }) =>
      (await walletClient.signMessage({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        account: address as any,
        message,
      })) as Hex,
    signHash: async ({ hash }) =>
      (await walletClient.signMessage({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        account: address as any,
        message: { raw: hash },
      })) as Hex,
    signTypedData: async (args) =>
      (await walletClient.signTypedData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        account: address as any,
        domain: args.domain,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        types: args.types as any,
        primaryType: args.primaryType,
        message: args.message,
      })) as Hex,
  };
}
