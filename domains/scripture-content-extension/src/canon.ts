// The Bible canon as reference data (OSIS book codes — the industry standard).
// This is generic scripture-domain data, not a specific translation and not
// rendering text (ADR-0033 R1/R3). It lives in this vertical EXTENSION package,
// never in the content-agnostic core.

export interface BibleBook {
  /** OSIS book code, e.g. 'John'. Used in the canonical locus `work`. */
  osis: string;
  /** Human display name. */
  name: string;
  /** Chapter count (for UI pickers + range validation). */
  chapters: number;
}

/** The 66-book Protestant canon (OSIS codes). */
export const BOOKS: BibleBook[] = [
  { osis: 'Gen', name: 'Genesis', chapters: 50 },
  { osis: 'Exod', name: 'Exodus', chapters: 40 },
  { osis: 'Lev', name: 'Leviticus', chapters: 27 },
  { osis: 'Num', name: 'Numbers', chapters: 36 },
  { osis: 'Deut', name: 'Deuteronomy', chapters: 34 },
  { osis: 'Josh', name: 'Joshua', chapters: 24 },
  { osis: 'Judg', name: 'Judges', chapters: 21 },
  { osis: 'Ruth', name: 'Ruth', chapters: 4 },
  { osis: '1Sam', name: '1 Samuel', chapters: 31 },
  { osis: '2Sam', name: '2 Samuel', chapters: 24 },
  { osis: '1Kgs', name: '1 Kings', chapters: 22 },
  { osis: '2Kgs', name: '2 Kings', chapters: 25 },
  { osis: '1Chr', name: '1 Chronicles', chapters: 29 },
  { osis: '2Chr', name: '2 Chronicles', chapters: 36 },
  { osis: 'Ezra', name: 'Ezra', chapters: 10 },
  { osis: 'Neh', name: 'Nehemiah', chapters: 13 },
  { osis: 'Esth', name: 'Esther', chapters: 10 },
  { osis: 'Job', name: 'Job', chapters: 42 },
  { osis: 'Ps', name: 'Psalms', chapters: 150 },
  { osis: 'Prov', name: 'Proverbs', chapters: 31 },
  { osis: 'Eccl', name: 'Ecclesiastes', chapters: 12 },
  { osis: 'Song', name: 'Song of Solomon', chapters: 8 },
  { osis: 'Isa', name: 'Isaiah', chapters: 66 },
  { osis: 'Jer', name: 'Jeremiah', chapters: 52 },
  { osis: 'Lam', name: 'Lamentations', chapters: 5 },
  { osis: 'Ezek', name: 'Ezekiel', chapters: 48 },
  { osis: 'Dan', name: 'Daniel', chapters: 12 },
  { osis: 'Hos', name: 'Hosea', chapters: 14 },
  { osis: 'Joel', name: 'Joel', chapters: 3 },
  { osis: 'Amos', name: 'Amos', chapters: 9 },
  { osis: 'Obad', name: 'Obadiah', chapters: 1 },
  { osis: 'Jonah', name: 'Jonah', chapters: 4 },
  { osis: 'Mic', name: 'Micah', chapters: 7 },
  { osis: 'Nah', name: 'Nahum', chapters: 3 },
  { osis: 'Hab', name: 'Habakkuk', chapters: 3 },
  { osis: 'Zeph', name: 'Zephaniah', chapters: 3 },
  { osis: 'Hag', name: 'Haggai', chapters: 2 },
  { osis: 'Zech', name: 'Zechariah', chapters: 14 },
  { osis: 'Mal', name: 'Malachi', chapters: 4 },
  { osis: 'Matt', name: 'Matthew', chapters: 28 },
  { osis: 'Mark', name: 'Mark', chapters: 16 },
  { osis: 'Luke', name: 'Luke', chapters: 24 },
  { osis: 'John', name: 'John', chapters: 21 },
  { osis: 'Acts', name: 'Acts', chapters: 28 },
  { osis: 'Rom', name: 'Romans', chapters: 16 },
  { osis: '1Cor', name: '1 Corinthians', chapters: 16 },
  { osis: '2Cor', name: '2 Corinthians', chapters: 13 },
  { osis: 'Gal', name: 'Galatians', chapters: 6 },
  { osis: 'Eph', name: 'Ephesians', chapters: 6 },
  { osis: 'Phil', name: 'Philippians', chapters: 4 },
  { osis: 'Col', name: 'Colossians', chapters: 4 },
  { osis: '1Thess', name: '1 Thessalonians', chapters: 5 },
  { osis: '2Thess', name: '2 Thessalonians', chapters: 3 },
  { osis: '1Tim', name: '1 Timothy', chapters: 6 },
  { osis: '2Tim', name: '2 Timothy', chapters: 4 },
  { osis: 'Titus', name: 'Titus', chapters: 3 },
  { osis: 'Phlm', name: 'Philemon', chapters: 1 },
  { osis: 'Heb', name: 'Hebrews', chapters: 13 },
  { osis: 'Jas', name: 'James', chapters: 5 },
  { osis: '1Pet', name: '1 Peter', chapters: 5 },
  { osis: '2Pet', name: '2 Peter', chapters: 3 },
  { osis: '1John', name: '1 John', chapters: 5 },
  { osis: '2John', name: '2 John', chapters: 1 },
  { osis: '3John', name: '3 John', chapters: 1 },
  { osis: 'Jude', name: 'Jude', chapters: 1 },
  { osis: 'Rev', name: 'Revelation', chapters: 22 },
];

// Standard USFM / Paratext 3-letter book codes, in canonical order (aligned with
// BOOKS). Lets OSIS and USFM aliases normalize to the same locus (reviewer's
// alias-equivalence acceptance criterion).
const USFM_CODES = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR',
  'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM',
  '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
  '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];

const BY_KEY = new Map<string, BibleBook>();
for (let i = 0; i < BOOKS.length; i++) {
  const b = BOOKS[i]!;
  BY_KEY.set(b.osis.toLowerCase(), b);
  BY_KEY.set(b.name.toLowerCase(), b);
  BY_KEY.set(b.name.toLowerCase().replace(/\s+/g, ''), b);
  if (USFM_CODES[i]) BY_KEY.set(USFM_CODES[i]!.toLowerCase(), b);
}
for (const [alias, osis] of [['jn', 'John'], ['gn', 'Gen'], ['mt', 'Matt'], ['rm', 'Rom']] as const) {
  BY_KEY.set(alias, BOOKS.find((x) => x.osis === osis)!);
}

export function lookupBook(token: string): BibleBook | undefined {
  return BY_KEY.get(token.trim().toLowerCase().replace(/\s+/g, ''));
}
