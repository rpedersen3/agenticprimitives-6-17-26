import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import {
  encodeRecords,
  decodeRecords,
  PREDICATE_ID,
  AGENT_KIND_ID,
  CLASS_AGENT_NAME,
  AGENT_KIND_ENUM,
  CAIP10_NAMESPACE_ALLOWLIST,
  type EncodedRecord,
  type DecodeInput,
} from '../src/records';
import type { AgentNameRecords } from '../src/types';

const A = '0x1111111111111111111111111111111111111111' as const;
const POLICY = '0x2222222222222222222222222222222222222222' as const;
const DIGEST = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const META_HASH = ('0x' + 'cd'.repeat(32)) as `0x${string}`;

// ─── Predicate ids ARE keccak256(atl:*) — must match Solidity ─────

describe('PREDICATE_ID (golden vectors — match AgentNamePredicates.sol)', () => {
  it('matches keccak256 of canonical CURIE', () => {
    expect(PREDICATE_ID.addr).toBe(keccak256(toHex('atl:addr')));
    expect(PREDICATE_ID.agentKind).toBe(keccak256(toHex('atl:agentKind')));
    expect(PREDICATE_ID.displayName).toBe(keccak256(toHex('atl:displayName')));
    expect(PREDICATE_ID.a2aEndpoint).toBe(keccak256(toHex('atl:a2aEndpoint')));
    expect(PREDICATE_ID.mcpEndpoint).toBe(keccak256(toHex('atl:mcpEndpoint')));
    expect(PREDICATE_ID.metadataUri).toBe(keccak256(toHex('atl:metadataURI')));
    expect(PREDICATE_ID.metadataHash).toBe(keccak256(toHex('atl:metadataHash')));
    expect(PREDICATE_ID.passkeyCredentialDigest).toBe(keccak256(toHex('atl:passkeyCredentialDigest')));
    expect(PREDICATE_ID.custodyPolicy).toBe(keccak256(toHex('atl:custodyPolicy')));
    expect(PREDICATE_ID.nativeId).toBe(keccak256(toHex('atl:nativeId')));
  });

  it('all ids are 32-byte hex', () => {
    for (const id of Object.values(PREDICATE_ID)) {
      expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('CLASS_AGENT_NAME + AGENT_KIND_ENUM match Solidity constants', () => {
    expect(CLASS_AGENT_NAME).toBe(keccak256(toHex('atl:AgentName')));
    expect(AGENT_KIND_ENUM).toBe(keccak256(toHex('atl:AgentKindEnum')));
  });

  it('AGENT_KIND_ID values match keccak256(name)', () => {
    expect(AGENT_KIND_ID.person).toBe(keccak256(toHex('person')));
    expect(AGENT_KIND_ID.org).toBe(keccak256(toHex('org')));
    expect(AGENT_KIND_ID.service).toBe(keccak256(toHex('service')));
    expect(AGENT_KIND_ID.treasury).toBe(keccak256(toHex('treasury')));
  });
});

// ─── encodeRecords ────────────────────────────────────────────────

describe('encodeRecords', () => {
  it('routes addr to its address-typed setter, lowercased', () => {
    const encoded = encodeRecords({ addr: '0xABCDEF0123456789abcdef0123456789ABCDEF01' as `0x${string}` });
    expect(encoded).toEqual([
      { predicate: PREDICATE_ID.addr, datatype: 'address', value: '0xabcdef0123456789abcdef0123456789abcdef01' },
    ]);
  });

  it('routes agentKind to its bytes32-typed setter with the hashed enum value', () => {
    const encoded = encodeRecords({ agentKind: 'person' });
    expect(encoded).toEqual([
      { predicate: PREDICATE_ID.agentKind, datatype: 'bytes32', value: AGENT_KIND_ID.person },
    ]);
  });

  it('rejects malformed addr', () => {
    expect(() => encodeRecords({ addr: '0x123' as `0x${string}` })).toThrow(/20-byte hex address/);
  });

  it('rejects unknown agentKind', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => encodeRecords({ agentKind: 'robot' })).toThrow(/person\|org\|service\|treasury/);
  });

  it('routes display-name + a2a-endpoint + mcp-endpoint + metadata-uri + native-id as string', () => {
    const records: AgentNameRecords = {
      displayName: 'Alice',
      a2aEndpoint: 'https://a2a.example/',
      mcpEndpoint: 'https://mcp.example/',
      metadataUri: 'ipfs://Qm…',
      nativeId: 'eip155:84532:0xABCDEF0123456789abcdef0123456789ABCDEF01',
    };
    const encoded = encodeRecords(records);
    expect(encoded.map((e) => ({ p: e.predicate, dt: e.datatype }))).toEqual([
      { p: PREDICATE_ID.displayName, dt: 'string' },
      { p: PREDICATE_ID.a2aEndpoint, dt: 'string' },
      { p: PREDICATE_ID.mcpEndpoint, dt: 'string' },
      { p: PREDICATE_ID.metadataUri, dt: 'string' },
      { p: PREDICATE_ID.nativeId, dt: 'string' },
    ]);
  });

  it('routes metadataHash + passkeyCredentialDigest as bytes32 (lowercased)', () => {
    const encoded = encodeRecords({ metadataHash: META_HASH, passkeyCredentialDigest: DIGEST });
    expect(encoded[0]).toEqual({ predicate: PREDICATE_ID.metadataHash, datatype: 'bytes32', value: META_HASH });
    expect(encoded[1]).toEqual({
      predicate: PREDICATE_ID.passkeyCredentialDigest,
      datatype: 'bytes32',
      value: DIGEST,
    });
  });

  it('routes custodyPolicy as address (lowercased)', () => {
    const encoded = encodeRecords({ custodyPolicy: POLICY });
    expect(encoded).toEqual([{ predicate: PREDICATE_ID.custodyPolicy, datatype: 'address', value: POLICY }]);
  });

  it('rejects malformed metadataHash', () => {
    expect(() => encodeRecords({ metadataHash: '0x12' as `0x${string}` })).toThrow(/32-byte hex/);
  });

  it('refuses native-id namespace not in allowlist (strict encode)', () => {
    expect(() => encodeRecords({ nativeId: 'cosmos:cosmoshub-4:cosmos1abc' })).toThrow(/allowlist/);
  });

  it('refuses grammar-malformed native-id', () => {
    expect(() => encodeRecords({ nativeId: 'not-a-caip10' })).toThrow(/CAIP-10 grammar/);
  });

  it('lowercases eip155 native-id address half', () => {
    const encoded = encodeRecords({
      nativeId: 'eip155:84532:0xABCDEF0123456789abcdef0123456789ABCDEF01',
    });
    expect(encoded[0]).toEqual({
      predicate: PREDICATE_ID.nativeId,
      datatype: 'string',
      value: 'eip155:84532:0xabcdef0123456789abcdef0123456789abcdef01',
    });
  });

  it('empty records produces empty output', () => {
    expect(encodeRecords({})).toEqual([]);
  });

  it('Phase 1 CAIP-10 allowlist is eip155, hedera, solana', () => {
    expect([...CAIP10_NAMESPACE_ALLOWLIST].sort()).toEqual(['eip155', 'hedera', 'solana']);
  });
});

// ─── decodeRecords ────────────────────────────────────────────────

describe('decodeRecords', () => {
  it('round-trips a full bundle from typed-getter results', () => {
    const records: AgentNameRecords = {
      addr: A,
      agentKind: 'org',
      displayName: 'Acme',
      a2aEndpoint: 'https://acme.example/',
      mcpEndpoint: 'https://mcp.acme.example/',
      metadataUri: 'ipfs://Qm…',
      metadataHash: META_HASH,
      passkeyCredentialDigest: DIGEST,
      custodyPolicy: POLICY,
      nativeId: 'eip155:84532:0xabcdef0123456789abcdef0123456789abcdef01',
    };
    const encoded = encodeRecords(records);
    // Simulate what the SDK reader assembles from typed getters.
    const input: DecodeInput = { strings: {}, addresses: {}, bytes32s: {} };
    for (const e of encoded as EncodedRecord[]) {
      if (e.datatype === 'string') input.strings[e.predicate] = e.value;
      else if (e.datatype === 'address') input.addresses[e.predicate] = e.value;
      else if (e.datatype === 'bytes32') input.bytes32s[e.predicate] = e.value;
    }
    const decoded = decodeRecords(input);
    expect(decoded).toEqual(records);
  });

  it('silently drops unknown predicate ids (fail-closed on read)', () => {
    const decoded = decodeRecords({
      strings: { ['0x' + 'ff'.repeat(32) as `0x${string}`]: 'unknown-junk' },
      addresses: {},
      bytes32s: {},
    });
    expect(decoded).toEqual({});
  });

  it('drops invalid agentKind value (hash does not match any AgentKind id)', () => {
    const decoded = decodeRecords({
      strings: {},
      addresses: {},
      bytes32s: { [PREDICATE_ID.agentKind]: keccak256(toHex('robot')) },
    });
    expect(decoded.agentKind).toBeUndefined();
  });

  it('returns empty bundle when no fields are set', () => {
    expect(decodeRecords({ strings: {}, addresses: {}, bytes32s: {} })).toEqual({});
  });
});
