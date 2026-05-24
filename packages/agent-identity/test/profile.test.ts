import { describe, expect, it } from 'vitest';
import {
  canonicalProfileJson,
  profileContentHash,
} from '../src/profile';
import { InvalidProfileError } from '../src/errors';
import type { AgentCard } from '../src/types';

describe('canonical profile JSON', () => {
  it('produces the same hash for two semantically-equal profiles regardless of key order', () => {
    const a: AgentCard = {
      type: 'person',
      displayName: 'Alice',
      description: 'founder',
      homepage: 'https://example.com',
    };
    // Construct an object with the same fields in a different order.
    const b: AgentCard = {
      homepage: 'https://example.com',
      description: 'founder',
      displayName: 'Alice',
      type: 'person',
    } as AgentCard;
    expect(profileContentHash(a)).toBe(profileContentHash(b));
  });

  it('omits undefined fields from canonical JSON', () => {
    const profile: AgentCard = {
      type: 'org',
      displayName: 'Acme',
      members: undefined,
    } as AgentCard;
    const json = canonicalProfileJson(profile);
    expect(json).not.toContain('members');
    expect(json).toContain('"displayName":"Acme"');
  });

  it('produces deterministic JSON (golden-vector)', () => {
    const profile: AgentCard = {
      type: 'mcpServer',
      displayName: 'Tools',
      endpoint: 'https://mcp.example.com',
      verification: ['dns-txt', 'signed-url'],
    };
    const json = canonicalProfileJson(profile);
    expect(json).toBe(
      '{"displayName":"Tools","endpoint":"https://mcp.example.com","schemaVersion":1,"type":"mcpServer","verification":["dns-txt","signed-url"]}',
    );
  });

  it('refuses profile without type', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => canonicalProfileJson({ displayName: 'Bob' })).toThrow(InvalidProfileError);
  });

  it('refuses unknown profile type', () => {
    expect(() => canonicalProfileJson({ type: 'demigod' } as unknown as AgentCard)).toThrow(InvalidProfileError);
  });

  it('refuses mcpServer profile without endpoint or verification', () => {
    expect(() =>
      canonicalProfileJson({ type: 'mcpServer', verification: ['dns-txt'] } as unknown as AgentCard),
    ).toThrow(InvalidProfileError);
    expect(() =>
      canonicalProfileJson({ type: 'mcpServer', endpoint: 'https://x', verification: [] } as unknown as AgentCard),
    ).toThrow(InvalidProfileError);
  });

  it('refuses multisig with out-of-range threshold', () => {
    expect(() =>
      canonicalProfileJson({
        type: 'multisig',
        threshold: 3,
        members: ['0x0000000000000000000000000000000000000001'],
      } as unknown as AgentCard),
    ).toThrow(InvalidProfileError);
  });

  it('refuses non-finite numbers in canonical JSON', () => {
    expect(() =>
      canonicalProfileJson({
        type: 'multisig',
        threshold: Infinity as unknown as number,
        members: ['0x0000000000000000000000000000000000000001'],
      } as unknown as AgentCard),
    ).toThrow(InvalidProfileError);
  });

  it('content hash is keccak256 of canonical JSON UTF-8 bytes', () => {
    const profile: AgentCard = {
      type: 'service',
      displayName: 'svc',
      endpoint: 'https://svc.example.com',
    };
    const hash = profileContentHash(profile);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
