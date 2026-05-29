// demo-jp's white-label / vertical content (ADR-0021): all Joshua Project + faith copy lives here,
// never in packages. The generic primitives (person/org SA, delegation, attestation, custody) carry
// none of this. Domains/wiring will move to lib/domain.ts when the connect lands (spec 236 P1-wire).

export const JP = {
  appName: 'Adopt',
  org: 'Joshua Project',
  /** Where the member's identity, data, and signed agreements actually live (spec 236). */
  impactName: 'Impact',
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
      cta: 'Adopt with Impact',
      steps: [
        'Connect with your Impact home (or create one) — your secure identity.',
        'If adopting as a church/org/network: create your organization in Impact.',
        'Add your personal profile, and your organization’s profile, in Impact.',
        'Sign the ADOPT Memorandum of Understanding (and the WEA Statement of Faith for orgs/networks).',
        'Declare your adoption of a Frontier People Group — and choose whether to connect with a facilitator.',
      ],
    },
    facilitator: {
      title: 'Facilitate adoptions',
      who: 'Mission organizations · networks already serving on the field',
      body: 'You’re already on the field. Connect with committed adopters: declare your coverage and capacity, and provide quarterly updates to the prayer partners matched with you.',
      cta: 'Facilitate with Impact',
      steps: [
        'Connect with your Impact home (or create one).',
        'Create or claim your facilitator organization in Impact.',
        'Add your organization profile and capacity (people groups, adopter types, size bands, ministry areas).',
        'Sign the ADOPT MOU and the WEA Statement of Faith as a named signatory.',
        'Declare facilitator coverage for the people groups you serve.',
      ],
    },
  },
  // The differentiator vs. a plain form: your data + agreements are yours, held in your own home.
  trust: {
    title: 'Your identity and data stay yours',
    points: [
      'Your identity, personal profile, and organization data live in your own secure Impact home — not in this site’s database.',
      'You sign the ADOPT MOU and WEA Statement of Faith inside Impact; the signed agreements are held there, with you.',
      'This site only receives a scoped, revocable delegation to the data you approve — and an attestation that you signed. You can revoke it anytime.',
      'Adopting through Impact means one trusted home you reuse across the mission community, with a clear, auditable trail of who agreed to what, and when.',
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
