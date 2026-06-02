// Persona-switching state (Wave 8.13, IA §8).
//
// demo-jp now has six personas. Two are *operator* personas backed by a stored
// EOA (Pete custodies Global Church / the issuer; Jill custodies JP / the
// broker) — swap-only, no SSO (D-10). Four are *member* personas reached via
// the existing Impact SSO session (adopter / facilitator) plus their org views.
//
// The active persona drives which surface App.tsx renders. Operator personas
// short-circuit the SSO flow entirely; member personas preserve it.

export type Persona =
  | 'pete' // Global Church custodian — the issuer operator
  | 'jill' // JP custodian — the broker operator
  | 'adopter' // member: adopter intranet (SSO) — creates + acts as their org
  | 'facilitator'; // member: facilitator intranet (SSO) — creates + acts as their org

export const OPERATOR_PERSONAS: Persona[] = ['pete', 'jill'];
// Org views are NOT public personas — a connected adopter/facilitator creates +
// acts as their org inside the member dashboard (not via the persona bar).
export const MEMBER_PERSONAS: Persona[] = ['adopter', 'facilitator'];

export function isOperator(p: Persona): boolean {
  return OPERATOR_PERSONAS.includes(p);
}

export interface PersonaMeta {
  persona: Persona;
  label: string;
  org: string;
  blurb: string;
  glyph: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  pete: {
    persona: 'pete',
    label: 'Pete',
    org: 'Global Church (issuer)',
    blurb: 'Custodian of the issuing org. Issues AgreementCredentials + registers commitments.',
    glyph: '⛪',
  },
  jill: {
    persona: 'jill',
    label: 'Jill',
    org: 'JP (broker)',
    blurb: 'Custodian of the broker org. Sees intents, runs matches, issues Associations.',
    glyph: '🛰️',
  },
  adopter: {
    persona: 'adopter',
    label: 'Adopter',
    org: 'Member',
    blurb: 'A member adopting a people group via their Impact home.',
    glyph: '🙏',
  },
  facilitator: {
    persona: 'facilitator',
    label: 'Facilitator',
    org: 'Member',
    blurb: 'A member facilitating adoptions — connect, then create + act as your org.',
    glyph: '🤝',
  },
};

const KEY = 'agenticprimitives:demo-jp:persona';

export function loadPersona(): Persona | null {
  if (typeof localStorage === 'undefined') return null;
  const v = localStorage.getItem(KEY) as Persona | null;
  return v && v in PERSONA_META ? v : null;
}

export function savePersona(p: Persona): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, p);
}

export function clearPersona(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
