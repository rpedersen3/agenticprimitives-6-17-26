// Quorum-signature packing for the CustodyPolicy admin surface.
//
// The CustodyPolicy contract consumes Safe-compatible packed slot blobs:
// each slot is `{ r (32) || s (32) || v (1) }`, optionally followed by a
// dynamic tail for slot types that need extra bytes. Slot recovery lives
// in `libraries/SignatureSlotRecovery.sol`. Slots MUST be sorted
// ascending by signer address — the on-chain `_verifyQuorum` rejects
// out-of-order or duplicate signers.
//
// Slot types (phase 6f.4):
//   v == 27 || v == 28  → EcdsaSlot         (EOA ECDSA, no tail)
//   v == 31..34         → EcdsaSlot         (eth_sign-wrapped ECDSA, no tail)
//   v == 1              → ApprovedHashSlot  (pre-approved hash; r = signer)
//   v == 0              → ContractSigSlot   (ERC-1271; r = signer, s = tail offset)
//   v == 2              → PasskeySlot       (WebAuthn; r = PIA, s = tail offset)
//
// All callers should compose slots via the typed constructors below and
// then pass the array to `packQuorumSigs`.

import {
  concat,
  encodeAbiParameters,
  keccak256,
  padHex,
  toHex,
  type Address,
  type Hex,
} from 'viem';

export interface WebAuthnAssertion {
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeIndex: bigint;
  typeIndex: bigint;
  r: bigint;
  s: bigint;
  credentialIdDigest: Hex;
}

export type EcdsaSlot = {
  type: 'ecdsa';
  signer: Address;
  /** Raw 65-byte ECDSA sig: r (32) || s (32) || v (1). */
  signature: Hex;
};

export type ContractSigSlot = {
  type: 'contract-sig';
  /** The address whose `isValidSignature(hash, blob)` will be called. */
  signer: Address;
  /** Blob handed to the signer's `isValidSignature`. */
  signatureBlob: Hex;
};

export type ApprovedHashSlot = {
  type: 'approved-hash';
  /** Address that called `ApprovedHashRegistry.approveHash`. */
  signer: Address;
};

export type PasskeySlot = {
  type: 'passkey';
  /** Passkey-Identity-Address: keccak256(abi.encode(x, y)) cast to address. */
  pia: Address;
  /** P-256 public key. Re-derived and asserted equal to `pia` inside SignatureSlotRecovery. */
  x: bigint;
  y: bigint;
  /** H7-C.1 / CON-WEBAUTHN-001: rpIdHash binds the assertion to the RP the
   *  authenticator was registered against. Required by the on-chain decoder
   *  at `SignatureSlotRecovery.recoverFromSlot` (line 172, 4-field tuple) —
   *  prior to 2026-06-01 this was missing from the encoder, producing a
   *  3-field blob the decoder couldn't parse → empty revert. */
  rpIdHash: Hex;
  /** Decoded WebAuthn assertion produced by the browser ceremony. */
  assertion: WebAuthnAssertion;
};

export type QuorumSlot = EcdsaSlot | ContractSigSlot | ApprovedHashSlot | PasskeySlot;

function slotSigner(slot: QuorumSlot): Address {
  if (slot.type === 'passkey') return slot.pia;
  return slot.signer;
}

const ASSERTION_COMPONENTS = [
  { name: 'authenticatorData', type: 'bytes' },
  { name: 'clientDataJSON', type: 'string' },
  { name: 'challengeIndex', type: 'uint256' },
  { name: 'typeIndex', type: 'uint256' },
  { name: 'r', type: 'uint256' },
  { name: 's', type: 'uint256' },
  { name: 'credentialIdDigest', type: 'bytes32' },
] as const;

/**
 * Encode a v=2 passkey slot's tail body as `abi.encode(uint256 x,
 * uint256 y, bytes32 rpIdHash, WebAuthnLib.Assertion assertion)` — the
 * shape `SignatureSlotRecovery.recoverFromSlot` decodes (line 172-173)
 * for v=2 slots.
 *
 * H7-C.1 / CON-WEBAUTHN-001 (encoder updated 2026-06-01): the on-chain
 * decoder added `bytes32 rpIdHash` between `(x, y)` and the assertion,
 * but this off-chain encoder was left at 3 fields. `abi.decode` of a
 * 3-field blob into a 4-field tuple underflows → EMPTY revert from
 * the EntryPoint (no UserOperationRevertReason emitted). Live-debug
 * symptom (Act 3 'AddPasskey Bob on Org' with Alice signing via
 * passkey): user sees the opaque 'inner userOp reverted (no
 * UserOperationEvent…)' chain. SIWE/EOA path used v=27/28 slots
 * which don't hit this decoder — that's why it worked.
 *
 * Same drift class as PRs #91 (direct-deploy ABI) and #92
 * (AddPasskeyCredential args).
 */
export function encodePasskeyTailBody(
  x: bigint,
  y: bigint,
  rpIdHash: Hex,
  assertion: WebAuthnAssertion,
): Hex {
  return encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'tuple', components: ASSERTION_COMPONENTS },
    ],
    [x, y, rpIdHash, assertion],
  );
}

/**
 * Pack a sorted set of slots into the bytes blob CustodyPolicy expects.
 * Slot encoding follows Safe's convention; dynamic tails (v=0 + v=2)
 * are appended after the slot table.
 *
 * Layout:
 *   [slot 0 (65)] … [slot N (65)] [len0 (32)] [blob0] … [lenK (32)] [blobK]
 */
export function packQuorumSigs(slots: readonly QuorumSlot[]): Hex {
  if (slots.length === 0) {
    throw new Error('packQuorumSigs: at least one slot required');
  }
  const sorted = [...slots].sort((a, b) =>
    slotSigner(a).toLowerCase() < slotSigner(b).toLowerCase() ? -1 : 1,
  );
  for (let i = 1; i < sorted.length; i++) {
    if (slotSigner(sorted[i]!).toLowerCase() === slotSigner(sorted[i - 1]!).toLowerCase()) {
      throw new Error(`packQuorumSigs: duplicate signer ${slotSigner(sorted[i]!)}`);
    }
  }

  const slotBytesTotal = 65 * sorted.length;
  const slotFragments: Hex[] = [];
  const tailFragments: Hex[] = [];

  let runningOffset = slotBytesTotal;
  for (const slot of sorted) {
    if (slot.type === 'ecdsa') {
      if (slot.signature.length !== 2 + 65 * 2) {
        throw new Error(`packQuorumSigs: ECDSA signature must be 65 bytes`);
      }
      slotFragments.push(slot.signature);
    } else if (slot.type === 'approved-hash') {
      const r = padHex(slot.signer, { size: 32 });
      const s = padHex('0x00', { size: 32 });
      slotFragments.push(concat([r, s, '0x01' as Hex]));
    } else if (slot.type === 'contract-sig') {
      const r = padHex(slot.signer, { size: 32 });
      const s = padHex(toHex(BigInt(runningOffset)), { size: 32 });
      slotFragments.push(concat([r, s, '0x00' as Hex]));
      const blobBytes = (slot.signatureBlob.length - 2) / 2;
      tailFragments.push(
        concat([padHex(toHex(BigInt(blobBytes)), { size: 32 }), slot.signatureBlob]),
      );
      runningOffset += 32 + blobBytes;
    } else {
      const r = padHex(slot.pia, { size: 32 });
      const s = padHex(toHex(BigInt(runningOffset)), { size: 32 });
      slotFragments.push(concat([r, s, '0x02' as Hex]));
      const blob = encodePasskeyTailBody(slot.x, slot.y, slot.rpIdHash, slot.assertion);
      const blobBytes = (blob.length - 2) / 2;
      tailFragments.push(concat([padHex(toHex(BigInt(blobBytes)), { size: 32 }), blob]));
      runningOffset += 32 + blobBytes;
    }
  }

  return concat([...slotFragments, ...tailFragments]);
}

/**
 * Derive a Passkey-Identity-Address from a P-256 public key. Mirrors
 * `AgentAccount.passkeyIdentity` exactly so off-chain code can compute
 * the same address without a chain call.
 */
export function passkeyIdentity(x: bigint, y: bigint): Address {
  const packed = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [x, y],
  );
  const hash = keccak256(packed);
  return (`0x${hash.slice(-40)}`) as Address;
}
