// Sample EXTERNAL Global Switchboard "Role" postings — the SOURCE side of the Pattern-A read
// bridge (spec 250 §"Deferred", pilot doc). These are shaped the way Switchboard publishes them
// (its OWN field names + taxonomy slugs), NOT our gc:Need shape — the whole point of the bridge is
// to translate one to the other against the shared 22-cat/193-skill SKOS vocabulary. v1 ships a
// representative fixture set; a live bridge would GET these read-only from the Switchboard API.
//
// Deliberately exercises all three ETL outcomes: exact-slug matches, alias matches (Switchboard
// vocab drift), and an unmapped skill that must be SURFACED, never silently dropped.

/** A Switchboard Role posting as Switchboard publishes it (read-only source record). */
export interface SwitchboardRole {
  id: string;
  title: string;
  summary: string;
  /** Switchboard engagement vocabulary (maps to our NeedKind). */
  engagementType: 'discussion' | 'project' | 'role' | 'inquiry' | string;
  organization: { name: string; id?: string };
  /** Switchboard skill slugs (its taxonomy keys) — some align with ours, some are aliases. */
  skills: string[];
  /** Switchboard region slug/label (maps to a canonical GeoFeature). */
  region?: string;
  /** Switchboard cause slug. */
  cause?: string;
  /** ISO language codes or labels. */
  languages?: string[];
  commitment?: { hoursPerWeek?: number; weeks?: number; cadence?: string };
  /** Contact released to the counterparty only on accept (our confidential tier). */
  contactEmail?: string;
  postedAt: string;
  /** Canonical Switchboard URL — becomes the Need's provenance sourceUri. */
  url?: string;
}

export const SWITCHBOARD_ROLES: SwitchboardRole[] = [
  {
    id: 'SBR-1042',
    title: 'Grant strategist for a Sahel literacy + discipleship initiative',
    summary: 'Seeking help shaping a multi-year foundation proposal and budget for a funded pilot.',
    engagementType: 'project',
    organization: { name: 'Sahel Hope Network', id: 'sb-org-228' },
    skills: ['grant-writing', 'proposal-budgeting'], // exact-slug matches
    region: 'ssa', // alias → sub-saharan-africa
    cause: 'disciple-making',
    languages: ['en', 'fr'],
    commitment: { hoursPerWeek: 3, weeks: 16, cadence: 'weekly' },
    contactEmail: 'partnerships@sahelhope.example',
    postedAt: '2026-05-20T00:00:00Z',
    url: 'https://switchboard.global.church/roles/SBR-1042',
  },
  {
    id: 'SBR-1077',
    title: 'Videographer for a Southeast Asia church-planting story',
    summary: 'Short documentary on a movement reaching unreached communities; ~3 week shoot + edit.',
    engagementType: 'project',
    organization: { name: 'Frontier Media Collective' },
    skills: ['videography', 'graphic-design'], // 'videography' → alias of video-production
    region: 'southeast-asia', // exact
    cause: 'church-planting',
    languages: ['en'],
    commitment: { cadence: 'once' },
    postedAt: '2026-05-24T00:00:00Z',
    url: 'https://switchboard.global.church/roles/SBR-1077',
  },
  {
    id: 'SBR-1090',
    title: 'Arabic translator for discipleship curriculum',
    summary: 'Ongoing translation + review of a discipleship curriculum into Modern Standard Arabic.',
    engagementType: 'role',
    organization: { name: 'Cedar Discipleship Trust' },
    skills: ['translation', 'discipleship-training'], // 'translation' → alias of document-translation
    region: 'mena', // alias → middle-east (creative-access → coarsened to confidential)
    cause: 'disciple-making',
    languages: ['ar', 'en'],
    commitment: { cadence: 'ongoing' },
    contactEmail: 'projects@cedartrust.example',
    postedAt: '2026-05-26T00:00:00Z',
    url: 'https://switchboard.global.church/roles/SBR-1090',
  },
  {
    id: 'SBR-1101',
    title: 'Web platform build for a leadership-development network',
    summary: 'Build a cohort platform + light data dashboard for a multi-country leaders network.',
    engagementType: 'project',
    organization: { name: 'Catalyst Leaders Alliance' },
    skills: ['webdev', 'data-analysis', 'prayer-mobilization'], // 'webdev' alias; 'prayer-mobilization' UNMAPPED
    region: 'remote', // alias → global
    cause: 'leadership-development',
    languages: ['en', 'es'],
    commitment: { hoursPerWeek: 10, weeks: 20, cadence: 'weekly' },
    postedAt: '2026-05-28T00:00:00Z',
    url: 'https://switchboard.global.church/roles/SBR-1101',
  },
];
