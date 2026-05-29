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
  /** Display name — first/last let community apps render a friendly header ("Rich
   *  Pedersen") instead of the handle. Identity-level; the handle remains canonical. */
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  /** For church / organization / network adopters — held at Impact because "the org you're
   *  part of" is a community-wide identity fact, not a JP-specific one. */
  organizationName?: string;
  organizationCountry?: string;
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

/** Empty starting profile — the demo intentionally does NOT seed contact info so the
 *  "missing fields" path is observable. In production this would represent a brand-new
 *  member who hasn't filled in their profile at their Impact home yet. */
export function loadImpactProfile(addr: Address, _name: string): ImpactProfile {
  try {
    const raw = localStorage.getItem(IMPACT_KEY(addr));
    if (raw) {
      const p = JSON.parse(raw) as ImpactProfile;
      if (p.v === 1) return p;
    }
  } catch {
    /* ignore */
  }
  return { v: 1, attestations: {} };
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

// ── JP requirements ───────────────────────────────────────────────────────────
// JP's adopt program defines what it needs in the member's Impact profile to take
// an adoption. The fields themselves are held at Impact (community-wide); JP only
// declares its requirement list + checks for satisfaction. Other relying apps can
// have different requirement lists over the SAME Impact profile — that's the
// whole point of holding profile fields at the home, not at each app.

export type ProfileFieldKey = keyof ContactProfile;

export interface JpRequiredField {
  key: ProfileFieldKey;
  label: string;
  helperWhy: string;
  /** UI hint for the inline-from-JP form. */
  inputType: 'email' | 'tel' | 'text';
  placeholder: string;
}

export function jpRequiredFields(type: AdopterType | undefined): JpRequiredField[] {
  const base: JpRequiredField[] = [
    { key: 'firstName', label: 'First name', helperWhy: 'So JP can greet you by name across the program (instead of your handle).', inputType: 'text', placeholder: 'Rich' },
    { key: 'lastName', label: 'Last name', helperWhy: 'Used with your first name to render your name on adopter records.', inputType: 'text', placeholder: 'Pedersen' },
    { key: 'email', label: 'Email', helperWhy: 'How JP sends you quarterly prayer updates and matches you with a facilitator.', inputType: 'email', placeholder: 'you@example.com' },
    { key: 'country', label: 'Country', helperWhy: 'Where you live — for context, not used publicly.', inputType: 'text', placeholder: 'United States' },
  ];
  const isOrgish = type === 'church' || type === 'organization' || type === 'network';
  if (isOrgish) {
    base.push(
      { key: 'organizationName', label: 'Organization name', helperWhy: 'The name of the church / organization / network you adopt under.', inputType: 'text', placeholder: 'Grace Community Church' },
      { key: 'organizationCountry', label: 'Organization country', helperWhy: 'Where the organization is based or operates from.', inputType: 'text', placeholder: 'United States' },
    );
  }
  return base;
}

export function impactProfileMissingFields(impact: ImpactProfile, type: AdopterType | undefined): JpRequiredField[] {
  const c = impact.contact ?? {};
  return jpRequiredFields(type).filter((f) => {
    const v = c[f.key];
    return typeof v !== 'string' || v.trim() === '';
  });
}

/** A summary used by the dashboard banner — empty `missing` ⇒ everything JP needs is on file. */
export interface ProfileCompletenessSummary {
  total: number;
  satisfied: number;
  missing: JpRequiredField[];
}

export function profileCompleteness(impact: ImpactProfile, type: AdopterType | undefined): ProfileCompletenessSummary {
  const all = jpRequiredFields(type);
  const missing = impactProfileMissingFields(impact, type);
  return { total: all.length, satisfied: all.length - missing.length, missing };
}

// ── Step orchestration ────────────────────────────────────────────────────────
// The adopter onboarding interleaves "Impact has it ✓" steps (passive — JP just
// observes) with "JP-specific" steps (interactive — JP runs the ceremony). The
// passive ones complete automatically when the vault has the data; the interactive
// ones require the member to take action.

export type AdopterStep =
  | 'profile-on-file'        // ✓ Impact has the JP-required contact + (if orgish) org fields
  | 'adopter-type'           // interactive — JP asks
  | 'wea-on-file'            // ✓ Impact has WEA (only for church/org/network adopters)
  | 'mou'                    // interactive — JP-specific signing ceremony
  | 'adoption';              // interactive — JP-specific declaration

export interface AdopterStepView {
  step: AdopterStep;
  ownedBy: 'impact' | 'jp';
  satisfied: boolean;
  interactive: boolean;
}

export function requiresWea(record: JpAdopterRecord): boolean {
  const t = record.adopterType;
  return t === 'church' || t === 'organization' || t === 'network';
}

export function adopterSteps(impact: ImpactProfile, record: JpAdopterRecord): AdopterStepView[] {
  const profileOk = impactProfileMissingFields(impact, record.adopterType).length === 0;
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

/** True iff JP can accept the declaration right now — every JP-required field is on
 *  file at Impact, the MOU is signed, and (for org/network adopters) WEA is signed. */
export function canDeclareAdoption(impact: ImpactProfile, record: JpAdopterRecord): boolean {
  if (impactProfileMissingFields(impact, record.adopterType).length > 0) return false;
  if (!record.adopterType) return false;
  if (requiresWea(record) && !impact.attestations.wea) return false;
  if (!record.attestations.mou) return false;
  return true;
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
