/**
 * WebAuthn on-chain signature wire format.
 *
 * Encodes a structured `WebAuthnAssertion` (produced by the ceremony in
 * `@agenticprimitives/connect-auth/passkey`) into the byte layout
 * `AgentAccount._validateSig` dispatches on:
 *
 *   0x01 || abi.encode(Assertion)
 *
 * where `Assertion` matches `WebAuthnLib.Assertion` in the Solidity
 * source (see apps/contracts/src/libraries/WebAuthnLib.sol).
 *
 * Doctrine: this is the agent-account substrate's signature dispatch.
 * The auth-method ceremony (DER parsing, COSE attestation, challenge
 * encoding) lives in identity-auth. agent-account ships only the
 * on-chain wire-format encoder.
 */

import { encodeAbiParameters, concat } from 'viem';
import type { WebAuthnAssertion } from '@agenticprimitives/connect-auth/passkey';

/** First byte of the on-chain WebAuthn signature blob — matches
 *  `SIG_TYPE_WEBAUTHN = 0x01` in AgentAccount.sol. */
export const SIG_TYPE_WEBAUTHN: `0x${string}` = '0x01';

/** ABI-encode the assertion struct (without the leading type byte). */
export function encodeAssertion(a: WebAuthnAssertion): `0x${string}` {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'authenticatorData', type: 'bytes' },
          { name: 'clientDataJSON', type: 'string' },
          { name: 'challengeIndex', type: 'uint256' },
          { name: 'typeIndex', type: 'uint256' },
          { name: 'r', type: 'uint256' },
          { name: 's', type: 'uint256' },
          { name: 'credentialIdDigest', type: 'bytes32' },
        ],
      },
    ],
    [a],
  );
}

/**
 * Encode the assertion as a complete UserOp / ERC-1271 signature blob:
 *
 *   0x01 || abi.encode(Assertion)
 *
 * This is what `AgentAccount._validateSig` reads — the leading byte
 * selects `SIG_TYPE_WEBAUTHN` and the remainder is the ABI-encoded
 * `WebAuthnLib.Assertion` struct.
 */
export function encodeWebAuthnSignature(a: WebAuthnAssertion): `0x${string}` {
  return concat([SIG_TYPE_WEBAUTHN, encodeAssertion(a)]);
}
