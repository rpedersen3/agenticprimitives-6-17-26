// Personal-subdomain host context (spec 229 P5 + spec 231). The Connect central
// auth is served at `impact-agent.io`, and EACH person's secure home is their own
// single-label subdomain `<handle>.impact-agent.io` — which also doubles as that
// agent's A2A endpoint (handled by the A2A proxy Functions). The WebAuthn RP is
// the serving host, so a ROOT passkey created here is bound to (and isolated to)
// the person's own subdomain.
//
// Apex `impact-agent.io` = the platform landing + bootstrap/sign-up origin (a
// name with no agent yet has no home to resolve to).

/** The registrable Connect domain. Per-person homes are single-label subdomains. */
export const CENTRAL_AUTH_DOMAIN = 'impact-agent.io';

/** The platform (apex) Connect origin — landing + bootstrap default. */
export const PLATFORM_AUTH_ORIGIN = `https://${CENTRAL_AUTH_DOMAIN}`;

/**
 * Extract a single-label subdomain from a hostname given the base domain.
 * `alice.impact-agent.io` → `alice`. The apex, nested labels
 * (`a.b.impact-agent.io`), `www`, and non-matching hosts (pages.dev preview,
 * localhost dev) → `null`.
 */
export function parseAgentSubdomain(
  hostname: string,
  baseDomain: string = CENTRAL_AUTH_DOMAIN,
): string | null {
  const host = (hostname.split(':')[0] ?? '').toLowerCase();
  const base = baseDomain.toLowerCase();
  if (host === base) return null;
  if (!host.endsWith('.' + base)) return null;
  const label = host.slice(0, host.length - base.length - 1);
  if (!label || label.includes('.') || label === 'www') return null;
  return label;
}

/** The handle this page is serving as a personal home, or null on the apex / a
 *  non-central-auth host (pages.dev preview, localhost). On `alice.impact-agent.io`
 *  → `alice`. Drives the "this is <handle>'s secure home" framing + the
 *  subdomain-isolated passkey ceremony. */
export function subdomainHandle(): string | null {
  if (typeof window === 'undefined') return null;
  return parseAgentSubdomain(window.location.hostname);
}

/** The personal central-auth origin for a name label
 *  (`alice` → `https://alice.impact-agent.io`). The ROOT-passkey home + A2A
 *  endpoint for that agent. */
export function personalAuthOrigin(label: string): string {
  return `https://${label}.${CENTRAL_AUTH_DOMAIN}`;
}
