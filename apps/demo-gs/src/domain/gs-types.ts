// Global Switchboard domain types (spec 250 §13). App-local until a 2nd consumer of the
// intent-spine appears (then extract per spec 250 §"Reference"). Skills are CANONICAL
// references (SkillRef.gcUri), never free text — Needs and Offerings join on concept identity.

import type { Address } from '@agenticprimitives/types';

/** A canonical agent id. v1 uses the CAIP-10-style string demo-sso would resolve. */
export type AgentId = `eip155:${number}:${Address}` | string;
export type Uri = string;
export type Hex32 = `0x${string}`;
export type ISODateTime = string;

export type VisibilityTier = 'public' | 'confidential' | 'sensitive';
export type NeedKind = 'discussion' | 'project' | 'role' | 'inquiry';

/** A canonical skill reference. The gcUri is the display/registry key; `skillId` is the canonical
 *  substrate id (keccak, from @agenticprimitives/agent-skills) that anchors this skill to the on-chain
 *  SkillDefinitionRegistry. `label` is display only. */
export interface SkillRef {
  gcUri: Uri;
  /** Canonical substrate skill id — what a SkillClaimCredential / the SkillDefinitionRegistry key on. */
  skillId: Hex32;
  label: string;
  categoryUri: Uri;
  cboxUri?: Uri;
  chainRef?: { chainId: number; contract: Address; conceptId?: string };
  source: 'switchboard' | 'cbox' | 'gc-registry';
}

export interface GeoFacet {
  uri: Uri;
  /** Canonical substrate feature id — anchors this region to the on-chain GeoFeatureRegistry. */
  featureId: Hex32;
  label: string;
  level: 'global' | 'region' | 'country' | 'admin' | 'custom';
  /** A region marked sensitive is suppressed/coarsened in public projections. */
  sensitivity?: 'normal' | 'creative_access' | 'closed';
  /** Coarser region this rolls up into (used for related-geo scoring + redaction). */
  parentUri?: Uri;
}

export interface CauseRef { uri: Uri; label: string }
export interface LanguageRef { code: string; label: string }
export interface PeopleGroupFacet { uri: Uri; label?: string; sensitivity?: VisibilityTier }

export interface Commitment {
  hours?: number;
  cadence?: 'once' | 'weekly' | 'monthly' | 'seasonal' | 'ongoing';
  durationWeeks?: number;
  notes?: string;
}

export interface Capacity {
  maxActiveAgreements?: number;
  estimatedHoursPerMonth?: number;
  availableFrom?: ISODateTime;
  availabilityStatus: 'available' | 'limited' | 'paused' | 'unavailable';
}

export type NeedStatus =
  | 'draft' | 'open' | 'matched' | 'requested' | 'agreement_active' | 'withdrawn' | 'fulfilled';

/** A GCO-owned declaration of a skill/capability need (spec 250 §13.2). */
export interface GcoNeedIntent {
  id: Uri;
  ownerOrgAgentId: AgentId;
  createdByPersonAgentId: AgentId;
  title: string;
  description?: string;
  needKind: NeedKind;
  requiredSkills: SkillRef[];
  desiredSkills?: SkillRef[];
  geoFacets: GeoFacet[];
  peopleGroupFacets?: PeopleGroupFacet[];
  causeFacets?: CauseRef[];
  languages?: LanguageRef[];
  commitment?: Commitment;
  visibility: VisibilityTier;
  /** Confidential org contact — released to the counterparty only on Agreement accept. */
  confidentialContact?: string;
  status: NeedStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type OfferingStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface ExpertiseEvidenceRef {
  id: Uri;
  kind: 'self_claim' | 'endorsement' | 'credential' | 'case_study' | 'prior_agreement' | 'cbox_attestation';
  label: string;
  issuerAgentId?: AgentId;
  visibility: VisibilityTier;
}

/** A KC person's expertise offering (spec 250 §13.3). */
export interface ExpertOffering {
  id: Uri;
  ownerPersonAgentId: AgentId;
  displayName?: string;
  headline?: string;
  offeredSkills: SkillRef[];
  relatedSkillCategories?: Uri[];
  geoFacets?: GeoFacet[];
  peopleGroupFacets?: PeopleGroupFacet[];
  causeFacets?: CauseRef[];
  languages?: LanguageRef[];
  capacity?: Capacity;
  availabilityNotes?: string;
  evidence?: ExpertiseEvidenceRef[];
  /** 'public-summary' = discoverable skills without identity/contact. */
  visibility: VisibilityTier | 'public-summary';
  /** Confidential contact — released to the counterparty only on Agreement accept. */
  confidentialContact?: string;
  status: OfferingStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MatchReasonKind =
  | 'skill_exact' | 'skill_category' | 'geo_exact' | 'geo_related' | 'cause'
  | 'people_group' | 'language' | 'availability' | 'trust_evidence' | 'policy';

export interface MatchReason {
  kind: MatchReasonKind;
  label: string;
  weight: number;
  publicExplanation?: string;
}

export type MatchStatus = 'proposed' | 'requested' | 'accepted' | 'declined' | 'expired' | 'superseded';

/** A scored, explainable compatibility result. Non-binding (spec 250 §13.4). */
export interface GsIntentMatch {
  id: Uri;
  needId: Uri;
  offeringId: Uri;
  score: number; // 0..100
  confidence?: number; // 0..1
  reasons: MatchReason[];
  missing: MatchReason[];
  policyWarnings: string[];
  status: MatchStatus;
  createdAt: ISODateTime;
  computedBy: 'demo-gs' | 'switchboard-bridge' | 'graph-query';
}
