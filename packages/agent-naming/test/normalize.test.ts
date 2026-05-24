import { describe, it, expect } from 'vitest';
import { normalizeAgentName, isValidAgentName } from '../src/normalize';
import { InvalidNameError } from '../src/errors';

describe('normalizeAgentName', () => {
  describe('accepts', () => {
    for (const [input, expected] of [
      ['agent', 'agent'],
      ['alice.agent', 'alice.agent'],
      ['ALICE.AGENT', 'alice.agent'],
      ['  alice.agent  ', 'alice.agent'],
      ['treasury.acme.agent', 'treasury.acme.agent'],
      ['alpha-beta.acme.agent', 'alpha-beta.acme.agent'],
      ['x.agent', 'x.agent'],
      ['a1b2c3.agent', 'a1b2c3.agent'],
      ['a'.repeat(63) + '.agent', 'a'.repeat(63) + '.agent'],
    ] as const) {
      it(`"${input}" → "${expected}"`, () => {
        expect(normalizeAgentName(input)).toBe(expected);
      });
    }
  });

  describe('rejects', () => {
    const cases: Array<[string, RegExp]> = [
      ['', /empty/],
      ['  ', /empty/],
      ['.', /empty label/],
      ['..agent', /empty label/],
      ['alice..agent', /empty label/],
      ['alice.', /empty label/],
      ['-alice.agent', /starts with hyphen/],
      ['alice-.agent', /ends with hyphen/],
      ['alice space.agent', /\[a-z 0-9 -\]/],
      ['alice@.agent', /\[a-z 0-9 -\]/],
      ['alice_.agent', /\[a-z 0-9 -\]/],
      ['alice.😀.agent', /\[a-z 0-9 -\]/],
      [('a'.repeat(64) + '.agent') as string, /exceeds 63 chars/],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" throws InvalidNameError`, () => {
        expect(() => normalizeAgentName(input)).toThrow(InvalidNameError);
        expect(() => normalizeAgentName(input)).toThrow(expected);
      });
    }
  });

  it('rejects non-string input', () => {
    // @ts-expect-error — runtime guard catches non-string
    expect(() => normalizeAgentName(null)).toThrow(InvalidNameError);
    // @ts-expect-error — runtime guard
    expect(() => normalizeAgentName(123)).toThrow(InvalidNameError);
  });

  it('is idempotent — normalize(normalize(x)) === normalize(x)', () => {
    for (const input of ['ALICE.AGENT', '  treasury.acme.agent  ', 'X.AGENT']) {
      const once = normalizeAgentName(input);
      const twice = normalizeAgentName(once);
      expect(twice).toBe(once);
    }
  });
});

describe('isValidAgentName', () => {
  it('true for valid', () => {
    expect(isValidAgentName('alice.agent')).toBe(true);
  });
  it('false for invalid', () => {
    expect(isValidAgentName('-alice.agent')).toBe(false);
    expect(isValidAgentName('')).toBe(false);
  });
});
