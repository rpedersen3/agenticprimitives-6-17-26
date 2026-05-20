// PasskeySigner — viem-shaped signer backed by a WebAuthn credential.
//
// Implements just enough of viem's `LocalAccount` surface for the demo's
// existing flows to work without branching on signer type:
//   - `address` returns the passkey-derived smart-account address
//   - `sign({hash})` → 0x01-prefixed WebAuthn assertion blob (used by
//     deploy-flow.ts for userOpHash signing)
//   - `signMessage({raw|message})` → same wire format over the EIP-191
//     digest (used if any flow calls account.signMessage)
//   - `signTypedData(...)` → same wire format over the EIP-712 digest
//     (used by DelegationClient inside authorize-flow.ts)
//
// Doctrine: the on-chain wire-format encoder lives in
// `@agenticprimitives/agent-account` (webauthn-signature.ts); the
// WebAuthn ceremony itself lives in identity-auth's passkey subpath.
// This file is the demo-side glue that conforms the two into a viem-
// compatible adapter.
//
// What this does NOT do:
//   - Handle counterfactual accounts via ERC-6492. The Phase 5
//     architecture has Step 1.5 deploy the passkey-owned account on-chain
//     before Steps 2/3 run, so by the time delegation / userOp signing
//     happens, the account already has code and ERC-1271 verifies
//     directly. (For Step 1 SIWE — which IS counterfactual — the 6492
//     wrap lives in passkey-siwe-flow.ts.)

import { hashMessage, hashTypedData, type Hex as ViemHex } from 'viem';
import {
  buildWebAuthnAssertion,
  type WebAuthnAssertion,
} from '@agenticprimitives/identity-auth/passkey';
import { encodeWebAuthnSignature } from '@agenticprimitives/agent-account';
import type { Address, Hex } from '@agenticprimitives/types';
import type { DemoPasskey } from './passkey-flow';

export interface PasskeySigner {
  /** The smart-account address this signer represents.
   *  Passkey-owned accounts have no EOA owner, so the smart-account
   *  address IS the signer's identity. */
  address: Address;

  /** viem LocalAccount.sign — used by deploy-flow.ts for userOpHash. */
  sign(args: { hash: Hex }): Promise<Hex>;

  /** viem LocalAccount.signMessage — eth-signed-message-hash form. */
  signMessage(args: { message: string | { raw: Hex } }): Promise<Hex>;

  /** viem LocalAccount.signTypedData — EIP-712 hash. */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
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

function b64uDecode(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice((2 - (s.length & 3)) & 3);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Run the WebAuthn signing ceremony for a 32-byte digest and return a
 * structured assertion. The browser prompts the user to authenticate
 * (TouchID / FaceID / security key) for every call.
 */
async function passkeyAssert(
  passkey: DemoPasskey,
  digest: Hex,
): Promise<WebAuthnAssertion> {
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

/**
 * Create a viem-shaped signer backed by the user's WebAuthn passkey.
 *
 * Each signing call triggers a browser-level authentication prompt;
 * the returned bytes are an on-chain-ready `0x01 || abi.encode(Assertion)`
 * blob that `AgentAccount._validateSig` dispatches to `_verifyWebAuthn`.
 */
export function createPasskeySigner(args: {
  passkey: DemoPasskey;
  smartAccountAddress: Address;
}): PasskeySigner {
  const signDigest = async (digest: Hex): Promise<Hex> => {
    const assertion = await passkeyAssert(args.passkey, digest);
    return encodeWebAuthnSignature(assertion);
  };

  return {
    address: args.smartAccountAddress,

    async sign({ hash }) {
      return signDigest(hash);
    },

    async signMessage({ message }) {
      // viem's hashMessage applies the EIP-191 prefix; if the caller
      // passed `{raw}` we sign the raw 32-byte digest as-is.
      const digest =
        typeof message === 'object' && message !== null && 'raw' in message
          ? (message.raw as Hex)
          : (hashMessage(message as string) as ViemHex as Hex);
      return signDigest(digest);
    },

    async signTypedData(typedData) {
      // viem.hashTypedData produces the 32-byte EIP-712 digest.
      // The ESLint cast tower is because viem's types are tightly
      // parametric and the demo's runtime values are dynamic.
      const digest = hashTypedData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        domain: typedData.domain as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        types: typedData.types as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        primaryType: typedData.primaryType as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message: typedData.message as any,
      }) as ViemHex as Hex;
      return signDigest(digest);
    },
  };
}
