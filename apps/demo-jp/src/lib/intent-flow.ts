// Intent flow orchestrator — IA §4d steps I-1..I-7.
//
// Composes intent-marketplace + intent-resolver + agreements to take an adopter
// from "I want to adopt a people group" to a dual-signed Commitment ready to
// hand off to the agreement layer (IA §4c).

import {
  PassThroughResolver,
  type ResolvedOrder,
} from '@agenticprimitives/intent-resolver';
import {
  composite,
  isCompatible,
  toMatchScore,
  type Commitment,
  type Intent,
  type IntentMatch,
} from '@agenticprimitives/intent-marketplace';
import type { Address } from '@agenticprimitives/types';
import { keccak256, toBytes } from 'viem';

import { buildJpIntent, type BuildJpIntentArgs } from './intent-payload.js';

export interface IntentFlowResult {
  intent: Intent;
  resolved: ResolvedOrder<Intent> | null;
  resolutionReceiptId: string;
}

/** I-1..I-3: build, resolve, log. */
export async function expressIntent(args: BuildJpIntentArgs): Promise<IntentFlowResult> {
  const intent = buildJpIntent(args);
  const resolver = new PassThroughResolver<Intent>();
  const resolved = await resolver.resolve(intent);
  const resolutionReceiptId = `res_${args.id}`;
  return { intent, resolved, resolutionReceiptId };
}

/** I-4: match. Returns a synthetic IntentMatch when compatible. */
export function tryMatch(
  brokerAgent: Address,
  a: Intent,
  b: Intent,
  opts: { topicSimilarityThreshold?: number; proximity?: number; outcome?: number } = {},
): IntentMatch | null {
  if (!isCompatible(a, b, { topicSimilarityThreshold: opts.topicSimilarityThreshold ?? 0 })) {
    return null;
  }
  const score = toMatchScore(composite({ proximity: opts.proximity ?? 0.5, outcome: opts.outcome ?? 0.5 }));
  return {
    id: `match_${a.id}_${b.id}`,
    intentRefs: [a.id, b.id],
    matchScore: score,
    matchedAt: new Date().toISOString(),
    brokerAgent,
    rationale: `Compatible: direction opposite + object equal (${a.object}).`,
  };
}

/** I-5..I-7: produce a Commitment envelope ready for the agreement layer. */
export function buildCommitment(args: {
  intentMatch: IntentMatch;
  parties: [Address, Address];
}): Commitment {
  const commitmentHash = keccak256(toBytes(`${args.intentMatch.id}:${args.parties[0]}:${args.parties[1]}`));
  return {
    id: `cmt_${args.intentMatch.id}`,
    intentMatchRef: args.intentMatch.id,
    parties: args.parties,
    commitmentHash,
    signedBy: args.parties,
    createdAt: new Date().toISOString(),
  };
}
