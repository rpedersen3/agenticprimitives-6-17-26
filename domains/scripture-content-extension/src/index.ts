// @agenticprimitives/scripture-content-extension — the scripture vertical for the
// verifiable-content substrate (spec 267). Owns the Bible canon, a versioned
// versification model, the scripture.verse selector, and alias parsing that
// normalizes MANY surface grammars (OSIS / USFM / "Jn 3.16") to ONE
// scheme-independent, CONTROLLED-TOKEN canonical locus → one canonicalId.
//
// JCS does NOT Unicode-normalize strings, so this package converts every surface
// form to controlled ASCII tokens (e.g. 'bible.book.john') and SCHEMA-VALIDATES
// the locus BEFORE it reaches the core hash (spec 266 §2.1; threat-model).
// Carries NO rendering text and NO specific translation (ADR-0033 R1/R3).

import {
  canonicalReference,
  LOCUS_ID_SCHEME,
  type CanonicalLocusEnvelope,
  type CanonicalReference,
} from '@agenticprimitives/content-primitives';
import { BOOKS, lookupBook, type BibleBook } from './canon.js';

export { BOOKS, lookupBook, type BibleBook } from './canon.js';

/** Content type for a single verse (carried in a descriptor's `contentType`). */
export const SCRIPTURE_VERSE_CONTENT_TYPE = 'scripture.verse';

/** The vertical domain tag in the envelope. */
export const CONTENT_DOMAIN = 'scripture';

/**
 * The versioned locus profile — the governance seam (spec 266 §2.1). Bundles the
 * canon + versification model. Changing it is a deliberate new namespace (a
 * different canonicalId), never an accidental break.
 */
export const SCRIPTURE_LOCUS_PROFILE_V1 = 'ap.scripture.locus.v1';

/** The verse-NUMBERING model id (not a translation). */
export const VERSIFICATION_V1 = 'kjv-v1';
/** The canon model id. */
export const CANON_V1 = 'bible.protestant-66';

/** Structured, controlled-token canonical locus for a verse (profile v1). */
export interface ScriptureCanonicalLocusV1 {
  kind: 'scripture.locus';
  /** Controlled work token, e.g. 'bible.book.john' (NOT a display label). */
  work: string;
  canon: string;
  versification: string;
  locusType: 'verse';
  chapter: number;
  verse: number;
}

/** Structured scripture selector carried in a descriptor's `selector` field. */
export interface ScriptureSelector {
  kind: 'scripture';
  /** OSIS book code, e.g. 'John' — display/selector metadata, not identity. */
  book: string;
  chapter: number;
  verse: number;
  versification: string;
  canon: string;
}

export class InvalidScriptureReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScriptureReferenceError';
  }
}

/** Controlled work token for a book: 'bible.book.<osis-lowercased>'. */
function workToken(book: BibleBook): string {
  return `bible.book.${book.osis.toLowerCase()}`;
}

/**
 * Build the controlled-token canonical locus for a verse. SCHEMA-VALIDATES:
 * chapter/verse must be small positive integers, book must be in canon. All
 * fields are controlled tokens — no user strings enter the hashed object.
 */
export function scriptureCanonicalLocus(book: BibleBook, chapter: number, verse: number): ScriptureCanonicalLocusV1 {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) {
    throw new InvalidScriptureReferenceError(`invalid chapter ${chapter} for ${book.name}`);
  }
  if (!Number.isInteger(verse) || verse < 1 || verse > 200) {
    throw new InvalidScriptureReferenceError(`invalid verse ${verse}`);
  }
  return {
    kind: 'scripture.locus',
    work: workToken(book),
    canon: CANON_V1,
    versification: VERSIFICATION_V1,
    locusType: 'verse',
    chapter,
    verse,
  };
}

/** Wrap a canonical locus in the hashed envelope (domain + profile committed). */
export function scriptureEnvelope(locus: ScriptureCanonicalLocusV1): CanonicalLocusEnvelope {
  return {
    idScheme: LOCUS_ID_SCHEME,
    contentDomain: CONTENT_DOMAIN,
    locusProfile: SCRIPTURE_LOCUS_PROFILE_V1,
    canonicalLocus: locus as unknown as Record<string, unknown>,
  };
}

export function scriptureSelector(book: BibleBook, chapter: number, verse: number): ScriptureSelector {
  return { kind: 'scripture', book: book.osis, chapter, verse, versification: VERSIFICATION_V1, canon: CANON_V1 };
}

export interface ParsedScriptureReference {
  book: BibleBook;
  chapter: number;
  verse: number;
  selector: ScriptureSelector;
  locus: ScriptureCanonicalLocusV1;
  reference: CanonicalReference;
}

// Reject non-ASCII up front — defeats homograph/confusable attacks on book names
// (spec 266 §threat-model). Phase-1 aliases are US-ASCII only.
const ASCII_ONLY = /^[\x20-\x7E]*$/;

/**
 * Parse a scripture alias into its canonical locus. Accepts the canonical alias
 * `scripture:john.3.16` and tolerant human forms (`John 3:16`, `Jn 3.16`,
 * OSIS `John.3.16`, USFM `JHN 3:16`). All normalize to the SAME canonical locus
 * → SAME id. Translation/edition prefixes are NOT accepted (they are descriptor
 * metadata, not part of the public name — spec 267 §2): an unknown leading token
 * fails book lookup.
 */
export function parseScriptureAlias(alias: string): ParsedScriptureReference {
  const raw = alias.normalize('NFC').trim();
  if (!ASCII_ONLY.test(raw)) {
    throw new InvalidScriptureReferenceError('non-ASCII characters are rejected in Phase 1 (confusable defense)');
  }
  const body = raw.replace(/^(scripture|osis|usfm):/i, '').trim();
  const m = /^([1-3]?\s*[A-Za-z]+)[\s.]+(\d+)[\s.:](\d+)$/.exec(body);
  if (!m) throw new InvalidScriptureReferenceError(`unrecognized scripture reference: "${alias}"`);

  const book = lookupBook(m[1]!);
  if (!book) throw new InvalidScriptureReferenceError(`unknown book: "${m[1]}"`);
  const chapter = Number(m[2]);
  const verse = Number(m[3]);

  const locus = scriptureCanonicalLocus(book, chapter, verse); // validates ranges
  const canonicalAlias = `scripture:${book.osis}.${chapter}.${verse}`;
  return {
    book,
    chapter,
    verse,
    selector: scriptureSelector(book, chapter, verse),
    locus,
    reference: canonicalReference(scriptureEnvelope(locus), canonicalAlias),
  };
}

/** The canonical display reference, e.g. 'John 3:16'. */
export function displayReference(book: BibleBook, chapter: number, verse: number): string {
  return `${book.name} ${chapter}:${verse}`;
}
