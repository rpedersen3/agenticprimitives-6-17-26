import { describe, it, expect } from 'vitest';
import {
  parseScriptureAlias,
  scriptureCanonicalLocus,
  scriptureEnvelope,
  InvalidScriptureReferenceError,
  VERSIFICATION_V1,
  CANON_V1,
  SCRIPTURE_LOCUS_PROFILE_V1,
  lookupBook,
  BOOKS,
} from '../src/index.js';
import { computeCanonicalId } from '@agenticprimitives/content-primitives';

describe('parseScriptureAlias — basics', () => {
  it('parses the canonical alias scripture:john.3.16 to controlled tokens', () => {
    const r = parseScriptureAlias('scripture:john.3.16');
    expect(r.locus.work).toBe('bible.book.john');
    expect(r.locus.canon).toBe(CANON_V1);
    expect(r.locus.versification).toBe(VERSIFICATION_V1);
    expect(r.reference.alias).toBe('scripture:John.3.16');
    expect(r.reference.envelope.locusProfile).toBe(SCRIPTURE_LOCUS_PROFILE_V1);
  });

  it('the id equals the domain-separated hash of the envelope', () => {
    const r = parseScriptureAlias('scripture:john.3.16');
    expect(r.reference.id).toBe(computeCanonicalId(scriptureEnvelope(scriptureCanonicalLocus(lookupBook('John')!, 3, 16))));
  });

  it('ships the 66-book canon', () => expect(BOOKS).toHaveLength(66));
});

// Conformance: alias equivalence (reviewer's acceptance set).
describe('CONFORMANCE — these all produce the SAME canonicalId', () => {
  const forms = ['John 3:16', 'john.3.16', 'Jn 3:16', 'OSIS:John.3.16', 'USFM:JHN 3:16', 'scripture:john.3.16', 'JOHN  3.16'];
  it('alias equivalence under one canon/versification profile', () => {
    const ids = forms.map((a) => parseScriptureAlias(a).reference.id);
    expect(new Set(ids).size).toBe(1);
  });
});

// Conformance: these MUST differ.
describe('CONFORMANCE — these produce DIFFERENT canonicalIds', () => {
  const id = (a: string) => parseScriptureAlias(a).reference.id;
  it('different verse', () => expect(id('John 3:16')).not.toBe(id('John 3:15')));
  it('different book (1 John vs John)', () => expect(id('John 3:16')).not.toBe(id('1John 3:16')));
  it('different versification (governance seam)', () => {
    const a = computeCanonicalId(scriptureEnvelope(scriptureCanonicalLocus(lookupBook('John')!, 3, 16)));
    const b = computeCanonicalId({ ...scriptureEnvelope(scriptureCanonicalLocus(lookupBook('John')!, 3, 16)), canonicalLocus: { ...scriptureCanonicalLocus(lookupBook('John')!, 3, 16), versification: 'vulgate-v1' } });
    expect(a).not.toBe(b);
  });
  it('different locus profile version', () => {
    const env = scriptureEnvelope(scriptureCanonicalLocus(lookupBook('John')!, 3, 16));
    expect(computeCanonicalId(env)).not.toBe(computeCanonicalId({ ...env, locusProfile: 'ap.scripture.locus.v2' }));
  });
});

// Conformance: these MUST fail validation.
describe('CONFORMANCE — these fail validation', () => {
  it('unknown book alias', () => expect(() => parseScriptureAlias('blah 1:1')).toThrow(InvalidScriptureReferenceError));
  it('translation prefix is not a valid name', () => expect(() => parseScriptureAlias('niv.john.3.16')).toThrow(InvalidScriptureReferenceError));
  it('Unicode confusable book token', () => expect(() => parseScriptureAlias('Јohn 3:16')).toThrow(/non-ASCII/));
  it('out-of-range chapter', () => expect(() => parseScriptureAlias('Rev 99:1')).toThrow(/chapter/));
  it('non-integer chapter is rejected at the locus builder', () => expect(() => scriptureCanonicalLocus(lookupBook('John')!, 3.5, 16)).toThrow(InvalidScriptureReferenceError));
});
