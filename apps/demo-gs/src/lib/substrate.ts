// Phase 3 — wire demo-gs into the real skills/geo substrate (spec 251).
//
// demo-gs's taxonomy is anchored to canonical substrate ids (SkillRef.skillId /
// GeoFacet.featureId, computed in taxonomy.ts via the SDKs). Here we express a KC
// Offering's skills + regions as the substrate's CLAIM CREDENTIALS: each is a
// self-issued VC where the KC's Smart Agent asserts it HAS a skill / SERVES a geo
// feature, pointing to the on-chain definition (skillId / featureId, version).
//
// These credentials are VAULT-RESIDENT (private to the KC) — in v1 the demo holds
// them in its store, modelling the per-agent vault (spec 247). When the registries
// are broadcast, `skillDefinitionExists` / `geoFeatureExists` (from the SDKs) confirm
// the pinned (id, version) on chain via an injected readContract fn.

import { keccak256, toBytes } from 'viem';
import type { Address } from '@agenticprimitives/types';
import {
  buildSelfSkillClaim, SKILL_RELATION, type SkillClaimCredential,
} from '@agenticprimitives/agent-skills';
import {
  buildSelfGeoClaim, GEO_RELATION, type GeoClaimCredential,
} from '@agenticprimitives/geo-features';
import type { ExpertOffering } from '../domain/gs-types';
import { CHAIN_ID } from './personas';

/** The demo's pinned definition version (until live registry reads land). */
const DEFINITION_VERSION = 1;

/** Strip a CAIP-10 agent id to its Address. */
function addressOf(agentId: string): Address {
  return (agentId.includes(':') ? agentId.split(':').pop()! : agentId) as Address;
}

/** A deterministic one-claim-per-(subject, definition) nonce for the demo. */
function demoNonce(seed: string): `0x${string}` {
  return keccak256(toBytes(seed));
}

/** Map an Offering's visibility to a claim visibility mode. */
function claimVisibility(o: ExpertOffering): 'public-coarse' | 'private-commitment' {
  return o.visibility === 'confidential' ? 'private-commitment' : 'public-coarse';
}

/** The KC's offered skills as self-issued SkillClaimCredentials (vault-resident). */
export function offeringSkillClaims(offering: ExpertOffering): SkillClaimCredential[] {
  const subject = addressOf(offering.ownerPersonAgentId);
  const visibility = claimVisibility(offering);
  return offering.offeredSkills.map((s) =>
    buildSelfSkillClaim({
      chainId: CHAIN_ID,
      subject,
      definition: { skillId: s.skillId, version: DEFINITION_VERSION },
      relation: SKILL_RELATION.hasSkill,
      visibility,
      nonce: demoNonce(`skill:${subject}:${s.skillId}`),
    }),
  );
}

/** The KC's region focus as self-issued GeoClaimCredentials (vault-resident). */
export function offeringGeoClaims(offering: ExpertOffering): GeoClaimCredential[] {
  const subject = addressOf(offering.ownerPersonAgentId);
  const visibility = claimVisibility(offering);
  return (offering.geoFacets ?? []).map((g) =>
    buildSelfGeoClaim({
      chainId: CHAIN_ID,
      subject,
      feature: { featureId: g.featureId, version: DEFINITION_VERSION },
      relation: GEO_RELATION.servesWithin,
      visibility,
      nonce: demoNonce(`geo:${subject}:${g.featureId}`),
    }),
  );
}
