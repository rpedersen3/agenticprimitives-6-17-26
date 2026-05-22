/**
 * Quorum-signature packing for the CustodyPolicy admin surface.
 *
 * The CustodyPolicy contract accepts Safe-compatible packed sigs:
 *   each 65-byte slot = {r, s, v} where:
 *     v == 27|28          → raw ECDSA
 *     v > 30              → eth_sign EIP-191 ECDSA
 *     v == 1              → pre-approved hash via ApprovedHashRegistry
 *     v == 0              → ERC-1271 contract sig; r = signer padded,
 *                           s = byte offset to dynamic tail, v = 0.
 *
 * The Treasury demo\'s admin signers are Person Smart Agents (passkey-
 * controlled AgentAccounts) signing via ERC-1271. So every slot here is
 * v=0, with a dynamic tail holding `0x01 || abi.encode(WebAuthnAssertion)`.
 *
 * Slots MUST be sorted ascending by signer address (anti-duplicate /
 * deterministic ordering); the on-chain `_verifyQuorum` rejects
 * out-of-order or duplicate signers.
 */

import { concat, padHex, toHex, type Address, type Hex } from 'viem';

/**
 * A single signer\'s contribution to a quorum sig. `signer` is the
 * AgentAccount address (whose isValidSignature(hash, blob) will be
 * called); `signatureBlob` is what gets passed into that call.
 *
 * For our Treasury demo the blob is always
 * `0x01 || abi.encode(WebAuthnAssertion)` — the 0x01-prefixed WebAuthn
 * payload AgentAccount\'s `_validateSig` dispatches on.
 */
export interface ContractSigSlot {
  signer: Address;
  signatureBlob: Hex;
}

/**
 * Pack one or more ERC-1271 contract-sig slots into the bytes blob
 * CustodyPolicy expects:
 *
 *   [slot 0 (65 bytes)][slot 1 (65 bytes)]…[len0 (32)][blob0]…[lenN (32)][blobN]
 *
 * `s` for each v=0 slot is the byte offset to its (length, blob) tail.
 * Slots are sorted ascending by signer address per Safe convention.
 */
export function packContractSigs(slots: ContractSigSlot[]): Hex {
  if (slots.length === 0) throw new Error('packContractSigs: at least one slot required');

  const sorted = [...slots].sort((a, b) =>
    a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1,
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.signer.toLowerCase() === sorted[i - 1]!.signer.toLowerCase()) {
      throw new Error(`packContractSigs: duplicate signer ${sorted[i]!.signer}`);
    }
  }

  const slotBytes = 65 * sorted.length;
  const tailOffsets: number[] = [];
  let runningOffset = slotBytes;
  for (const slot of sorted) {
    tailOffsets.push(runningOffset);
    const blobBytes = (slot.signatureBlob.length - 2) / 2; // strip 0x, hex chars/2
    runningOffset += 32 /* length prefix */ + blobBytes;
  }

  // Build the slot fragments.
  const slotsBuf: Hex[] = sorted.map((slot, i) => {
    const r = padHex(slot.signer, { size: 32 }); // signer left-padded
    const s = padHex(toHex(BigInt(tailOffsets[i]!)), { size: 32 }); // offset
    const v = '0x00' as Hex; // contract-sig
    return concat([r, s, v]);
  });

  // Build the tail fragments: (length, blob) for each slot in order.
  const tailsBuf: Hex[] = sorted.map((slot) => {
    const blobBytes = (slot.signatureBlob.length - 2) / 2;
    const lenHex = padHex(toHex(BigInt(blobBytes)), { size: 32 });
    return concat([lenHex, slot.signatureBlob]);
  });

  return concat([...slotsBuf, ...tailsBuf]);
}
