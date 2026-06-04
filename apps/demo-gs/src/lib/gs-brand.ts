// demo-gs white-label / vertical copy (ADR-0021) — all Global Switchboard + Great-Commission copy
// lives here, never in packages. Mirrors demo-jp/src/lib/brand.ts. The generic primitives
// (person/org SA, skill/geo definitions + claims, delegation) carry none of this.

/** SSO-gateway labels consumed by the shared connect-client machinery. The gateway is
 *  Global.Church — Switchboard is the marketplace; Global.Church is the home that holds identity. */
export const GATEWAY = {
  appName: 'Global Switchboard',
  community: 'Global.Church',
  ssoCta: 'Connect via Global.Church',
} as const;

export type OnboardKind = 'gco' | 'kc';

export interface OnboardPath {
  title: string;
  who: string;
  body: string;
  cta: string;
  steps: string[];
}

export const GS = {
  org: 'Global Switchboard',
  community: 'Global.Church',
  ssoCta: GATEWAY.ssoCta,
  paths: {
    gco: {
      title: 'Register a Great Commission Organization',
      who: 'Mission organizations · churches · networks with a skill or capability gap',
      body: 'You have a ministry gap. Set up your organization, declare what skill or capability you need — where, and for what cause — and Global Switchboard matches you with a Kingdom Consultant who can serve.',
      cta: 'Register a GCO organization',
      steps: [
        'Connect via Global.Church — your identity and a private vault, set up in one step.',
        'Set up your organization — the org that takes the GCO (Great Commission Organization) role; held in your vault, custodied by your credential.',
        'Add your organization profile + a contact released only when a connection is accepted.',
        'Post a skill Need — the skill(s) required, region, cause, languages, and commitment.',
        'Review explainable matches and request a connection with a Kingdom Consultant.',
      ],
    } satisfies OnboardPath,
    kc: {
      title: 'Register as a Kingdom Consultant',
      who: 'Kingdom Consultants · individuals serving the Great Commission with a skill',
      body: 'You have a skill to offer. Publish an expertise profile and Global Switchboard matches you with Great Commission Organizations that need exactly what you can serve with.',
      cta: 'Register as a KC expert',
      steps: [
        'Connect via Global.Church — your identity and a private vault.',
        'A KC is an individual — no organization to set up; you act as your own person agent.',
        'Publish your expertise Offering — the skills you serve with, regions, causes, languages, availability, evidence.',
        'Your skills become vault-resident claim credentials pointing to the on-chain skill registry.',
        'Review + accept connection requests; your contact is released only on an accepted connection.',
      ],
    } satisfies OnboardPath,
  },
  trust: {
    title: 'Switchboard runs the marketplace. Your home holds the data.',
    points: [
      'Global Switchboard brokers + explains matches; it never becomes the long-term owner of your identity or relationship.',
      'Your identity, organization profile, and skill/coverage claims live in your own Global.Church vault — a private store only your home credentials can open.',
      'Skills + geo are public, neutral definitions on chain; the fact that YOU have a skill / serve a region is a private vault credential pointing to them.',
      'Switchboard gets a scoped, revocable delegation to the specific data you grant; disconnect anytime and its visibility goes to zero.',
      'One home, reusable across the mission ecosystem — sign up once at Global.Church and tap into Switchboard (and other marketplaces) already identified.',
    ],
  },
} as const;
