// Live on-chain reads against the seeded skill + geo DEFINITION registries (spec 251).
//
// This is the one chain-touching module in demo-gs (v1 is otherwise fixture-driven). It uses
// the SDKs' INJECTED-readContract seam: we pass viem's `publicClient.readContract` into
// skillDefinitionExists / geoFeatureExists, so the SDK stays viem-free and the app owns the
// client. Addresses come from the single-source-of-truth deployments subpath.

import { createPublicClient, http, type PublicClient } from 'viem';
import type { Address } from '@agenticprimitives/types';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/base-sepolia';
import {
  skillDefinitionExists, type SkillDefinitionRef, type ReadContractFn as SkillReadFn,
} from '@agenticprimitives/agent-skills';
import {
  geoFeatureExists, type GeoFeatureRef, type ReadContractFn as GeoReadFn,
} from '@agenticprimitives/geo-features';

export const SKILL_REGISTRY = CONTRACTS.skillDefinitionRegistry as Address;
export const GEO_REGISTRY = CONTRACTS.geoFeatureRegistry as Address;

const RPC_URL = (import.meta.env?.VITE_RPC_URL as string | undefined) ?? 'https://sepolia.base.org';

let _client: PublicClient | null = null;
function client(): PublicClient {
  if (!_client) _client = createPublicClient({ transport: http(RPC_URL) });
  return _client;
}

/** Does this skill definition `(skillId, version)` exist on the live SkillDefinitionRegistry? */
export async function skillOnChain(ref: SkillDefinitionRef): Promise<boolean> {
  const read = ((a: Parameters<SkillReadFn>[0]) => client().readContract(a as never)) as SkillReadFn;
  return skillDefinitionExists(read, SKILL_REGISTRY, ref);
}

/** Does this geo feature `(featureId, version)` exist on the live GeoFeatureRegistry? */
export async function featureOnChain(ref: GeoFeatureRef): Promise<boolean> {
  const read = ((a: Parameters<GeoReadFn>[0]) => client().readContract(a as never)) as GeoReadFn;
  return geoFeatureExists(read, GEO_REGISTRY, ref);
}
