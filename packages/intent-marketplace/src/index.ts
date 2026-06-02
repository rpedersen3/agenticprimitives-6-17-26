/**
 * @agenticprimitives/intent-marketplace — Direct Lane intent marketplace
 * (Layers 2, 3, 5, 6, 7 of the spine).
 *
 * Authoritative spec: specs/239-intent-spine.md
 */

import type { Address } from '@agenticprimitives/types';

export const PACKAGE_NAME = '@agenticprimitives/intent-marketplace';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/239-intent-spine.md';

export type Hex32 = `0x${string}`;
export type IRI = `${string}:${string}`;

// ─── Layer 2: Intent ────────────────────────────────────────────────

export type IntentDirection = 'receive' | 'give';
export type IntentStatus =
  | 'drafted'
  | 'expressed'
  | 'acknowledged'
  | 'matched'
  | 'committed'
  | 'completed'
  | 'withdrawn'
  | 'expired';
export type VisibilityTier =
  | 'Public'
  | 'PublicCoarse'
  | 'PrivateCommitment'
  | 'PrivateZK'
  | 'OffchainOnly';

export interface Intent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  direction: IntentDirection;
  object: IRI;
  topic?: string;
  intentType?: string;
  expressedBy: Address;
  addressedTo: Address[];
  hasConstraintSet: ConstraintSet;
  hasAssumptionSet?: AssumptionSet;
  expectedOutcome?: Record<string, unknown>;
  visibility: VisibilityTier;
  status: IntentStatus;
  payload?: TPayload;
  createdAt: string;
}

// ─── Layer 3: ConstraintSet + AssumptionSet (Anoma CSP-shaped) ──────

export type ConstraintSource = 'user-asserted' | 'llm-inferred' | 'policy-imposed';
export type ConstraintStrength = 'hard' | 'soft';
export type ConstraintEnforcement = 'pre-execution' | 'agreement' | 'ranking';

export type ConstraintDomain =
  | { kind: 'enum'; values: string[] }
  | { kind: 'range'; min: number | bigint; max: number | bigint; unit: string }
  | { kind: 'set'; allowedSet: string[]; deniedSet?: string[] }
  | { kind: 'predicate'; expression: string };

export interface Constraint {
  id: string;
  variable: string;
  domain: ConstraintDomain;
  source: ConstraintSource;
  strength: ConstraintStrength;
  enforcement?: ConstraintEnforcement;
  rationale?: string;
}

export interface ConstraintSet {
  hardConstraints: Constraint[];
  softConstraints: Constraint[];
  fieldDisclosure?: Record<string, VisibilityTier>;
}

export interface NamedAssumption {
  name: string;
  description?: string;
  trustLevel: 'asserted' | 'verified' | 'oracle' | 'zkp';
  risk?: string;
  evidenceRef?: string;
  expiresAt?: string;
}

export interface AssumptionSet {
  resolverId: string;
  namedAssumptions: NamedAssumption[];
  risks: string[];
  requiredValidations: string[];
}

// ─── ResolutionReceipt (spec 239 §4.5a) ─────────────────────────────

export interface ResolutionReceipt {
  id: string;
  type: 'ResolutionReceipt';
  version: '1.0';
  inputRefs: {
    naturalLanguagePromptHash?: Hex32;
    sourceIntentRef?: string;
    sourceA2aMessageHash?: Hex32;
    contextRefs: string[];
  };
  resolver: {
    agentId: Address;
    agentClass: 'concierge' | 'resolver' | 'orchestrator' | 'hybrid';
    version: string;
    model?: { name: string; version: string; provider: string };
    policyVersion: string;
    toolCalls?: { toolName: string; inputHash: Hex32; outputHash: Hex32; durationMs: number }[];
  };
  outputIntentRef: string;
  constraintSetRef: string;
  assumptionSetRef?: string;
  confidence: number;
  unresolvedAmbiguities?: string[];
  missingInformation?: string[];
  requiresUserConfirmation: boolean;
  userConfirmedAt?: string;
  policyChecks: { name: string; passed: boolean; rationale?: string }[];
  riskFlags: string[];
  createdAt: string;
}

// ─── Layer 7: IntentMatch + Commitment ──────────────────────────────

export interface IntentMatch {
  id: string;
  intentRefs: [string, string];
  matchScore: number;
  matchedAt: string;
  brokerAgent: Address;
  rationale?: string;
}

export interface Commitment {
  id: string;
  intentMatchRef: string;
  parties: [Address, Address];
  commitmentHash: Hex32;
  signedBy: [Address, Address];
  createdAt: string;
}

// ─── Matcher primitives (spec 239 §7) ───────────────────────────────

export function isCompatible(
  a: Intent,
  b: Intent,
  opts: { topicSimilarityThreshold: number } = { topicSimilarityThreshold: 0.0 },
): boolean {
  if (a.direction === b.direction) return false;
  if (a.object !== b.object) return false;
  const sim = computeTopicSimilarity(a.topic ?? '', b.topic ?? '');
  return sim >= opts.topicSimilarityThreshold;
}

function computeTopicSimilarity(topicA: string, topicB: string): number {
  if (!topicA || !topicB) return 1.0;
  if (topicA === topicB) return 1.0;
  const setA = new Set(topicA.toLowerCase().split(/\s+/));
  const setB = new Set(topicB.toLowerCase().split(/\s+/));
  const intersect = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersect.size / union.size;
}

export function composite(args: { proximity: number; outcome: number }): number {
  const proxLaplace = (args.proximity + 1) / 2;
  const outLaplace = (args.outcome + 1) / 2;
  return 0.6 * proxLaplace + 0.4 * outLaplace;
}

export function toMatchScore(composite: number): number {
  const clamped = Math.max(0, Math.min(1, composite));
  return Math.round(clamped * 10000);
}
