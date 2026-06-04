// Mocked Global Switchboard taxonomy (spec 250 §7). v1 ships canonical URI SHAPES with
// fixture data; Phase 3 swaps in the real registry/C-Box adapter. The 22-category / 193-skill
// vocabulary is represented here by a demo subset — enough to drive matching + the golden path.
// RULE: a SkillRef cites a gcUri (identity); labels are display only.

import { computeSkillId } from '@agenticprimitives/agent-skills';
import { computeFeatureId } from '@agenticprimitives/geo-features';
import type { CauseRef, GeoFacet, LanguageRef, SkillRef, Uri } from '../domain/gs-types';

const SKILL_BASE = 'https://registry.global.church/skills/switchboard/';
const CAT_BASE = 'https://registry.global.church/skill-categories/switchboard/';
const CAUSE_BASE = 'https://registry.global.church/causes/';
const REGION_BASE = 'https://registry.global.church/regions/';
const CBOX_BASE = 'https://cbox.global.church/capability/';

export interface SkillCategory { uri: Uri; label: string }

export const SKILL_CATEGORIES: SkillCategory[] = [
  { uri: `${CAT_BASE}fundraising-development`, label: 'Fundraising & Development' },
  { uri: `${CAT_BASE}media-communications`, label: 'Media & Communications' },
  { uri: `${CAT_BASE}technology-data`, label: 'Technology & Data' },
  { uri: `${CAT_BASE}leadership-coaching`, label: 'Leadership & Coaching' },
  { uri: `${CAT_BASE}translation-language`, label: 'Translation & Language' },
  { uri: `${CAT_BASE}theological-training`, label: 'Theological Training' },
  { uri: `${CAT_BASE}operations-finance`, label: 'Operations & Finance' },
  { uri: `${CAT_BASE}research-strategy`, label: 'Research & Strategy' },
];

interface SkillSeed { slug: string; label: string; cat: string; cbox?: boolean }

const SKILL_SEEDS: SkillSeed[] = [
  // Fundraising & Development
  { slug: 'grant-writing', label: 'Grant Writing', cat: 'fundraising-development', cbox: true },
  { slug: 'donor-communications', label: 'Donor Communications', cat: 'fundraising-development' },
  { slug: 'proposal-budgeting', label: 'Proposal Budgeting', cat: 'fundraising-development' },
  { slug: 'major-gifts-strategy', label: 'Major Gifts Strategy', cat: 'fundraising-development' },
  // Media & Communications
  { slug: 'video-production', label: 'Video Production', cat: 'media-communications' },
  { slug: 'graphic-design', label: 'Graphic Design', cat: 'media-communications' },
  { slug: 'social-media-strategy', label: 'Social Media Strategy', cat: 'media-communications' },
  { slug: 'copywriting', label: 'Copywriting', cat: 'media-communications' },
  // Technology & Data
  { slug: 'web-development', label: 'Web Development', cat: 'technology-data', cbox: true },
  { slug: 'mobile-development', label: 'Mobile App Development', cat: 'technology-data' },
  { slug: 'data-analysis', label: 'Data Analysis', cat: 'technology-data' },
  { slug: 'cybersecurity', label: 'Cybersecurity', cat: 'technology-data' },
  { slug: 'gis-mapping', label: 'GIS / Mapping', cat: 'technology-data' },
  // Leadership & Coaching
  { slug: 'executive-coaching', label: 'Executive Coaching', cat: 'leadership-coaching' },
  { slug: 'team-development', label: 'Team Development', cat: 'leadership-coaching' },
  { slug: 'conflict-resolution', label: 'Conflict Resolution', cat: 'leadership-coaching' },
  // Translation & Language
  { slug: 'bible-translation', label: 'Bible Translation', cat: 'translation-language', cbox: true },
  { slug: 'document-translation', label: 'Document Translation', cat: 'translation-language' },
  { slug: 'interpretation', label: 'Interpretation', cat: 'translation-language' },
  // Theological Training
  { slug: 'curriculum-design', label: 'Curriculum Design', cat: 'theological-training' },
  { slug: 'discipleship-training', label: 'Discipleship Training', cat: 'theological-training' },
  { slug: 'theological-education', label: 'Theological Education', cat: 'theological-training' },
  // Operations & Finance
  { slug: 'accounting', label: 'Nonprofit Accounting', cat: 'operations-finance' },
  { slug: 'hr-policy', label: 'HR & Policy', cat: 'operations-finance' },
  { slug: 'legal-compliance', label: 'Legal & Compliance', cat: 'operations-finance' },
  { slug: 'project-management', label: 'Project Management', cat: 'operations-finance' },
  // Research & Strategy
  { slug: 'people-group-research', label: 'People Group Research', cat: 'research-strategy' },
  { slug: 'monitoring-evaluation', label: 'Monitoring & Evaluation', cat: 'research-strategy' },
  { slug: 'strategic-planning', label: 'Strategic Planning', cat: 'research-strategy' },
];

function buildSkill(seed: SkillSeed): SkillRef {
  const gcUri = `${SKILL_BASE}${seed.slug}`;
  return {
    gcUri,
    // Anchor to the canonical substrate id (keccak of the registry key) — what an on-chain
    // SkillDefinitionRegistry entry + a SkillClaimCredential would key on.
    skillId: computeSkillId(gcUri),
    label: seed.label,
    categoryUri: `${CAT_BASE}${seed.cat}`,
    cboxUri: seed.cbox ? `${CBOX_BASE}${seed.slug}` : undefined,
    source: 'switchboard',
  };
}

export const SKILLS: SkillRef[] = SKILL_SEEDS.map(buildSkill);
const SKILL_BY_URI = new Map(SKILLS.map((s) => [s.gcUri, s]));

export function skillByUri(uri: Uri): SkillRef | undefined {
  return SKILL_BY_URI.get(uri);
}
export function skillBySlug(slug: string): SkillRef {
  const s = SKILL_BY_URI.get(`${SKILL_BASE}${slug}`);
  if (!s) throw new Error(`unknown skill slug: ${slug}`);
  return s;
}
export function skillsInCategory(categoryUri: Uri): SkillRef[] {
  return SKILLS.filter((s) => s.categoryUri === categoryUri);
}
export function categoryLabel(uri: Uri): string {
  return SKILL_CATEGORIES.find((c) => c.uri === uri)?.label ?? uri;
}

export const CAUSES: CauseRef[] = [
  { uri: `${CAUSE_BASE}disciple-making`, label: 'Disciple Making' },
  { uri: `${CAUSE_BASE}church-planting`, label: 'Church Planting' },
  { uri: `${CAUSE_BASE}bible-translation`, label: 'Bible Translation' },
  { uri: `${CAUSE_BASE}humanitarian-relief`, label: 'Humanitarian Relief' },
  { uri: `${CAUSE_BASE}leadership-development`, label: 'Leadership Development' },
  { uri: `${CAUSE_BASE}youth-children`, label: 'Youth & Children' },
  { uri: `${CAUSE_BASE}orality-media`, label: 'Orality & Media' },
];
export function causeByUri(uri: Uri): CauseRef | undefined {
  return CAUSES.find((c) => c.uri === uri);
}

/** Passion regions (coarse). A `parentUri` chains a country/region into a broader region for
 *  related-geo scoring + redaction; `sensitivity` collapses sensitive regions in public views. */
/** Build a region GeoFacet anchored to its canonical substrate feature id. */
function geo(g: Omit<GeoFacet, 'featureId'>): GeoFacet {
  return { ...g, featureId: computeFeatureId(g.uri) };
}
export const REGIONS: GeoFacet[] = [
  geo({ uri: `${REGION_BASE}north-africa`, label: 'North Africa', level: 'region', sensitivity: 'creative_access' }),
  geo({ uri: `${REGION_BASE}middle-east`, label: 'Middle East', level: 'region', sensitivity: 'creative_access' }),
  geo({ uri: `${REGION_BASE}sub-saharan-africa`, label: 'Sub-Saharan Africa', level: 'region' }),
  geo({ uri: `${REGION_BASE}south-asia`, label: 'South Asia', level: 'region' }),
  geo({ uri: `${REGION_BASE}southeast-asia`, label: 'Southeast Asia', level: 'region' }),
  geo({ uri: `${REGION_BASE}east-asia`, label: 'East Asia', level: 'region' }),
  geo({ uri: `${REGION_BASE}latin-america`, label: 'Latin America', level: 'region' }),
  geo({ uri: `${REGION_BASE}europe`, label: 'Europe', level: 'region' }),
  geo({ uri: `${REGION_BASE}global`, label: 'Global / Remote', level: 'global' }),
];
export function regionByUri(uri: Uri): GeoFacet | undefined {
  return REGIONS.find((r) => r.uri === uri);
}

export const LANGUAGES: LanguageRef[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'hi', label: 'Hindi' },
  { code: 'zh', label: 'Mandarin' },
];
