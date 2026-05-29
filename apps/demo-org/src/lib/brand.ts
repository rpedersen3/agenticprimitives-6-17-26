// demo-org's white-label identity — the Faith App, the GATEWAY into the Impact
// community (the relying party in the spec-234 diagram). App-level vertical copy
// lives here (ADR-0021), never in packages. Domains stay in lib/domain.ts.

export const GATEWAY = {
  /** This relying app's own short name (the app-mark). */
  appName: 'Impact',
  /** The community a user joins / connects to (their trust home, the central site). */
  community: 'Impact community',
} as const;

/** Gateway CTA label. "Connect with Impact" is the reinforced SSO verb (the everyday case, like
 *  "Sign in with Google"); creating a home is the one-off for first-timers. The name is shown
 *  above the button (welcome-back / preview), so the button stays a short, consistent verb. */
export function gatewayCta(name: string, exists: boolean): string {
  if (!name.trim()) return `Connect with ${GATEWAY.appName}`;
  return exists ? `Connect with ${GATEWAY.appName}` : `Create your ${GATEWAY.appName} home`;
}
