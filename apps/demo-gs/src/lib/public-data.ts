// The deterministic PUBLIC dataset the read API serves (spec 250 §16 / pilot "public read API"):
// the canonical fixtures + the Pattern-A bridged Switchboard demand. Server-side + identity-free, so
// the same set is returned to every caller. (Live user-created Needs join this once the broker vault
// lands — spec 252; the API then unions the vault on top.)

import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import { SEED_NEEDS, SEED_OFFERINGS } from '../data/fixtures';
import { SWITCHBOARD_ROLES } from '../data/switchboard-roles';
import { mapRoles } from './switchboard-bridge';

/** Open public Needs = canonical fixtures + the bridged public Switchboard roles. */
export function publicNeeds(): GcoNeedIntent[] {
  const bridged = mapRoles(SWITCHBOARD_ROLES, '2026-06-04T00:00:00Z').results.map((r) => r.need);
  return [...SEED_NEEDS, ...bridged];
}

/** Active public Offerings (public-summary tier — identity/contact already stripped downstream). */
export function publicOfferings(): ExpertOffering[] {
  return SEED_OFFERINGS;
}
