// JP-vertical intent payload + ConstraintSet builders.
//
// PD-19 / D-38: the GENERIC intent envelope + ConstraintSet types live in
// `@agenticprimitives/intent-marketplace`. This module ships the JP-VERTICAL
// payload shapes + helpers that compose against them.
//
// Vocabulary firewall (ADR-0021): faith / FPG / MOU vocabulary lives HERE,
// NEVER in packages.

import type {
  Constraint,
  ConstraintSet,
  Intent,
  VisibilityTier,
} from '@agenticprimitives/intent-marketplace';
import type { Address } from '@agenticprimitives/types';

/** SKOS IRIs for JP-vertical intent objects. */
export const JP_INTENT_OBJECT = {
  NeedFacilitator: 'apint:NeedFacilitator',
  OfferFacilitator: 'apint:OfferFacilitator',
  NeedAdopter: 'apint:NeedAdopter',
  OfferAdopter: 'apint:OfferAdopter',
  NeedFunding: 'apint:NeedFunding',
  OfferFunding: 'apint:OfferFunding',
} as const;
export type JpIntentObject = (typeof JP_INTENT_OBJECT)[keyof typeof JP_INTENT_OBJECT];

/** JP-specific intent payload — the freeform area that's NOT ConstraintSet. */
export interface JpIntentPayload extends Record<string, unknown> {
  /** FPG (Frontier People Group) identifier. */
  fpgId?: string;
  /** ISO country codes the facilitator/adopter operates in. */
  countries?: string[];
  /** Adopter type (when expressing from adopter side). */
  adopterType?: 'individual' | 'family' | 'group' | 'church' | 'organization' | 'network';
  /** Notes — opaque app-level metadata. */
  notes?: string;
}

export interface BuildJpIntentArgs {
  id: string;
  expressedBy: Address;
  object: JpIntentObject;
  topic?: string;
  payload: JpIntentPayload;
  /** Optional explicit visibility; defaults to 'PublicCoarse' for facilitator-class intents. */
  visibility?: VisibilityTier;
}

/** Build the substrate Intent + populate the ConstraintSet from JP payload fields.
 *  This is the JP-vertical adapter — payload values get LIFTED into typed Constraints
 *  per D-38 so the matchmaker can reason about them. */
export function buildJpIntent(args: BuildJpIntentArgs): Intent<JpIntentPayload> {
  const direction = args.object.startsWith('apint:Need') ? 'receive' : 'give';
  const cs = buildJpConstraintSet(args.payload);
  return {
    id: args.id,
    direction,
    object: args.object,
    topic: args.topic,
    intentType: prettifyObject(args.object),
    expressedBy: args.expressedBy,
    addressedTo: [],
    hasConstraintSet: cs,
    visibility: args.visibility ?? defaultVisibilityFor(args.object),
    status: 'expressed',
    payload: args.payload,
    createdAt: new Date().toISOString(),
  };
}

function buildJpConstraintSet(payload: JpIntentPayload): ConstraintSet {
  const hardConstraints: Constraint[] = [];

  if (payload.fpgId) {
    hardConstraints.push({
      id: 'fpgId',
      variable: 'fpgId',
      domain: { kind: 'enum', values: [payload.fpgId] },
      source: 'user-asserted',
      strength: 'hard',
      enforcement: 'pre-execution',
      rationale: 'Adoption is scoped to a specific Frontier People Group.',
    });
  }

  if (payload.countries && payload.countries.length > 0) {
    hardConstraints.push({
      id: 'countries',
      variable: 'geo',
      domain: { kind: 'set', allowedSet: payload.countries },
      source: 'user-asserted',
      strength: 'hard',
      enforcement: 'pre-execution',
    });
  }

  if (payload.adopterType) {
    hardConstraints.push({
      id: 'adopterType',
      variable: 'adopterType',
      domain: { kind: 'enum', values: [payload.adopterType] },
      source: 'user-asserted',
      strength: 'hard',
      enforcement: 'pre-execution',
    });
  }

  return {
    hardConstraints,
    softConstraints: [],
    fieldDisclosure: { 'payload.notes': 'PrivateCommitment' },
  };
}

function defaultVisibilityFor(object: JpIntentObject): VisibilityTier {
  if (object.startsWith('apint:NeedFunding') || object.startsWith('apint:OfferFunding')) {
    return 'PublicCoarse';
  }
  return 'PublicCoarse';
}

function prettifyObject(object: JpIntentObject): string {
  return object.replace('apint:', '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
