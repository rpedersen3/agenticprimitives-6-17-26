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

/** A person's secure-home origin for a label (alice → https://alice.impact-agent.me). */
export function personalAuthOrigin(label: string): string {
  return `https://${label}.${CONNECT_DOMAIN}`;
}

/** Display host (no scheme) for the secure home of a name. */
export function personalHome(name: string): string {
  const label = nameLabel(name);
  return label ? `${label}.${CONNECT_DOMAIN}` : `yourname.${CONNECT_DOMAIN}`;
}
