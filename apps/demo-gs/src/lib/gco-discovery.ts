// Cross-browser GCO recognition. A connected person may already have created a GCO org in a previous
// session or browser — the local `gco` session is gone, but the org is still known to Connect's
// related-orgs (the person↔org link the home recorded at org-create) and its durable org→Switchboard
// grant lives in Jane's member registry (`gs:member:<orgSA>`). This rebuilds the `gco` session from
// those, so the hub recognizes the EXISTING org instead of offering to create a duplicate.
//
// One mechanism (ADR-0013): related-orgs (person-authorized) tells us WHICH org SA belongs to this
// person; the registry holds the grant. If either is absent/unreachable we return null (not recognized)
// — we never fabricate a grant or fall back to a different read.
//
// Purpose is REQUIRED (ADR-0013, no silent fallback): we recognize ONLY links explicitly tagged
// `gs-gco-org`. A missing purpose is stale / migration-era data, NOT product truth — accepting it would
// be exactly the silent-fallback pattern we forbid (treating "no answer" as "yes"). The org-create path
// always sets it (App `GcoOrgCreate` → `startOrgCreation(signatory, name, 'gs-gco-org', switchboardSa)`
// → `org_purpose=gs-gco-org`), so a legitimately-created GCO org is never dropped by this check.

import { listRelatedOrgs } from '../connect-client';
import { loadMembers } from './member-vault';
import type { MemberSession } from './session';

const GCO_PURPOSE = 'gs-gco-org';

/** Rebuild the `gco` session for an org the connected person already created, or null if none. */
export async function discoverGcoSession(personName: string, idToken: string): Promise<MemberSession | null> {
  let orgs;
  try { orgs = await listRelatedOrgs(personName, idToken); } catch { return null; }
  const gcoOrgs = orgs.filter((o) => o.purpose === GCO_PURPOSE);
  if (gcoOrgs.length === 0) return null;

  let members;
  try { members = await loadMembers(); } catch { return null; }

  for (const o of gcoOrgs) {
    const m = members.find((x) => x.kind === 'gco' && x.sa.toLowerCase() === o.orgAgent.toLowerCase());
    if (m) {
      return {
        kind: 'gco',
        sa: m.sa,
        name: m.orgName ?? m.name,
        orgName: m.orgName ?? o.orgName,
        signatory: m.signatory ?? personName,
        grant: m.delegation,
      };
    }
  }
  return null;
}
