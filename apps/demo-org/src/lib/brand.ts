// demo-org's white-label identity — the Faith App, the GATEWAY into the Impact
// community (the relying party in the spec-234 diagram). App-level vertical copy
// lives here (ADR-0021), never in packages. Domains stay in lib/domain.ts.
import { toAgentName } from './domain';

export const GATEWAY = {
  /** This relying app's own short name (the app-mark). */
  appName: 'Impact',
  /** The community a user joins / connects to (their trust home, the central site). */
  community: 'Impact community',
} as const;

/** Gateway CTA label by name state: a new name segues into sign-up, a known name into connect. */
export function gatewayCta(name: string, exists: boolean): string {
  const label = name.trim();
  if (!label) return `Continue to ${GATEWAY.appName}`;
  const agentName = toAgentName(label);
  return exists ? `Connect ${agentName}` : `Claim ${agentName}`;
}
