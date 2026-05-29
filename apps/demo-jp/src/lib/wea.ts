// JP's local copy of the WEA Statement of Faith. Public bytes, identical to what the
// member's Impact home holds at /wea-sign. Two purposes:
//
//   1. Render the WEA modal in the JP UI (read-only preview).
//   2. Recompute the canonical hash so JP can VERIFY an attestation returned from
//      Impact — if `recomputed === attestation.docHash`, JP knows the same document
//      bytes were signed. (The attestation itself is what JP stores + projects.)
//
// Any drift between this text and Impact's `wea-doc.ts` text breaks verification, so
// keep them in lockstep. The 7 affirmations are the public WEA Statement.

import type { Hex } from '@agenticprimitives/types';

export const WEA_DOC_ID = 'wea-statement-of-faith-v1';

export const WEA_AFFIRMATIONS = [
  'The Holy Scriptures as originally given by God, divinely inspired, infallible, entirely trustworthy; and the supreme authority in all matters of faith and conduct.',
  'One God, eternally existent in three persons, Father, Son and Holy Spirit.',
  'Our Lord Jesus Christ, God manifest in the flesh, His virgin birth, His sinless human life, His divine miracles, His vicarious and atoning death, His bodily resurrection, His ascension, His mediatorial work, and His personal return in power and glory.',
  'The Salvation of lost and sinful man through the shed blood of the Lord Jesus Christ by faith apart from works, and regeneration by the Holy Spirit.',
  'The Holy Spirit by whose indwelling the believer is enabled to live a holy life, to witness and work for the Lord Jesus Christ.',
  'The Unity of the Spirit of all true believers, the Church, the Body of Christ.',
  'The Resurrection of both the saved and the lost; they that are saved unto the resurrection of life, they that are lost unto the resurrection of damnation.',
] as const;

/** Canonical bytes — MUST match `apps/demo-sso-next/src/wea-doc.ts` byte-for-byte. */
export const WEA_TEXT = [
  'World Evangelical Alliance Statement of Faith',
  '',
  'We believe in:',
  '',
  ...WEA_AFFIRMATIONS.map((a, i) => `${i + 1}. ${a}`),
].join('\n') + '\n';

let _weaHash: Hex | null = null;
export async function weaDocHash(): Promise<Hex> {
  if (_weaHash) return _weaHash;
  const bytes = new TextEncoder().encode(WEA_TEXT);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '0x';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  _weaHash = hex as Hex;
  return _weaHash;
}

/** Verify that an attestation's docHash matches our canonical bytes. Returns true iff
 *  the same document was signed. (signature semantics are demo-grade; production = EIP-712.) */
export async function verifyWeaHash(docHash: string): Promise<boolean> {
  return (await weaDocHash()).toLowerCase() === docHash.toLowerCase();
}
