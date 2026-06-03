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

import type { Address } from '@agenticprimitives/types';
import type { DelegationWire } from './delegation';
import type { AdopterType, AdoptionDeclaration, FacilitatorCapacity, FacilitatorCoverage } from './vault';
import {
  loadImpactProfile,
  loadJpAdopterRecord,
  loadJpFacilitatorRecord,
  loadMemberGrants,
} from './vault';

/** What an adopter sees about a facilitator JP introduced them to. Deliberately
 *  small — fields that go beyond this (e.g. raw email) need a stronger scope. */
export interface MatchedFacilitator {
  /** True iff this match is the viewer's OWN facilitator persona (same SA address
   *  also has a JpFacilitatorRecord). Used to render a small "(you)" hint so the
   *  demo doesn't look like a coincidence. */
  isSelf?: boolean;
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
  /** Full last name — released only on a contact-exchange upgrade. */
  exchangeLastName?: string;
  /** Released only on a contact-exchange upgrade (both sides consented). */
  exchangeEmail?: string;
  exchangePhone?: string;
}

/** What a facilitator sees about an adopter JP matched to them. Same pattern. */
export interface MatchedAdopter {
  /** True iff this is the viewer's OWN adopter persona. */
  isSelf?: boolean;
  id: string;
  firstName: string;
  lastInitial: string;
  country: string;
  adopterType: AdopterType;
  peopleGroupId: string;
  declaredAt: number;
  hasContact: boolean;
  /** Released only on a contact-exchange upgrade (both sides consented). */
  exchangeLastName?: string;
  exchangeEmail?: string;
  exchangePhone?: string;
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
    exchangeLastName: 'Mendez',
    exchangeEmail: 'daniel.m@frontier-path-network.example',
    exchangePhone: '+1 555 0101',
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
    exchangeLastName: 'Chen',
    exchangeEmail: 'mei.c@east-asia-bridges.example',
    exchangePhone: '+852 5555 0102',
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
    exchangeLastName: 'Otieno',
    exchangeEmail: 'joseph.o@horn-mission-hub.example',
    exchangePhone: '+254 700 0103',
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
    exchangeLastName: 'Ravichandran',
    exchangeEmail: 'priya.r@indian-ocean-catalyst.example',
    exchangePhone: '+65 8888 0104',
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
    exchangeLastName: 'Aldridge',
    exchangeEmail: 'rebecca.a@global-prayer-network.example',
    exchangePhone: '+44 20 7946 0105',
  },
];

export const SEED_ADOPTERS: MatchedAdopter[] = [
  { id: 'adp-sarah-k',       firstName: 'Sarah',  lastInitial: 'K.', country: 'United States',  adopterType: 'family',       peopleGroupId: 'fpg-najdi-sa',     declaredAt: daysAgo(12), hasContact: true, exchangeLastName: 'Kim',          exchangeEmail: 'sarah.k@example.com',           exchangePhone: '+1 555 0201' },
  { id: 'adp-fbs',           firstName: 'First',  lastInitial: 'B.', country: 'United States',  adopterType: 'church',       peopleGroupId: 'fpg-pashtun-af',   declaredAt: daysAgo(40), hasContact: true, exchangeLastName: 'Baptist',      exchangeEmail: 'pastor@first-baptist-springfield.example', exchangePhone: '+1 555 0202' },
  { id: 'adp-john-c',        firstName: 'John',   lastInitial: 'C.', country: 'Canada',         adopterType: 'individual',   peopleGroupId: 'fpg-uyghur-cn',    declaredAt: daysAgo(5),  hasContact: true, exchangeLastName: 'Chen',         exchangeEmail: 'john.c@example.com',            exchangePhone: '+1 416 555 0203' },
  { id: 'adp-living-hope',   firstName: 'Living', lastInitial: 'H.', country: 'United States',  adopterType: 'network',      peopleGroupId: 'fpg-tibetan-cn',   declaredAt: daysAgo(91), hasContact: true, exchangeLastName: 'Hope Network', exchangeEmail: 'connect@living-hope-network.example',     exchangePhone: '+1 555 0204' },
  { id: 'adp-maria-l',       firstName: 'Maria',  lastInitial: 'L.', country: 'Spain',          adopterType: 'family',       peopleGroupId: 'fpg-wolof-sn',     declaredAt: daysAgo(33), hasContact: true, exchangeLastName: 'Lopez',        exchangeEmail: 'maria.l@example.com',           exchangePhone: '+34 600 555 205' },
  { id: 'adp-aviva-r',       firstName: 'Aviva',  lastInitial: 'R.', country: 'United Kingdom', adopterType: 'individual',   peopleGroupId: 'fpg-somali-so',    declaredAt: daysAgo(8),  hasContact: true, exchangeLastName: 'Rodriguez',    exchangeEmail: 'aviva.r@example.com',           exchangePhone: '+44 7700 0206' },
  { id: 'adp-anderson',      firstName: 'Mark',   lastInitial: 'A.', country: 'Australia',      adopterType: 'family',       peopleGroupId: 'fpg-kabyle-dz',    declaredAt: daysAgo(60), hasContact: true, exchangeLastName: 'Anderson',     exchangeEmail: 'mark.a@example.com',            exchangePhone: '+61 4 5555 0207' },
  { id: 'adp-grace-grp',     firstName: 'Grace',  lastInitial: 'C.', country: 'United States',  adopterType: 'group',        peopleGroupId: 'fpg-sindhi-pk',    declaredAt: daysAgo(21), hasContact: true, exchangeLastName: 'Community',    exchangeEmail: 'leaders@grace-community-group.example',     exchangePhone: '+1 555 0208' },
  { id: 'adp-wei-l',         firstName: 'Wei',    lastInitial: 'L.', country: 'Singapore',      adopterType: 'individual',   peopleGroupId: 'fpg-hui-cn',       declaredAt: daysAgo(75), hasContact: true, exchangeLastName: 'Lin',          exchangeEmail: 'wei.l@example.com',             exchangePhone: '+65 9000 0209' },
  { id: 'adp-coastal',       firstName: 'Coastal', lastInitial: 'M.', country: 'India',          adopterType: 'church',      peopleGroupId: 'fpg-maldivian-mv', declaredAt: daysAgo(2),  hasContact: true, exchangeLastName: 'Mission Church', exchangeEmail: 'pastor@coastal-mission-church.example',  exchangePhone: '+91 99 555 0210' },
];

function daysAgo(d: number): number {
  return Math.floor(Date.now() / 1000) - d * 86_400;
}

// ── Match functions ──────────────────────────────────────────────────────────
// Intersect on (a) FPG (b) adopter type (c) — implicitly — facilitator capacity.
// The match is symmetric: facilitator must serve the adopter's FPG AND host the
// adopter's type.

/** Match facilitators for an adopter. Includes both the seeded counter-party pool
 *  AND, if `viewerAddress` is provided, the viewer's OWN facilitator persona (read
 *  from `JpFacilitatorRecord` + `ImpactProfile` at that address) — important when
 *  the same person uses one browser to onboard as both adopter and facilitator,
 *  so the demo doesn't silently drop their own persona out of the match pool. */
export async function matchFacilitatorsForAdopter(
  adoption: AdoptionDeclaration,
  adopterType: AdopterType,
  viewerAddress?: Address,
): Promise<MatchedFacilitator[]> {
  const seeded = SEED_FACILITATORS.filter((f) =>
    f.peopleGroupIds.includes(adoption.peopleGroupId)
    && f.capacity.adopterTypes.includes(adopterType),
  );
  // Local-broker pool: every JpFacilitatorRecord this browser knows about.
  // Without this, a facilitator created in one persona (SA `F`) is invisible
  // to an adopter in another persona (SA `A`) — even though the user just
  // declared the coverage in the same browser. JP-the-broker is what
  // surfaces this in production; localStorage scan is its demo substitute.
  const seenIds = new Set<string>();
  const local: MatchedFacilitator[] = [];
  for (const { addr, grant } of await loadMemberGrants()) {
    const projected = await ownFacilitatorAsMatched(grant);
    if (!projected) continue;
    if (!projected.peopleGroupIds.includes(adoption.peopleGroupId)) continue;
    if (!projected.capacity.adopterTypes.includes(adopterType)) continue;
    // Stamp isSelf only when this address IS the viewer; for other addresses
    // (other personas in the same browser), surface as a normal match.
    const isSelf = viewerAddress ? addr.toLowerCase() === viewerAddress.toLowerCase() : false;
    const id = isSelf ? projected.id : `fac-local-${addr.toLowerCase()}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    local.push({ ...projected, isSelf, id });
  }
  // Surface viewer's own persona first (UX hint), then other local
  // facilitators, then the seeded pool.
  local.sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : 0));
  return [...local, ...seeded];
}

export async function matchAdoptersForFacilitator(
  coverage: FacilitatorCoverage,
  viewerAddress?: Address,
): Promise<MatchedAdopter[]> {
  const seeded = SEED_ADOPTERS.filter((a) =>
    coverage.peopleGroupIds.includes(a.peopleGroupId)
    && coverage.capacity.adopterTypes.includes(a.adopterType),
  );
  // Local-broker pool: every JpAdopterRecord this browser knows about. Same
  // rationale as the facilitator side — an adopter declared in one persona
  // should surface to a facilitator viewing in another persona, otherwise the
  // demo silently drops the user's own counter-party.
  const seenIds = new Set<string>();
  const local: MatchedAdopter[] = [];
  for (const { addr, grant } of await loadMemberGrants()) {
    const projected = await ownAdopterAsMatched(grant);
    if (!projected) continue;
    if (!coverage.peopleGroupIds.includes(projected.peopleGroupId)) continue;
    if (!coverage.capacity.adopterTypes.includes(projected.adopterType)) continue;
    const isSelf = viewerAddress ? addr.toLowerCase() === viewerAddress.toLowerCase() : false;
    const id = isSelf ? projected.id : `adp-local-${addr.toLowerCase()}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    local.push({ ...projected, isSelf, id });
  }
  local.sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : 0));
  return [...local, ...seeded];
}

/** SEC-022 invariant: self-persona ids are derived ONLY from the lowercased SA
 *  address; two distinct canonical agents (i.e. two distinct addresses) MUST never
 *  collide on the same id. Production must keep facilitator and adopter SAs as
 *  separate canonical agents (different salts) — this function holds the line in
 *  code so a refactor that changes the id-derivation breaks loudly. */
function selfFacilitatorId(addr: Address): string {
  const lower = addr.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    throw new Error(`selfFacilitatorId: address "${addr}" is not a canonical 20-byte hex (SEC-022)`);
  }
  return `fac-self-${lower}`;
}
function selfAdopterId(addr: Address): string {
  const lower = addr.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(lower)) {
    throw new Error(`selfAdopterId: address "${addr}" is not a canonical 20-byte hex (SEC-022)`);
  }
  return `adp-self-${lower}`;
}

/** Build a `MatchedFacilitator` projection from the viewer's own facilitator
 *  record + Impact profile. Returns null when they aren't (yet) a facilitator. */
async function ownFacilitatorAsMatched(grant: DelegationWire): Promise<MatchedFacilitator | null> {
  const addr = grant.delegator;
  const record = await loadJpFacilitatorRecord(grant);
  if (!record.coverage) return null;
  const impact = await loadImpactProfile(grant);
  const c = impact.contact ?? {};
  const orgName = c.organizationName?.trim();
  const orgCountry = c.organizationCountry?.trim();
  if (!orgName) return null; // can't render an organization card without an org name
  const firstName = c.firstName?.trim() ?? '—';
  const lastInitial = (c.lastName ?? '').trim().charAt(0).toUpperCase();
  return {
    isSelf: true,
    id: selfFacilitatorId(addr),
    orgName,
    orgCountry: orgCountry ?? '—',
    facilitatorFirstName: firstName,
    facilitatorLastInitial: lastInitial ? `${lastInitial}.` : '',
    peopleGroupIds: record.coverage.peopleGroupIds,
    capacity: record.coverage.capacity,
    description: record.coverage.description,
    hasContact: !!c.email,
    exchangeLastName: c.lastName?.trim() || undefined,
    exchangeEmail: c.email?.trim() || undefined,
    exchangePhone: c.phone?.trim() || undefined,
  };
}

/** Build a `MatchedAdopter` projection from the viewer's own adopter record +
 *  Impact profile. Returns null when they don't (yet) have a declared adoption. */
async function ownAdopterAsMatched(grant: DelegationWire): Promise<MatchedAdopter | null> {
  const addr = grant.delegator;
  const record = await loadJpAdopterRecord(grant);
  if (!record.adoption || !record.adopterType) return null;
  const impact = await loadImpactProfile(grant);
  const c = impact.contact ?? {};
  const firstName = c.firstName?.trim() ?? '—';
  const lastInitial = (c.lastName ?? '').trim().charAt(0).toUpperCase();
  return {
    isSelf: true,
    id: selfAdopterId(addr),
    firstName,
    lastInitial: lastInitial ? `${lastInitial}.` : '',
    country: c.country?.trim() ?? '—',
    adopterType: record.adopterType,
    peopleGroupId: record.adoption.peopleGroupId,
    declaredAt: record.adoption.declaredAt,
    hasContact: !!c.email,
    exchangeLastName: c.lastName?.trim() || undefined,
    exchangeEmail: c.email?.trim() || undefined,
    exchangePhone: c.phone?.trim() || undefined,
  };
}

// ── Quarterly updates ────────────────────────────────────────────────────────
// Facilitators publish short updates tagged to a people group; matched adopters
// see them on their dashboard scoped to the introduction's delegation. For the
// demo we seed 1–2 plausible updates per (facilitator × FPG) so adopters always
// have something to read. A facilitator's own published updates live in their
// `JpFacilitatorRecord.publishedUpdates[]` (visible on their dashboard); in
// production these flow to matched adopters via JP.

export interface MatchedFacilitatorUpdate {
  id: string;
  facilitatorId: string;
  peopleGroupId: string;
  publishedAt: number;
  title: string;
  body: string;
}

export const SEED_FACILITATOR_UPDATES: MatchedFacilitatorUpdate[] = [
  {
    id: 'upd-frontier-najdi-1', facilitatorId: 'fac-frontier-path', peopleGroupId: 'fpg-najdi-sa', publishedAt: daysAgo(6),
    title: 'Najdi prayer focus — month 4',
    body: 'Quiet but real movement among a few extended families this month. Pray for the teachers we partnered with last fall — three are still hosting weekly conversations in their homes. Specific prayer: open doors for the literature partners we hope to bring through in early summer.',
  },
  {
    id: 'upd-frontier-pashtun-1', facilitatorId: 'fac-frontier-path', peopleGroupId: 'fpg-pashtun-af', publishedAt: daysAgo(18),
    title: 'Southern Pashtun — quarterly note',
    body: 'A long quiet, then sudden openness in two villages this quarter. Pray for safety + clarity for the local partners who are walking with new seekers. Travel restrictions remain heavy; we are leaning into prayer + the long view.',
  },
  {
    id: 'upd-east-asia-uyghur-1', facilitatorId: 'fac-east-asia-bridges', peopleGroupId: 'fpg-uyghur-cn', publishedAt: daysAgo(11),
    title: 'Uyghur prayer note',
    body: 'Pressure remains high but our diaspora partners report sustained interest in conversations across three cities. Pray for protection + for the small groups of believers worshipping quietly. We will send a more detailed update via the prayer channel.',
  },
  {
    id: 'upd-east-asia-tibetan-1', facilitatorId: 'fac-east-asia-bridges', peopleGroupId: 'fpg-tibetan-cn', publishedAt: daysAgo(27),
    title: 'Tibetan plateau — winter brief',
    body: 'Winter is the quiet season for in-person work; our focus has shifted to translation review with a small team in-region. Pray for our translation partners + for the families they are walking with through grief this year.',
  },
  {
    id: 'upd-horn-somali-1', facilitatorId: 'fac-horn-mission', peopleGroupId: 'fpg-somali-so', publishedAt: daysAgo(9),
    title: 'Somali update — Q2 prayer + project briefing',
    body: 'Maternal-health pilot in two coastal villages is moving from pilot to ongoing. Pray for the nurses we trained last year + for the partner church that has begun hosting prayer for the village leaders.',
  },
  {
    id: 'upd-horn-wolof-1', facilitatorId: 'fac-horn-mission', peopleGroupId: 'fpg-wolof-sn', publishedAt: daysAgo(35),
    title: 'Wolof regional note',
    body: 'A small but consistent rhythm of weekly gatherings in two cities now. Our community-development teams in three villages have begun joint prayer with the Bible-translation partners — a long-awaited integration. Pray for unity + for fruit.',
  },
  {
    id: 'upd-indian-sindhi-1', facilitatorId: 'fac-indian-ocean', peopleGroupId: 'fpg-sindhi-pk', publishedAt: daysAgo(14),
    title: 'Sindhi monthly prayer note',
    body: 'Our small team had to scale back travel this month, but local partners are stepping up. Pray for two new young leaders in the southern region we have been quietly walking with for almost three years.',
  },
  {
    id: 'upd-indian-maldivian-1', facilitatorId: 'fac-indian-ocean', peopleGroupId: 'fpg-maldivian-mv', publishedAt: daysAgo(45),
    title: 'Maldivian update — quarterly',
    body: 'A heavy quiet this quarter — pray for patience + for the four families we have been corresponding with through diaspora channels. Specific prayer for safety + for clear direction over the coming months.',
  },
  {
    id: 'upd-global-najdi-1', facilitatorId: 'fac-global-prayer', peopleGroupId: 'fpg-najdi-sa', publishedAt: daysAgo(4),
    title: 'Global Prayer Network — weekly Najdi focus',
    body: 'Three things this week: (1) Pray for the small group of seekers we heard about last month, (2) Pray for safe travel for two short-term workers crossing in early next week, (3) Pray for the field partners who are weary.',
  },
  {
    id: 'upd-global-tibetan-1', facilitatorId: 'fac-global-prayer', peopleGroupId: 'fpg-tibetan-cn', publishedAt: daysAgo(13),
    title: 'Tibetan focus — weekly',
    body: 'Coordinated prayer on Saturday for the language partners working through tonal challenges in two regions. Pray for clarity + endurance + for the local conversation circles that have been meeting weekly all winter.',
  },
];

/** Updates a matched adopter should see — filtered to the facilitator they're
 *  matched with AND the FPG they declared. Sorted most-recent-first.
 *
 *  Same-browser dual-persona case: when `viewerAddress` is the address whose
 *  `JpFacilitatorRecord` produced the synthesized self-persona match (`fac-self-<addr>`),
 *  we ALSO pull the viewer's own `publishedUpdates[]` from that record and merge them
 *  in. Without this, an adopter who is also a facilitator (same browser, same SA)
 *  would never see their own published updates on their adopter dashboard — even
 *  though the facilitator+adopter records sit in the same localStorage. */
export async function updatesForAdopter(
  facilitatorId: string,
  peopleGroupId: string,
  viewerGrant?: DelegationWire,
): Promise<MatchedFacilitatorUpdate[]> {
  const seeded = SEED_FACILITATOR_UPDATES
    .filter((u) => u.facilitatorId === facilitatorId && u.peopleGroupId === peopleGroupId);

  // Self-persona: if the matched facilitator is the viewer's own persona, fold in
  // their record's published updates (read through the viewer's own grant) filtered
  // to the same FPG. SEC-022: derive via the central helper so the invariant holds.
  const viewerAddress = viewerGrant?.delegator;
  const selfPersonaId = viewerAddress ? selfFacilitatorId(viewerAddress) : null;
  const own: MatchedFacilitatorUpdate[] = [];
  if (selfPersonaId === facilitatorId && viewerGrant) {
    const record = await loadJpFacilitatorRecord(viewerGrant);
    for (const u of record.publishedUpdates ?? []) {
      if (u.peopleGroupId !== peopleGroupId) continue;
      own.push({
        id: u.id,
        facilitatorId,
        peopleGroupId: u.peopleGroupId,
        publishedAt: u.publishedAt,
        title: u.title,
        body: u.body,
      });
    }
  }

  return [...own, ...seeded].sort((a, b) => b.publishedAt - a.publishedAt);
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
    'Quarterly updates tagged to your declared people group',
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
