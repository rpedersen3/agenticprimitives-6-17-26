// demo-jp's white-label / vertical content (ADR-0021): all Joshua Project + faith copy lives here,
// never in packages. The generic primitives (person/org SA, delegation, attestation, custody) carry
// none of this. Domains/wiring will move to lib/domain.ts when the connect lands (spec 236 P1-wire).

/** Generic SSO-gateway labels consumed by the (shared with demo-org) connect-client machinery.
 *  For demo-jp the gateway IS Impact Community — JP is the program; Impact is the home that holds
 *  the data. Kept separate from `JP` so the JP-only marketing copy stays uncluttered. */
export const GATEWAY = {
  /** What this relying app calls itself in SSO-return copy. */
  appName: 'Joshua Project Adopt',
  /** The trust home users connect to — Impact Community, in our model. */
  community: 'Impact Community',
} as const;

/** Gateway CTA label — kept identical in shape to demo-org's so the shared connect-client renders
 *  correctly. New JP visitors create their Impact Community home; returning members connect. */
export function gatewayCta(name: string, exists: boolean): string {
  if (!name.trim()) return `Connect via ${GATEWAY.community}`;
  return exists ? `Connect via ${GATEWAY.community}` : `Create your ${GATEWAY.community} home`;
}

export const JP = {
  appName: 'Adopt',
  org: 'Joshua Project',
  /** The SSO / identity-and-data custodian — the member's own home. JP runs the adoption program;
   *  Impact Community is where the person's identity, data, and signed agreements live, in a vault
   *  only they can open. (spec 236.) */
  impactName: 'Impact Community',
  /** The SSO step label (parallel to "Continue with Google") that appears inside JP onboarding. */
  ssoCta: 'Connect via Impact Community',
  hero: {
    eyebrow: 'Joshua Project · Frontier People Groups',
    title: 'Adopt a Frontier People Group',
    sub: 'A long-term commitment to one people group — to bless them through prayer and partnership until they have a thriving community of believers.',
    note: 'There is no fee. The commitment is your prayer and persistence.',
  },
  // Illustrative pilot figures (the live "X of N adopted" counter is reproducible from the graph in
  // a later phase — spec 236 P3). N is Joshua Project's Frontier-People-Group total.
  stats: [
    { value: '413', of: '3,215', label: 'Frontier People Groups adopted' },
    { value: '2,802', label: 'still waiting for an adopter' },
    { value: '~2B', label: 'people in unreached FPGs' },
    { value: '<0.1%', label: 'Christ-followers in each' },
  ],
  // The "Five Movements of Adoption" (ADOPT).
  movements: [
    { k: 'A', title: 'Awaken', body: 'See the realities of Frontier People Groups — the least-reached peoples on earth.' },
    { k: 'D', title: 'Decide', body: 'Choose to adopt one or more groups as a sustained, long-term commitment.' },
    { k: 'O', title: 'Orient', body: 'Learn their world, beliefs, and lives so your prayer and action are informed.' },
    { k: 'P', title: 'Pray', body: 'Pray consistently and strategically, and unite your prayers with others.' },
    { k: 'T', title: 'Team up & take action', body: 'Partner with organizations already serving among them — you don’t adopt alone.' },
  ],
  paths: {
    adopter: {
      title: 'Adopt a people group',
      who: 'Individuals · small groups · churches · organizations · networks',
      body: 'Commit to one Frontier People Group through prayer, learning, and engagement. Track progress over time and explore partnership opportunities.',
      cta: 'Start adoption',
      // The first step is the SSO; the rest is JP's program. The data flows into the member's
      // Impact Community vault — JP only gets the scoped access (and attestations) it needs.
      steps: [
        'Connect via Impact Community — your identity and a private vault, set up in one step.',
        'If adopting as a church/org/network: set up your organization (held in your vault).',
        'Add your contact profile, and your organization’s profile, to your vault.',
        'Sign the ADOPT Memorandum of Understanding (and the WEA Statement of Faith for orgs/networks) — held in your vault, JP receives the attestation.',
        'Declare your adoption of a Frontier People Group — and choose whether to be matched with a facilitator.',
      ],
    },
    facilitator: {
      title: 'Facilitate adoptions',
      who: 'Mission organizations · networks already serving on the field',
      body: 'You’re already on the field. Connect with committed adopters: declare your coverage and capacity, and provide quarterly updates to the prayer partners matched with you.',
      cta: 'Register as a facilitator',
      steps: [
        'Connect via Impact Community — your identity and a private vault.',
        'Set up your facilitator organization (held in your vault).',
        'Add your organization profile and capacity (people groups, adopter types, size bands, ministry areas) — into your vault.',
        'Sign the ADOPT MOU and the WEA Statement of Faith as a named signatory — held in your vault, JP receives the attestation.',
        'Declare facilitator coverage for the people groups you serve.',
      ],
    },
  },
  // The differentiator vs. a plain form: JP runs the program; Impact Community holds your data in
  // a vault you alone can open. JP only sees what you grant — and you can revoke anytime.
  trust: {
    title: 'JP runs the program. Your home holds the data.',
    points: [
      'JP owns the adoption program and your relationship with it — the brokerage, the people-group commitments, the matches.',
      'Your identity, contact details, organization profile, and signed agreements live in your own Impact Community vault — a private store only your home credentials can open. Not JP. Not even Impact.',
      'You sign the ADOPT MOU and WEA Statement of Faith inside your vault; JP receives only the attestation that you signed, not the document itself.',
      'JP gets a scoped, revocable delegation to the specific data you grant — name, contact, signatory authority. Disconnect anytime and JP’s visibility goes to zero.',
      'One home, reusable across the mission community. JP carries no data liability; you stay in control of every disclosure.',
    ],
  },
  mou: {
    name: 'ADOPT Memorandum of Understanding',
    blurb: 'A shared understanding of the adoption commitment — prayer, staying informed, and tracking progress over time.',
  },
  wea: {
    name: 'WEA Statement of Faith',
    blurb: 'The World Evangelical Alliance Statement of Faith, affirmed by organizations and networks.',
  },
} as const;
