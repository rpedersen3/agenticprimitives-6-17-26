// THE single source of demo-org's deployment-domain config (ADR-0021). demo-org
// is a RELYING site: it sends users to the person's Connect SSO home and labels
// `.impact` names. No other file should hardcode a hostname or the name TLD —
// import from here. Deployment-specific BY DESIGN; never hoist into packages/*
// (enforced by `pnpm check:no-domain-in-packages`).
//
// Split (spec 232): SSO/sign-in home = `<label>.impact-agent.me`; the agent's
// A2A endpoint is a separate domain `<handle>.impact-agent.io` (not demo-org's
// concern). Names are claimed under the `.impact` permissionless subregistry.

/** Where each person's Connect SSO home lives — relying sites send users here. */
export const CONNECT_DOMAIN = 'impact-agent.me';
/** The TLD agent names live under (the `.impact` permissionless subregistry). */
export const AGENT_NAME_PARENT = 'impact';
/** Platform (apex) Connect origin — the bootstrap default when a name has no agent.
 *  Overridable at build time with VITE_CENTRAL_AUTH_ORIGIN. */
export const PLATFORM_AUTH_ORIGIN =
  (import.meta.env?.VITE_CENTRAL_AUTH_ORIGIN as string | undefined) ?? `https://${CONNECT_DOMAIN}`;

/** The label of a name (alice.impact → alice; alice → alice). */
export function nameLabel(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(new RegExp(`\\.${AGENT_NAME_PARENT.replace(/\./g, '\\.')}$`), '')
      .replace(/\.+$/, '')
      .split('.')[0] ?? ''
  );
}

/** Normalize any name/label to its full `<label>.impact` form (stable storage keys). */
export function toAgentName(nameOrLabel: string): string {
  const n = nameOrLabel.trim().toLowerCase();
  return n.endsWith(`.${AGENT_NAME_PARENT}`) ? n : `${nameLabel(n)}.${AGENT_NAME_PARENT}`;
}

/** SEC-020: positive label-charset gate — names live in the `.impact` subregistry
 *  (`[a-z0-9-]+`); any other character is a sign upstream callers stopped sanitizing. */
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A person's secure-home origin for a label (alice → https://alice.impact-agent.me).
 *  Throws if `label` is not a valid `.impact` subregistry label — SEC-020 closure. */
export function personalAuthOrigin(label: string): string {
  if (!LABEL_RE.test(label)) {
    throw new Error(`personalAuthOrigin: label "${label}" is not a valid .impact subregistry label (${LABEL_RE.source})`);
  }
  return `https://${label}.${CONNECT_DOMAIN}`;
}

/** A member's home origin for JWKS re-verification + `/you` links. NAMELESS members
 *  (credential-first / name-deferral, spec 257) have no `.impact` subdomain yet, so they
 *  resolve to the central platform home instead of throwing — `personalAuthOrigin('')` was
 *  crashing the dashboard. Sync (usable in render). */
export function homeOriginFor(name?: string | null): string {
  const label = name ? nameLabel(name) : '';
  return label && LABEL_RE.test(label) ? personalAuthOrigin(label) : PLATFORM_AUTH_ORIGIN;
}

/** SEC-018: RP-side issuer allowlist. An id_token's `iss` claim is only accepted if
 *  it's a well-formed Connect origin under our deployment's CONNECT_DOMAIN. */
export function isAllowedIssuerOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && !(u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return false;
    if (u.pathname !== '/' && u.pathname !== '') return false;
    if (u.search || u.hash) return false;
    const h = u.hostname.toLowerCase();
    if (h === CONNECT_DOMAIN) return true;
    if (h.endsWith(`.${CONNECT_DOMAIN}`)) {
      const head = h.slice(0, -(CONNECT_DOMAIN.length + 1));
      return LABEL_RE.test(head);
    }
    return h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Display host (no scheme) for the secure home of a name. */
export function personalHome(name: string): string {
  const label = nameLabel(name);
  return label ? `${label}.${CONNECT_DOMAIN}` : `yourname.${CONNECT_DOMAIN}`;
}
