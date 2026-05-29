// The member's Impact Community vault — the private store JP queries via the scoped
// delegation. Conceptually split in two:
//
//   ImpactProfile  — what the member's home already holds for the whole community: name
//                    (already in the session), contact info, the WEA Statement of Faith
//                    they signed once and re-use across apps. JP never collects these —
//                    it queries and sees "✓ on file" or "missing, send them to Impact".
//
//   JpAdopterRecord — what's specific to JP's ADOPT program: their adopter type, the
//                     ADOPT MOU attestation (which IS specific to JP), and the public
//                     adoption declaration.
//
// For the prototype, both live in localStorage. The shapes mirror the future backend-MCP
// API so the upgrade is a data migration, not a refactor. The "what JP can see"
// projection (vaultProjection) is the small derived view that flows over the delegation.

import type { Address, Hex } from '@agenticprimitives/types';

export type AdopterType = 'individual' | 'family' | 'group' | 'church' | 'organization' | 'network';

export interface ContactProfile {
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
}

/** A signed attestation kept in the vault — JP only ever sees the hash + signedAt + the
 *  bound delegation hash (the "consent receipt"). The full document stays in the vault. */
export interface Attestation {
  /** SHA-256 hex of the canonical document text — JP verifies by re-hashing. */
  docHash: Hex;
  /** ISO label of which document this is (for UI), e.g. 'adopt-mou-v1'. */
  docId: string;
  signedAt: number;
  /** Hash of the active delegation at signing time — ADR-0019: revoke the delegation
   *  and the attestation is consent-voided (the receipt's "standing" goes away). */
  consentBoundTo: Hex;
}

export interface AdoptionDeclaration {
  peopleGroupId: string;
  peopleGroupName: string;
  declaredAt: number;
  /** True if the adopter wants JP to match them with a facilitator who serves this FPG. */
  requestFacilitator: boolean;
}

// ── Impact-owned profile (community-wide) ─────────────────────────────────────
// Lives at the member's Impact home; JP queries it over the delegation. JP NEVER
// runs forms for these fields — if missing, JP sends the member to Impact to add.
// For the prototype: localStorage-backed; on first connect we seed a sensible
// mock so the "already on file" state is observable end-to-end. In production
// the seed disappears and reads hit the real Impact MCP.

export interface ImpactProfile {
  v: 1;
  contact?: ContactProfile;
  attestations: {
    /** WEA Statement of Faith — signed once at Impact, re-used across community apps. */
    wea?: Attestation;
  };
}

const IMPACT_KEY = (addr: Address): string => `agenticprimitives:demo-jp:impact-profile:${addr.toLowerCase()}`;

/** Seed an Impact profile so the "already on file" state has something to show on
 *  first connect. Demonstrates the SSI pattern even before a real Impact MCP exists.
 *  Derived from the member's name so each new home gets its own plausible mock. */
function seedImpactProfile(name: string): ImpactProfile {
  const handle = name.replace(/\.impact$/, '').replace(/[^a-z0-9-]/gi, '');
  return {
    v: 1,
    contact: {
      email: `${handle || 'member'}@example.com`,
      phone: '+1 555 0100',
      country: 'United States',
      city: 'San Francisco',
    },
    attestations: {
      // WEA pre-signed at Impact ~9 months ago, bound to the home's root credential.
      // For the prototype, the hashes are placeholders; in production these come from
      // the member's actual on-Impact signing ceremony.
      wea: {
        docHash: '0x77ea0000000000000000000000000000000000000000000000000000000000ea' as Hex,
        docId: 'wea-statement-of-faith-v1',
        signedAt: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 270,
        consentBoundTo: '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
      },
    },
  };
}

export function loadImpactProfile(addr: Address, name: string): ImpactProfile {
  try {
    const raw = localStorage.getItem(IMPACT_KEY(addr));
    if (raw) {
      const p = JSON.parse(raw) as ImpactProfile;
      if (p.v === 1) return p;
    }
  } catch {
    /* ignore */
  }
  // First read — seed the mock so the rest of the flow can run.
  const seeded = seedImpactProfile(name);
  saveImpactProfile(addr, seeded);
  return seeded;
}

export function saveImpactProfile(addr: Address, profile: ImpactProfile): void {
  try {
    localStorage.setItem(IMPACT_KEY(addr), JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

// ── JP-owned adopter record (program-specific) ────────────────────────────────

export interface JpAdopterRecord {
  v: 1;
  adopterType?: AdopterType;
  attestations: {
    mou?: Attestation; // JP-specific
  };
  adoption?: AdoptionDeclaration;
}

const JP_KEY = (addr: Address): string => `agenticprimitives:demo-jp:adopter-record:${addr.toLowerCase()}`;

export function loadJpAdopterRecord(addr: Address): JpAdopterRecord {
  try {
    const raw = localStorage.getItem(JP_KEY(addr));
    if (raw) {
      const r = JSON.parse(raw) as JpAdopterRecord;
      if (r.v === 1) return r;
    }
  } catch {
    /* ignore */
  }
  return { v: 1, attestations: {} };
}

export function saveJpAdopterRecord(addr: Address, record: JpAdopterRecord): void {
  try {
    localStorage.setItem(JP_KEY(addr), JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

export function clearJpAdopterRecord(addr: Address): void {
  try {
    localStorage.removeItem(JP_KEY(addr));
  } catch {
    /* ignore */
  }
}

// ── Step orchestration ────────────────────────────────────────────────────────
// The adopter onboarding interleaves "Impact has it ✓" steps (passive — JP just
// observes) with "JP-specific" steps (interactive — JP runs the ceremony). The
// passive ones complete automatically when the vault has the data; the interactive
// ones require the member to take action.

export type AdopterStep =
  | 'profile-on-file'        // ✓ Impact has contact info (passive)
  | 'adopter-type'           // interactive — JP asks
  | 'wea-on-file'            // ✓ Impact has WEA (passive, only for org/network)
  | 'mou'                    // interactive — JP-specific signing ceremony
  | 'adoption';              // interactive — JP-specific declaration

export interface AdopterStepView {
  step: AdopterStep;
  /** Does Impact OR JP run this step? */
  ownedBy: 'impact' | 'jp';
  /** True if the underlying data is already in the vault (or N/A). */
  satisfied: boolean;
  /** True if the member must interact to satisfy it; false if it's a passive "already on file" check. */
  interactive: boolean;
}

export function requiresWea(record: JpAdopterRecord): boolean {
  const t = record.adopterType;
  return t === 'church' || t === 'organization' || t === 'network';
}

export function adopterSteps(impact: ImpactProfile, record: JpAdopterRecord): AdopterStepView[] {
  const profileOk = !!impact.contact?.email;
  const typeOk = !!record.adopterType;
  const weaNeeded = requiresWea(record);
  const weaOk = !!impact.attestations.wea;
  const mouOk = !!record.attestations.mou;
  const adoptionOk = !!record.adoption;

  const steps: AdopterStepView[] = [
    { step: 'profile-on-file', ownedBy: 'impact', satisfied: profileOk, interactive: !profileOk },
    { step: 'adopter-type', ownedBy: 'jp', satisfied: typeOk, interactive: !typeOk },
  ];
  if (weaNeeded) {
    steps.push({ step: 'wea-on-file', ownedBy: 'impact', satisfied: weaOk, interactive: !weaOk });
  }
  steps.push({ step: 'mou', ownedBy: 'jp', satisfied: mouOk, interactive: !mouOk });
  steps.push({ step: 'adoption', ownedBy: 'jp', satisfied: adoptionOk, interactive: !adoptionOk });
  return steps;
}

export function nextAdopterStep(impact: ImpactProfile, record: JpAdopterRecord): AdopterStep | null {
  for (const s of adopterSteps(impact, record)) if (!s.satisfied) return s.step;
  return null;
}

export function isAdopterOnboardingComplete(impact: ImpactProfile, record: JpAdopterRecord): boolean {
  return nextAdopterStep(impact, record) === null;
}

// ── "What JP can see" projection ──────────────────────────────────────────────
// The view that flows OUT of the vault, over the delegation, TO JP. Critical for
// the SSI story: the member sees what JP holds (small) vs. what the vault holds
// (everything). Disconnecting at Impact revokes the delegation → JP's projection
// becomes empty again.

export interface JpProjection {
  /** Public adopter type — used for matching/reporting, not PII. */
  adopterType?: AdopterType;
  /** Attestation receipts JP holds — never the documents themselves. */
  attestations: {
    mou?: Pick<Attestation, 'docHash' | 'docId' | 'signedAt' | 'consentBoundTo'>;
    wea?: Pick<Attestation, 'docHash' | 'docId' | 'signedAt' | 'consentBoundTo'>;
  };
  /** The declaration — JP holds this as program data. */
  adoption?: AdoptionDeclaration;
  /** Channel-presence flag only: "I can reach you" — not the actual email/phone,
   *  which requires a higher delegation scope to release. */
  hasContact: boolean;
}

export function projectForJp(impact: ImpactProfile, record: JpAdopterRecord): JpProjection {
  return {
    adopterType: record.adopterType,
    attestations: {
      mou: record.attestations.mou,
      wea: impact.attestations.wea, // shared from Impact when present
    },
    adoption: record.adoption,
    hasContact: !!impact.contact?.email,
  };
}
