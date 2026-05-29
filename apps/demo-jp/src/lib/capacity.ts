// Labeled options for the facilitator capacity matrix. Each option has a user-facing
// label + a short blurb explaining what it means in context. These are JP-program
// vocabularies (ADR-0021 — vertical content stays in the app).

import type { FacilitatorAdopterType, FacilitatorMinistryArea, FacilitatorSizeBand } from './vault';

export interface CapacityOption<K extends string> {
  key: K;
  label: string;
  blurb: string;
}

export const ADOPTER_TYPE_OPTIONS_FAC: CapacityOption<FacilitatorAdopterType>[] = [
  { key: 'individual',   label: 'Individuals',         blurb: 'Solo adopters.' },
  { key: 'family',       label: 'Families',            blurb: 'Households adopting together.' },
  { key: 'group',        label: 'Small groups',        blurb: 'A few people praying as one.' },
  { key: 'church',       label: 'Churches',            blurb: 'Local congregations.' },
  { key: 'organization', label: 'Organizations',       blurb: 'Ministries, agencies, other orgs.' },
  { key: 'network',      label: 'Networks',            blurb: 'Networks of churches or orgs.' },
];

export const SIZE_BAND_OPTIONS: CapacityOption<FacilitatorSizeBand>[] = [
  { key: 'small',   label: 'Small',   blurb: 'Up to ~25 adopters at a time.' },
  { key: 'medium',  label: 'Medium',  blurb: '~25–200 adopters at a time.' },
  { key: 'large',   label: 'Large',   blurb: '~200–1,000 adopters at a time.' },
  { key: 'network', label: 'Network', blurb: 'Network-scale coordination across orgs.' },
];

export const MINISTRY_AREA_OPTIONS: CapacityOption<FacilitatorMinistryArea>[] = [
  { key: 'prayer-mobilization',     label: 'Prayer mobilization',     blurb: 'Equipping prayer partners on the ground.' },
  { key: 'bible-translation',       label: 'Bible translation',       blurb: 'Translation, distribution, oral storying.' },
  { key: 'leadership-development',  label: 'Leadership development',  blurb: 'Discipling local leaders.' },
  { key: 'church-planting',         label: 'Church planting',         blurb: 'Catalyzing new communities of believers.' },
  { key: 'health',                  label: 'Health',                  blurb: 'Medical, mental, maternal, public-health work.' },
  { key: 'education',               label: 'Education',               blurb: 'Schools, training centers, scholarships.' },
  { key: 'business-as-mission',     label: 'Business as mission',     blurb: 'Sustainable enterprise as the doorway.' },
  { key: 'community-development',   label: 'Community development',   blurb: 'Water, food security, livelihoods.' },
  { key: 'media',                   label: 'Media',                   blurb: 'Radio, film, digital content.' },
];

export const FACILITATOR_ADOPTER_TYPE_LABEL: Record<FacilitatorAdopterType, string> = Object.fromEntries(
  ADOPTER_TYPE_OPTIONS_FAC.map((o) => [o.key, o.label]),
) as Record<FacilitatorAdopterType, string>;

export const SIZE_BAND_LABEL: Record<FacilitatorSizeBand, string> = Object.fromEntries(
  SIZE_BAND_OPTIONS.map((o) => [o.key, o.label]),
) as Record<FacilitatorSizeBand, string>;

export const MINISTRY_AREA_LABEL: Record<FacilitatorMinistryArea, string> = Object.fromEntries(
  MINISTRY_AREA_OPTIONS.map((o) => [o.key, o.label]),
) as Record<FacilitatorMinistryArea, string>;
