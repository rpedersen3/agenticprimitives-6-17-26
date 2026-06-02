/**
 * @agenticprimitives/intent-resolver — Resolver layer SKELETON (W1).
 *
 * W1 scope: types + PassThroughResolver only. Full resolver engine in W2.
 *
 * Authoritative spec: specs/239-intent-spine.md §4.5
 */

export const PACKAGE_NAME = '@agenticprimitives/intent-resolver';
export const PACKAGE_STATUS = 'w1-skeleton' as const;
export const SPEC_REF = 'specs/239-intent-spine.md';

export interface IIntentResolver<TIntent = unknown, TResolved = unknown> {
  resolve(intent: TIntent): Promise<TResolved | null>;
}

export interface ResolvedOrder<TIntent = unknown> {
  resolvedFromIntentId: string;
  canonicalConstraints: unknown;
  expandedAssumptions: unknown;
  validationRequirements: string[];
  erc7683Order?: unknown;
  source: TIntent;
}

export class PassThroughResolver<
  TIntent extends { id: string; hasConstraintSet?: unknown; hasAssumptionSet?: unknown },
> implements IIntentResolver<TIntent, ResolvedOrder<TIntent>>
{
  async resolve(intent: TIntent): Promise<ResolvedOrder<TIntent> | null> {
    return {
      resolvedFromIntentId: intent.id,
      canonicalConstraints: intent.hasConstraintSet ?? null,
      expandedAssumptions: intent.hasAssumptionSet ?? null,
      validationRequirements: [],
      source: intent,
    };
  }
}
