// Seed Frontier People Groups for the demo. JP publishes the canonical list (PeopleID3 /
// PGAC), pulled live in a later phase (spec 236 P3, open Q: id scheme). For the prototype,
// a fixed seed of 10 well-known FPGs with public-domain demographic figures lets us
// demonstrate the "pick + declare" flow without depending on a live import.
//
// All entries are publicly published as Frontier groups (<0.1% Christ-followers and no
// indigenous Christian movement). Populations are rounded to indicate magnitude only.

export interface PeopleGroup {
  /** Stable id within this demo (replace with PeopleID3 / PGAC in production). */
  id: string;
  name: string;
  country: string;
  region: 'MENA' | 'Central Asia' | 'South Asia' | 'East Asia' | 'Southeast Asia' | 'Sub-Saharan Africa';
  populationApprox: number;
  religion: string;
}

export const FPG_SEED: PeopleGroup[] = [
  { id: 'fpg-najdi-sa', name: 'Bedouin, Najdi', country: 'Saudi Arabia', region: 'MENA', populationApprox: 1900000, religion: 'Islam (Sunni)' },
  { id: 'fpg-kabyle-dz', name: 'Kabyle Berber', country: 'Algeria', region: 'MENA', populationApprox: 6500000, religion: 'Islam (Sunni)' },
  { id: 'fpg-uyghur-cn', name: 'Uyghur', country: 'China', region: 'Central Asia', populationApprox: 12000000, religion: 'Islam (Sunni)' },
  { id: 'fpg-somali-so', name: 'Somali', country: 'Somalia', region: 'Sub-Saharan Africa', populationApprox: 11000000, religion: 'Islam (Sunni)' },
  { id: 'fpg-sindhi-pk', name: 'Sindhi', country: 'Pakistan', region: 'South Asia', populationApprox: 33000000, religion: 'Islam (Sunni)' },
  { id: 'fpg-pashtun-af', name: 'Pashtun, Southern', country: 'Afghanistan', region: 'Central Asia', populationApprox: 17000000, religion: 'Islam (Sunni)' },
  { id: 'fpg-tibetan-cn', name: 'Tibetan, Central', country: 'China', region: 'East Asia', populationApprox: 1500000, religion: 'Tibetan Buddhism' },
  { id: 'fpg-wolof-sn', name: 'Wolof', country: 'Senegal', region: 'Sub-Saharan Africa', populationApprox: 5800000, religion: 'Islam (Sunni)' },
  { id: 'fpg-hui-cn', name: 'Hui', country: 'China', region: 'East Asia', populationApprox: 14000000, religion: 'Islam (Sunni)' },
  { id: 'fpg-maldivian-mv', name: 'Maldivian', country: 'Maldives', region: 'South Asia', populationApprox: 460000, religion: 'Islam (Sunni)' },
];

export function findPeopleGroup(id: string): PeopleGroup | undefined {
  return FPG_SEED.find((g) => g.id === id);
}

/** Round-down "X.Y million / thousand" for compact display. */
export function formatPopulation(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
