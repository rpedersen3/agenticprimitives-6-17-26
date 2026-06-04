// The deterministic PUBLIC dataset the read API serves (spec 250 §16 / pilot "public read API").
//
// Wave 2 (spec 252 §7): the in-app SAMPLE fixtures are gone — member needs/offerings now live in each
// member's OWN vault and are NOT public. What stays server-side + identity-free is the Pattern-A
// bridged Switchboard demand: the external Switchboard's published open Roles, mapped to gc:Needs.
// This is the demo's stand-in for "Switchboard publishes a public feed" — the same set is returned to
// every caller. (Live member needs join the broker's ENTITLED view via grants, never this public API.)

import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import { SWITCHBOARD_ROLES } from '../data/switchboard-roles';
import { mapRoles } from './switchboard-bridge';

/** Open public Needs = the bridged public Switchboard roles (the public demand feed). */
export function publicNeeds(): GcoNeedIntent[] {
  return mapRoles(SWITCHBOARD_ROLES, '2026-06-04T00:00:00Z').results.map((r) => r.need);
}

/** Public Offerings: none in the public feed — KC offerings are private to each KC's vault until
 *  shared via a connection (the public read surface carries demand only). */
export function publicOfferings(): ExpertOffering[] {
  return [];
}
