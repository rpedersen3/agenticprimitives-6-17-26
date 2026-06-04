// TEST-ONLY sample needs/offerings (Wave 2: the app no longer ships in-app sample identities or seed
// data — member data lives in member vaults. These inline fixtures feed the PURE-LOGIC unit tests
// (projection / scoring / signal) so they keep exercising the golden grant-writing path without any
// vault/Connect dependency. NOT imported by app code — only by `*.test.ts`.)

import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent } from '../../domain/gs-types';
import { CAUSES, LANGUAGES, REGIONS, skillBySlug } from '../taxonomy';
import { caip10 } from '../../lib/personas';

const T0 = '2026-06-01T00:00:00Z';
const region = (slug: string) => REGIONS.find((r) => r.uri.endsWith(slug))!;
const cause = (slug: string) => CAUSES.find((c) => c.uri.endsWith(slug))!;
const lang = (code: string) => LANGUAGES.find((l) => l.code === code)!;

// Deterministic pseudo-agents — test scaffolding only (no real SA).
export const TEST_GCO_ORG: Address = '0xaAaA000000000000000000000000000000000001';
export const TEST_GCO_PERSON: Address = '0xaAaA000000000000000000000000000000000002';
export const TEST_KC: Address = '0xaAaA000000000000000000000000000000000003';
const KC_VIDEO: Address = '0x1111111111111111111111111111111111111111';
const KC_TRANSLATE: Address = '0x2222222222222222222222222222222222222222';
const KC_WEB: Address = '0x3333333333333333333333333333333333333333';
const KC_COACH: Address = '0x4444444444444444444444444444444444444444';

export const SEED_NEEDS: GcoNeedIntent[] = [
  {
    id: 'gc:need:demo-gs:grant-writing-na-001',
    ownerOrgAgentId: caip10(TEST_GCO_ORG),
    createdByPersonAgentId: caip10(TEST_GCO_PERSON),
    title: 'Grant writing help for a North Africa disciple-making project',
    description: 'We have a funded pilot to scale but need help shaping a foundation proposal + budget.',
    needKind: 'project',
    requiredSkills: [skillBySlug('grant-writing')],
    desiredSkills: [skillBySlug('proposal-budgeting')],
    geoFacets: [region('north-africa')],
    causeFacets: [cause('disciple-making')],
    languages: [lang('en'), lang('fr')],
    commitment: { hours: 2, cadence: 'weekly', durationWeeks: 12 },
    visibility: 'public',
    confidentialContact: 'partnerships@na-dmn.example (confidential)',
    status: 'open',
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: 'gc:need:demo-gs:video-sea-002',
    ownerOrgAgentId: caip10(TEST_GCO_ORG),
    createdByPersonAgentId: caip10(TEST_GCO_PERSON),
    title: 'Short documentary on a Southeast Asia church-planting movement',
    needKind: 'project',
    requiredSkills: [skillBySlug('video-production')],
    geoFacets: [region('southeast-asia')],
    causeFacets: [cause('church-planting')],
    languages: [lang('en')],
    commitment: { cadence: 'once', notes: '~3 week shoot + edit' },
    visibility: 'public',
    status: 'open',
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: 'gc:need:demo-gs:translate-me-003',
    ownerOrgAgentId: caip10(TEST_GCO_ORG),
    createdByPersonAgentId: caip10(TEST_GCO_PERSON),
    title: 'Arabic translation of discipleship curriculum',
    needKind: 'role',
    requiredSkills: [skillBySlug('document-translation')],
    desiredSkills: [skillBySlug('discipleship-training')],
    geoFacets: [region('middle-east')],
    causeFacets: [cause('disciple-making')],
    languages: [lang('ar'), lang('en')],
    commitment: { cadence: 'ongoing' },
    visibility: 'confidential',
    status: 'open',
    createdAt: T0,
    updatedAt: T0,
  },
];

export const SEED_OFFERINGS: ExpertOffering[] = [
  {
    id: 'gc:offering:demo-gs:kc-grant-writing-001',
    ownerPersonAgentId: caip10(TEST_KC),
    displayName: 'Dana',
    headline: 'Grant writing and foundation strategy for mission organizations',
    offeredSkills: [skillBySlug('grant-writing'), skillBySlug('donor-communications'), skillBySlug('proposal-budgeting')],
    geoFacets: [region('north-africa'), region('sub-saharan-africa')],
    causeFacets: [cause('disciple-making')],
    languages: [lang('en'), lang('fr')],
    capacity: { availabilityStatus: 'limited', estimatedHoursPerMonth: 8, maxActiveAgreements: 2 },
    evidence: [
      { id: 'ev:dana:1', kind: 'case_study', label: '$250k raised for an SSA literacy program', visibility: 'public' },
      { id: 'ev:dana:2', kind: 'prior_agreement', label: '3 prior fulfilled Switchboard connections', visibility: 'confidential' },
    ],
    confidentialContact: 'dana@grant-strategy.example (confidential)',
    visibility: 'public-summary',
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: 'gc:offering:demo-gs:kc-video-002',
    ownerPersonAgentId: caip10(KC_VIDEO),
    displayName: 'Marco',
    headline: 'Documentary + short-form video for frontier missions',
    offeredSkills: [skillBySlug('video-production'), skillBySlug('graphic-design')],
    geoFacets: [region('southeast-asia'), region('east-asia')],
    causeFacets: [cause('orality-media'), cause('church-planting')],
    languages: [lang('en'), lang('zh')],
    capacity: { availabilityStatus: 'available', estimatedHoursPerMonth: 20 },
    evidence: [{ id: 'ev:marco:1', kind: 'endorsement', label: 'Endorsed by a regional media network', visibility: 'public' }],
    visibility: 'public-summary',
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: 'gc:offering:demo-gs:kc-translate-003',
    ownerPersonAgentId: caip10(KC_TRANSLATE),
    displayName: 'Leila',
    headline: 'Arabic document translation + interpretation',
    offeredSkills: [skillBySlug('document-translation'), skillBySlug('interpretation')],
    geoFacets: [region('middle-east'), region('north-africa')],
    causeFacets: [cause('disciple-making')],
    languages: [lang('ar'), lang('en'), lang('fr')],
    capacity: { availabilityStatus: 'available', estimatedHoursPerMonth: 30 },
    evidence: [{ id: 'ev:leila:1', kind: 'self_claim', label: 'Native Arabic; 6 yrs translation', visibility: 'public' }],
    visibility: 'public-summary',
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: 'gc:offering:demo-gs:kc-web-004',
    ownerPersonAgentId: caip10(KC_WEB),
    displayName: 'Sam',
    headline: 'Web + mobile builds for ministries',
    offeredSkills: [skillBySlug('web-development'), skillBySlug('mobile-development'), skillBySlug('data-analysis')],
    geoFacets: [REGIONS.find((r) => r.uri.endsWith('global'))!],
    causeFacets: [cause('leadership-development')],
    languages: [lang('en'), lang('es')],
    capacity: { availabilityStatus: 'available', estimatedHoursPerMonth: 40 },
    visibility: 'public-summary',
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: 'gc:offering:demo-gs:kc-coach-005',
    ownerPersonAgentId: caip10(KC_COACH),
    displayName: 'Grace',
    headline: 'Leadership coaching + team development',
    offeredSkills: [skillBySlug('executive-coaching'), skillBySlug('team-development'), skillBySlug('conflict-resolution')],
    geoFacets: [region('sub-saharan-africa'), region('south-asia')],
    causeFacets: [cause('leadership-development')],
    languages: [lang('en'), lang('sw')],
    capacity: { availabilityStatus: 'limited', estimatedHoursPerMonth: 6 },
    evidence: [{ id: 'ev:grace:1', kind: 'credential', label: 'ICF-certified coach', visibility: 'public' }],
    visibility: 'public-summary',
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  },
];
