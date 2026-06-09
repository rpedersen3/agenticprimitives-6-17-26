/**
 * Phase 4 call-builder unit tests.
 * Pure encoding — no network, no signer.
 */
import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  buildRegisterSubnameCall,
  buildRotateNameOwnerCall,
  buildRotateNameResolverCall,
  buildSetSubregistryCall,
  buildSetPrimaryNameCall,
  buildSetStringAttributeCall,
  buildSetAddressAttributeCall,
  buildSetBytes32AttributeCall,
  buildRecordCalls,
} from '../src/custody';
import {
  agentNameRegistryAbi,
  agentNameAttributeResolverAbi,
} from '../src/abis';
import { PREDICATE_ID, AGENT_KIND_ID } from '../src/records';
import { namehash } from '../src/namehash';

const REGISTRY = '0xC3Ffa91DB8084eE81A4eb64F6840Ef02E9503b89' as const;
const RESOLVER = '0x6D0bFB5B046EA32b575e5E8Ef181a9d486456942' as const;
const OWNER    = '0x1111111111111111111111111111111111111111' as const;
const AGENT    = '0x2222222222222222222222222222222222222222' as const;
const SUB      = '0x3333333333333333333333333333333333333333' as const;
const ROOT     = namehash('agent');
const ACME     = namehash('acme.agent');

describe('buildRegisterSubnameCall', () => {
  it('encodes register(parent, label, owner, resolver, expiry=0)', () => {
    const call = buildRegisterSubnameCall({
      registry: REGISTRY,
      parentNode: ROOT,
      label: 'acme',
      newOwner: OWNER,
      resolver: RESOLVER,
    });
    expect(call.to).toBe(REGISTRY);
    expect(call.value).toBe(0n);
    const { functionName, args } = decodeFunctionData({
      abi: agentNameRegistryAbi,
      data: call.data,
    });
    expect(functionName).toBe('register');
    expect(args).toEqual([ROOT, 'acme', OWNER, RESOLVER, 0n]);
  });

  it('defaults resolver to zero when omitted', () => {
    const call = buildRegisterSubnameCall({
      registry: REGISTRY,
      parentNode: ROOT,
      label: 'bob',
      newOwner: OWNER,
    });
    const { args } = decodeFunctionData({ abi: agentNameRegistryAbi, data: call.data });
    expect(args).toEqual([ROOT, 'bob', OWNER, '0x0000000000000000000000000000000000000000', 0n]);
  });

  // AN-1 (audit 2026-06-09): the write path MUST normalize + reject so a homoglyph / mixed-case /
  // zero-width label can't be anchored as a node that renders like a real name.
  it('AN-1: lowercases a mixed-case label on the write path', () => {
    const call = buildRegisterSubnameCall({ registry: REGISTRY, parentNode: ROOT, label: 'Admin', newOwner: OWNER });
    const { args } = decodeFunctionData({ abi: agentNameRegistryAbi, data: call.data });
    expect((args as unknown[])[1]).toBe('admin');
  });

  it('AN-1: rejects a Cyrillic-homoglyph label', () => {
    // "аdmin" — leading Cyrillic а (U+0430)
    expect(() => buildRegisterSubnameCall({ registry: REGISTRY, parentNode: ROOT, label: 'аdmin', newOwner: OWNER })).toThrow();
  });

  it('AN-1: rejects a zero-width-character label', () => {
    expect(() => buildRegisterSubnameCall({ registry: REGISTRY, parentNode: ROOT, label: 'admin​', newOwner: OWNER })).toThrow();
  });
});

describe('buildRotateNameOwnerCall', () => {
  it('encodes setOwner(node, newOwner)', () => {
    const call = buildRotateNameOwnerCall({ registry: REGISTRY, node: ACME, newOwner: AGENT });
    const { functionName, args } = decodeFunctionData({ abi: agentNameRegistryAbi, data: call.data });
    expect(functionName).toBe('setOwner');
    expect(args).toEqual([ACME, AGENT]);
  });
});

describe('buildRotateNameResolverCall', () => {
  it('encodes setResolver(node, newResolver)', () => {
    const call = buildRotateNameResolverCall({ registry: REGISTRY, node: ACME, newResolver: RESOLVER });
    const { functionName, args } = decodeFunctionData({ abi: agentNameRegistryAbi, data: call.data });
    expect(functionName).toBe('setResolver');
    expect(args).toEqual([ACME, RESOLVER]);
  });
});

describe('buildSetSubregistryCall', () => {
  it('encodes setSubregistry(node, subregistry)', () => {
    const call = buildSetSubregistryCall({ registry: REGISTRY, node: ACME, subregistry: SUB });
    const { functionName, args } = decodeFunctionData({ abi: agentNameRegistryAbi, data: call.data });
    expect(functionName).toBe('setSubregistry');
    expect(args).toEqual([ACME, SUB]);
  });
});

describe('buildSetPrimaryNameCall', () => {
  it('encodes setPrimaryName(node)', () => {
    const call = buildSetPrimaryNameCall({ registry: REGISTRY, node: ACME });
    const { functionName, args } = decodeFunctionData({ abi: agentNameRegistryAbi, data: call.data });
    expect(functionName).toBe('setPrimaryName');
    expect(args).toEqual([ACME]);
  });
});

describe('record-attribute call builders', () => {
  it('encodes setStringAttribute(node, predicate, value)', () => {
    const call = buildSetStringAttributeCall({
      resolver: RESOLVER, node: ACME, predicate: PREDICATE_ID.displayName, value: 'Acme',
    });
    expect(call.to).toBe(RESOLVER);
    const { functionName, args } = decodeFunctionData({
      abi: agentNameAttributeResolverAbi,
      data: call.data,
    });
    expect(functionName).toBe('setStringAttribute');
    expect(args).toEqual([ACME, PREDICATE_ID.displayName, 'Acme']);
  });

  it('encodes setAddressAttribute(node, predicate, value)', () => {
    const call = buildSetAddressAttributeCall({
      resolver: RESOLVER, node: ACME, predicate: PREDICATE_ID.addr, value: OWNER,
    });
    const { functionName, args } = decodeFunctionData({
      abi: agentNameAttributeResolverAbi,
      data: call.data,
    });
    expect(functionName).toBe('setAddressAttribute');
    expect(args).toEqual([ACME, PREDICATE_ID.addr, OWNER]);
  });

  it('encodes setBytes32Attribute(node, predicate, value)', () => {
    const call = buildSetBytes32AttributeCall({
      resolver: RESOLVER, node: ACME, predicate: PREDICATE_ID.agentKind, value: AGENT_KIND_ID.org,
    });
    const { functionName, args } = decodeFunctionData({
      abi: agentNameAttributeResolverAbi,
      data: call.data,
    });
    expect(functionName).toBe('setBytes32Attribute');
    expect(args).toEqual([ACME, PREDICATE_ID.agentKind, AGENT_KIND_ID.org]);
  });
});

describe('buildRecordCalls', () => {
  it('produces N calls for a multi-field record bundle, dispatched by typed datatype', () => {
    const calls = buildRecordCalls({
      resolver: RESOLVER,
      node: ACME,
      records: {
        addr: OWNER,
        agentKind: 'org',
        displayName: 'Acme Construction',
        a2aEndpoint: 'https://a2a.example/',
        mcpEndpoint: 'https://mcp.example/',
        metadataUri: 'ipfs://Qm123',
        metadataHash: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
        custodyPolicy: SUB,
        nativeId: 'eip155:84532:0xabc',
      },
    });
    expect(calls.length).toBe(9);
    expect(calls.every((c) => c.to === RESOLVER)).toBe(true);
    expect(calls.every((c) => c.value === 0n)).toBe(true);

    // First call should be the addr (per encoder ordering — addr first).
    const first = decodeFunctionData({ abi: agentNameAttributeResolverAbi, data: calls[0]!.data });
    expect(first.functionName).toBe('setAddressAttribute');
    expect(first.args![1]).toBe(PREDICATE_ID.addr);
  });

  it('produces empty array for empty records', () => {
    expect(buildRecordCalls({ resolver: RESOLVER, node: ACME, records: {} })).toEqual([]);
  });
});
