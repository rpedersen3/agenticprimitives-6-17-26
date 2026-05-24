import { describe, it, expect } from 'vitest';
import { encodeRecords, decodeRecords, encodeRecordValue, PREDICATE } from '../src/records';
import type { AgentNameRecords } from '../src/types';

const A = '0x1111111111111111111111111111111111111111' as const;
const A_UPPER = '0x1111111111111111111111111111111111111111';
const POLICY = '0x2222222222222222222222222222222222222222' as const;
const DIGEST = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

describe('encodeRecordValue', () => {
  it('lowercases addresses', () => {
    expect(encodeRecordValue(PREDICATE.addr, '0xABCDEF0123456789abcdef0123456789ABCDEF01')).toBe(
      '0xabcdef0123456789abcdef0123456789abcdef01',
    );
  });

  it('rejects malformed address', () => {
    expect(() => encodeRecordValue(PREDICATE.addr, '0x123')).toThrow(/20-byte hex address/);
  });

  it('accepts each AgentKind', () => {
    for (const kind of ['person', 'org', 'service', 'treasury']) {
      expect(encodeRecordValue(PREDICATE.agentKind, kind)).toBe(kind);
    }
  });

  it('rejects unknown AgentKind', () => {
    expect(() => encodeRecordValue(PREDICATE.agentKind, 'robot')).toThrow(/person\|org\|service\|treasury/);
  });

  it('passes string predicates through', () => {
    expect(encodeRecordValue(PREDICATE.displayName, 'Alice')).toBe('Alice');
    expect(encodeRecordValue(PREDICATE.a2aEndpoint, 'https://x.example')).toBe('https://x.example');
  });

  it('rejects unknown predicate keys', () => {
    expect(() => encodeRecordValue('mystery-key' as never, 'foo')).toThrow(/unknown predicate/);
  });
});

describe('encodeRecords / decodeRecords round-trip', () => {
  it('full bundle round-trips', () => {
    const records: AgentNameRecords = {
      addr: A,
      agentKind: 'person',
      displayName: 'Alice',
      a2aEndpoint: 'https://demo-a2a.example/',
      mcpEndpoint: 'https://demo-mcp.example/',
      metadataUri: 'ipfs://bafy.../manifest.json',
      passkeyCredentialDigest: DIGEST,
      custodyPolicy: POLICY,
    };
    const encoded = Object.fromEntries(encodeRecords(records));
    const decoded = decodeRecords(encoded);
    expect(decoded).toEqual(records);
  });

  it('partial bundle round-trips', () => {
    const records: AgentNameRecords = { addr: A, agentKind: 'org' };
    const encoded = Object.fromEntries(encodeRecords(records));
    expect(decodeRecords(encoded)).toEqual(records);
  });

  it('empty bundle → empty pairs', () => {
    expect(encodeRecords({})).toEqual([]);
    expect(decodeRecords({})).toEqual({});
  });
});

describe('decodeRecords', () => {
  it('silently drops unknown predicate keys (fail-closed read)', () => {
    const decoded = decodeRecords({
      addr: A,
      'unknown-future-predicate': 'value-here',
    });
    expect(decoded).toEqual({ addr: A });
  });

  it('drops invalid agentKind', () => {
    const decoded = decodeRecords({ addr: A, 'agent-kind': 'cyborg' });
    expect(decoded).toEqual({ addr: A });
  });
});

describe('encodeRecords address case normalization', () => {
  it('writes canonical lowercase', () => {
    const pairs = encodeRecords({ addr: A_UPPER as `0x${string}` });
    const [, value] = pairs.find(([k]) => k === 'addr')!;
    expect(value).toBe(A_UPPER.toLowerCase());
  });
});

// ─── ADR-0008 — CAIP-10 nativeId predicate ──────────────────────────

describe('nativeId predicate (CAIP-10 — ADR-0008)', () => {
  it('encodes valid eip155 (lowercased address half)', () => {
    expect(
      encodeRecordValue(PREDICATE.nativeId, 'eip155:84532:0xABCDEF0123456789abcdef0123456789ABCDEF01'),
    ).toBe('eip155:84532:0xabcdef0123456789abcdef0123456789abcdef01');
  });

  it('accepts hedera namespace', () => {
    expect(encodeRecordValue(PREDICATE.nativeId, 'hedera:testnet:0.0.123456')).toBe(
      'hedera:testnet:0.0.123456',
    );
  });

  it('accepts solana namespace', () => {
    expect(
      encodeRecordValue(PREDICATE.nativeId, 'solana:mainnet:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'),
    ).toBe('solana:mainnet:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
  });

  it('rejects unknown namespace (Phase 1 allowlist)', () => {
    expect(() =>
      encodeRecordValue(PREDICATE.nativeId, 'cosmos:cosmoshub-4:cosmos1abc'),
    ).toThrow(/namespace "cosmos" not in allowlist/);
  });

  it('rejects malformed grammar', () => {
    expect(() => encodeRecordValue(PREDICATE.nativeId, 'not-a-caip10')).toThrow(/CAIP-10 grammar/);
    expect(() => encodeRecordValue(PREDICATE.nativeId, 'eip155:')).toThrow(/CAIP-10 grammar/);
    expect(() => encodeRecordValue(PREDICATE.nativeId, ':84532:0xabc')).toThrow(/CAIP-10 grammar/);
  });

  it('encodes/decodes round-trip through records bundle', () => {
    const records = { nativeId: 'eip155:84532:0xabcdef0123456789abcdef0123456789abcdef01' };
    const encoded = Object.fromEntries(encodeRecords(records));
    const decoded = decodeRecords(encoded);
    expect(decoded.nativeId).toBe(records.nativeId);
  });

  it('decode is permissive — accepts grammar-valid strings even from unknown namespaces (forward-compat)', () => {
    // Decoder doesn't enforce the allowlist (so resolver records
    // written by a future package version don't crash the reader).
    const decoded = decodeRecords({ 'native-id': 'cosmos:cosmoshub-4:cosmos1abc' });
    expect(decoded.nativeId).toBe('cosmos:cosmoshub-4:cosmos1abc');
  });
});
