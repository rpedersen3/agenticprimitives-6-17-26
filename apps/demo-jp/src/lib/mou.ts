// The ADOPT Memorandum of Understanding — the shared commitment between an adopter and
// the program. The text is a faithful summary of what the JP ADOPT brochure describes;
// "JP" is a placeholder for the demo (no affiliation — see the demo banner). The hash of
// the canonical text is what JP receives as the attestation; the text itself lives in the
// member's vault (spec 236 P2 — generic doc-attestation engine).

import type { Hex } from '@agenticprimitives/types';

export const MOU_DOC_ID = 'jp-adopt-mou-v1';

/** Canonical MOU text. Joined newlines + a trailing \n form the bytes hashed below. Any
 *  change here changes the hash → previously-signed attestations stay anchored to the
 *  OLD doc (verifiable, but you'd resign for the new one). */
export const MOU_TEXT = [
  'ADOPT Memorandum of Understanding (demo)',
  '',
  'By adopting a Frontier People Group through the JP ADOPT program, I commit to:',
  '',
  '1. Pray consistently and strategically for the people group I adopt — that they would',
  '   come to know the love and salvation of Jesus Christ, and that a thriving community',
  '   of believers would take root among them.',
  '',
  '2. Stay informed about their world — their beliefs, language, lives, and circumstances —',
  '   so that my prayer and any action I take are grounded in understanding, not assumption.',
  '',
  '3. Engage for the long term. Adoption is not a moment but a sustained commitment until',
  '   the people group has a thriving indigenous community of believers.',
  '',
  '4. Engage in partnership with others — facilitators already serving on the field,',
  '   prayer partners adopting the same group, and the broader missional community —',
  '   rather than acting alone.',
  '',
  '5. Receive periodic updates from the program and from facilitators serving the people',
  '   group, and where appropriate share my own engagement and reflections.',
  '',
  '6. Acknowledge that the program does not collect payment for adoption. The commitment',
  '   is prayer, persistence, and partnership.',
  '',
  'This memorandum is held in my Impact Community vault. JP receives only the attestation',
  'that I signed it — a hash of this document, bound to my active permission for JP.',
].join('\n') + '\n';

/** SHA-256 hex of MOU_TEXT (Web Crypto, browser-native). Computed once and memoized. */
let _mouHash: Hex | null = null;
export async function mouDocHash(): Promise<Hex> {
  if (_mouHash) return _mouHash;
  const bytes = new TextEncoder().encode(MOU_TEXT);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  _mouHash = bytesToHex(new Uint8Array(digest));
  return _mouHash;
}

/** Build a consent-bound attestation: docHash + the hash of the active JP delegation.
 *  Revoking the delegation (at the member's Impact home) voids the consent the
 *  attestation rode in on — JP no longer has standing to use it. Demonstrates ADR-0019:
 *  authority IS the scoped delegation, attestations ride on it.
 *
 *  In the production engine (spec 236 P2) this becomes an EIP-712 signature over a typed
 *  domain (`{docHash, consentBoundTo, signedAt}`) by the member's home credential. For
 *  the demo prototype we record the deterministic projection so the receipt + revocation
 *  story is real even while the signature ceremony itself is stubbed. */
export async function attestDocConsentBound(opts: {
  docId: string;
  docText: string;
  delegationJson: unknown;
}): Promise<{ docHash: Hex; docId: string; signedAt: number; consentBoundTo: Hex }> {
  const docHash = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.docText))));
  const consentBoundTo = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(opts.delegationJson))),
    ),
  );
  return { docHash, docId: opts.docId, signedAt: Math.floor(Date.now() / 1000), consentBoundTo };
}

function bytesToHex(b: Uint8Array): Hex {
  let s = '0x';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s as Hex;
}
