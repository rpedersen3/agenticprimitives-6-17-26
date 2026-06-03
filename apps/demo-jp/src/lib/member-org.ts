// Member organization helpers. ADR-0025 / spec 246: demo-jp does NOT store the
// person→org mapping. The org is created via the Impact org-create ceremony (the
// org SA is custodied by the user's ROOT credential; demo-jp is never a custodian),
// and the person↔org link lives as a PRIVATE credential in the person's vault at
// their Connect home. demo-jp asks Connect ("list org credentials related to me")
// via connect-client.listRelatedOrgs — it keeps no local person→org store.
//
// This module now only owns the org-name → `.impact` label helper. The org shape
// demo-jp consumes is `RelatedOrgLink` (from connect-client).

export type MemberOrgKind = 'adopter' | 'facilitator';

/** The org-create purpose tag demo-jp tags each org with (so the vault link is
 *  scoped to adopter vs facilitator). App-level vocabulary (ADR-0021). */
export const orgPurpose = (kind: MemberOrgKind): string => `jp-${kind}-org`;

/** Slugify a free-text org name into a `.impact` subregistry label: lowercase,
 *  spaces/punctuation → single hyphens, only `[a-z0-9-]`, no leading/trailing
 *  hyphen, ≤ 63 chars. The subregistry only accepts this charset — sending a raw
 *  "Calvary Bible" (space + caps) lands the member on the Impact home's
 *  "Request blocked" screen, so we derive + validate the label app-side first. */
export function toOrgLabel(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}
