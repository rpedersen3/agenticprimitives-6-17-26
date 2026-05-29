// JP's broker function — adopter ↔ facilitator matching (spec 236 P4).
//
// For the demo we keep a seeded pool of plausible facilitators (every FPG in the
// seed is covered by at least one of them) + a seeded pool of plausible adopters
// across types/FPGs, so the matched experience renders with real data on either
// side without needing a shared backend. In production these come from the live
// declarations on the program.
//
// CRITICAL SSI POINT: an introduction releases a small SCOPED PROJECTION of each
// side to the other — not the full vault. `MatchedFacilitator` and `MatchedAdopter`
// are deliberately small "view" types; the `DISCLOSURE_*` constants below
// enumerate, for the UI, exactly what JP released and what it did NOT. Revoking
// the JP delegation at the member's home empties this projection — the vaults
// stay sealed.

import type { AdopterType, AdoptionDeclaration, FacilitatorCapacity, FacilitatorCoverage } from './vault';

/** What an adopter sees about a facilitator JP introduced them to. Deliberately
 *  small — fields that go beyond this (e.g. raw email) need a stronger scope. */
export interface MatchedFacilitator {
  /** Demo id (production = facilitator's canonical SA address). */
  id: string;
  /** Public — same as on the facilitator's published coverage. */
  orgName: string;
  orgCountry: string;
  /** Released so the adopter knows who they're partnering with. Last name truncated
   *  to last initial — a deliberate scope choice for "introduction" stage. */
  facilitatorFirstName: string;
  facilitatorLastInitial: string;
  /** Public coverage (the facilitator declared it public when they signed). */
  peopleGroupIds: string[];
  capacity: FacilitatorCapacity;
  /** The free-text "how we engage" — visible only to matched adopters. */
  description?: string;
  /** Presence flag — "you can be reached" without releasing the address. */
  hasContact: boolean;
}

/** What a facilitator sees about an adopter JP matched to them. Same pattern. */
export interface MatchedAdopter {
  id: string;
  firstName: string;
  lastInitial: string;
  country: string;
  adopterType: AdopterType;
  peopleGroupId: string;
  declaredAt: number;
  hasContact: boolean;
}

// ── Seed pool ────────────────────────────────────────────────────────────────
// Every FPG in `FPG_SEED` is covered by at least one facilitator below, with
// varied capacity (size bands, ministry areas, adopter types). Adopter pool
// spans multiple FPGs + types so a facilitator with any coverage gets several
// matches.

export const SEED_FACILITATORS: MatchedFacilitator[] = [
  {
    id: 'fac-frontier-path',
    orgName: 'Frontier Path Network',
    orgCountry: 'United States',
    facilitatorFirstName: 'Daniel',
    facilitatorLastInitial: 'M.',
    peopleGroupIds: ['fpg-najdi-sa', 'fpg-kabyle-dz', 'fpg-sindhi-pk', 'fpg-pashtun-af'],
    capacity: {
      adopterTypes: ['individual', 'family', 'group', 'church', 'organization', 'network'],
      sizeBands: ['small', 'medium', 'large', 'network'],
      ministryAreas: ['prayer-mobilization', 'leadership-development', 'media'],
    },
    description: 'We host quarterly prayer calls and an annual in-region trip for prayer partners who can travel. Adopters get a monthly written update and a closed prayer channel.',
    hasContact: true,
  },
  {
    id: 'fac-east-asia-bridges',
    orgName: 'East Asia Bridges',
    orgCountry: 'Hong Kong',
    facilitatorFirstName: 'Mei',
    facilitatorLastInitial: 'C.',
    peopleGroupIds: ['fpg-uyghur-cn', 'fpg-tibetan-cn', 'fpg-hui-cn'],
    capacity: {
      adopterTypes: ['individual', 'family', 'church', 'organization'],
      sizeBands: ['small', 'medium', 'large'],
      ministryAreas: ['church-planting', 'leadership-development', 'bible-translation'],
    },
    description: 'Twenty years on the field. We pair each adopter with a long-term local partner relationship and host two prayer days a year.',
    hasContact: true,
  },
  {
    id: 'fac-horn-mission',
    orgName: 'Horn Mission Hub',
    orgCountry: 'Kenya',
    facilitatorFirstName: 'Joseph',
    facilitatorLastInitial: 'O.',
    peopleGroupIds: ['fpg-somali-so', 'fpg-wolof-sn'],
    capacity: {
      adopterTypes: ['individual', 'family', 'group', 'church', 'organization', 'network'],
      sizeBands: ['small', 'medium', 'large', 'network'],
      ministryAreas: ['community-development', 'health', 'business-as-mission', 'prayer-mobilization'],
    },
    description: 'We integrate prayer + community work. Adopters can support specific health or BAM projects on the ground or stay prayer-focused.',
    hasContact: true,
  },
  {
    id: 'fac-indian-ocean',
    orgName: 'Indian Ocean Catalyst',
    orgCountry: 'Singapore',
    facilitatorFirstName: 'Priya',
    facilitatorLastInitial: 'R.',
    peopleGroupIds: ['fpg-sindhi-pk', 'fpg-maldivian-mv'],
    capacity: {
      adopterTypes: ['individual', 'family', 'church', 'organization'],
      sizeBands: ['small', 'medium'],
      ministryAreas: ['prayer-mobilization', 'church-planting', 'education', 'media'],
    },
    description: 'A small team focused on under-served South Asian coastal peoples. We prefer focused, durable prayer partnerships over large groups.',
    hasContact: true,
  },
  {
    id: 'fac-global-prayer',
    orgName: 'Global Prayer Network',
    orgCountry: 'United Kingdom',
    facilitatorFirstName: 'Rebecca',
    facilitatorLastInitial: 'A.',
    peopleGroupIds: [
      'fpg-najdi-sa', 'fpg-kabyle-dz', 'fpg-uyghur-cn', 'fpg-somali-so', 'fpg-sindhi-pk',
      'fpg-pashtun-af', 'fpg-tibetan-cn', 'fpg-wolof-sn', 'fpg-hui-cn', 'fpg-maldivian-mv',
    ],
    capacity: {
      adopterTypes: ['individual', 'family', 'group'],
      sizeBands: ['small', 'network'],
      ministryAreas: ['prayer-mobilization', 'media'],
    },
    description: 'Prayer-only network — no field operations, no money. We exist so every FPG has at least one praying community attached to it.',
    hasContact: true,
  },
];

export const SEED_ADOPTERS: MatchedAdopter[] = [
  { id: 'adp-sarah-k',       firstName: 'Sarah',  lastInitial: 'K.', country: 'United States',  adopterType: 'family',       peopleGroupId: 'fpg-najdi-sa',     declaredAt: daysAgo(12), hasContact: true },
  { id: 'adp-fbs',           firstName: 'First',  lastInitial: 'B.', country: 'United States',  adopterType: 'church',       peopleGroupId: 'fpg-pashtun-af',   declaredAt: daysAgo(40), hasContact: true },
  { id: 'adp-john-c',        firstName: 'John',   lastInitial: 'C.', country: 'Canada',         adopterType: 'individual',   peopleGroupId: 'fpg-uyghur-cn',    declaredAt: daysAgo(5),  hasContact: true },
  { id: 'adp-living-hope',   firstName: 'Living', lastInitial: 'H.', country: 'United States',  adopterType: 'network',      peopleGroupId: 'fpg-tibetan-cn',   declaredAt: daysAgo(91), hasContact: true },
  { id: 'adp-maria-l',       firstName: 'Maria',  lastInitial: 'L.', country: 'Spain',          adopterType: 'family',       peopleGroupId: 'fpg-wolof-sn',     declaredAt: daysAgo(33), hasContact: true },
  { id: 'adp-aviva-r',       firstName: 'Aviva',  lastInitial: 'R.', country: 'United Kingdom', adopterType: 'individual',   peopleGroupId: 'fpg-somali-so',    declaredAt: daysAgo(8),  hasContact: true },
  { id: 'adp-anderson',      firstName: 'Mark',   lastInitial: 'A.', country: 'Australia',      adopterType: 'family',       peopleGroupId: 'fpg-kabyle-dz',    declaredAt: daysAgo(60), hasContact: true },
  { id: 'adp-grace-grp',     firstName: 'Grace',  lastInitial: 'C.', country: 'United States',  adopterType: 'group',        peopleGroupId: 'fpg-sindhi-pk',    declaredAt: daysAgo(21), hasContact: true },
  { id: 'adp-wei-l',         firstName: 'Wei',    lastInitial: 'L.', country: 'Singapore',      adopterType: 'individual',   peopleGroupId: 'fpg-hui-cn',       declaredAt: daysAgo(75), hasContact: true },
  { id: 'adp-coastal',       firstName: 'Coastal', lastInitial: 'M.', country: 'India',          adopterType: 'church',      peopleGroupId: 'fpg-maldivian-mv', declaredAt: daysAgo(2),  hasContact: true },
];

function daysAgo(d: number): number {
  return Math.floor(Date.now() / 1000) - d * 86_400;
}

// ── Match functions ──────────────────────────────────────────────────────────
// Intersect on (a) FPG (b) adopter type (c) — implicitly — facilitator capacity.
// The match is symmetric: facilitator must serve the adopter's FPG AND host the
// adopter's type.

export function matchFacilitatorsForAdopter(
  adoption: AdoptionDeclaration,
  adopterType: AdopterType,
): MatchedFacilitator[] {
  return SEED_FACILITATORS.filter((f) =>
    f.peopleGroupIds.includes(adoption.peopleGroupId)
    && f.capacity.adopterTypes.includes(adopterType),
  );
}

export function matchAdoptersForFacilitator(coverage: FacilitatorCoverage): MatchedAdopter[] {
  return SEED_ADOPTERS.filter((a) =>
    coverage.peopleGroupIds.includes(a.peopleGroupId)
    && coverage.capacity.adopterTypes.includes(a.adopterType),
  );
}

// ── Disclosure manifests ─────────────────────────────────────────────────────
// Shown next to each match. The "released" list is what flowed to this side via
// the introduction's scoped delegation; "notReleased" is what JP held back —
// either kept entirely sealed (e.g. WEA document text) or available behind a
// stronger scope the member would have to grant (e.g. raw contact).

export const DISCLOSURE_FACILITATOR_TO_ADOPTER = {
  released: [
    'Organization name + country',
    'Facilitator first name + last initial',
    'People groups served',
    'Capacity (adopter types, size bands, ministry areas)',
    '"How we engage" description',
    'Contact channel presence (flag only — "you can be reached")',
    'WEA + MOU attestation receipts (hashes, not the documents)',
  ],
  notReleased: [
    'Facilitator full last name',
    'Email / phone (request a contact-exchange to release)',
    'Facilitator home address / city',
    'Full WEA + MOU document text (sealed at the home)',
  ],
};

export const DISCLOSURE_ADOPTER_TO_FACILITATOR = {
  released: [
    'Adopter first name + last initial',
    'Country',
    'Adopter type',
    'Declared people group',
    'When they declared',
    'Contact channel presence (flag only)',
    'MOU + (if applicable) WEA attestation receipts',
  ],
  notReleased: [
    'Adopter full last name',
    'Email / phone (request a contact-exchange to release)',
    'Adopter home address / city',
    'Other apps the adopter is connected to',
  ],
};
