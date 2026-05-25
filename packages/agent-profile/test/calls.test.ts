import { describe, expect, it } from 'vitest';
import { decodeFunctionData, keccak256, toHex } from 'viem';
import {
  buildRegisterProfileCall,
  buildSetProfileMetadataCall,
  buildSetProfileStringCall,
  buildSetProfileAddressCall,
  buildSetProfileBytes32Call,
  buildSetProfileActiveCall,
} from '../src/calls';
import { agentProfileResolverAbi } from '../src/abis';

const PROF  = '0x189D7c19f5B611CD85e2Ef748d1FA546F3402275' as const;
const ALICE = '0x1111111111111111111111111111111111111111' as const;
const KIND  = keccak256(toHex('person'));
const HASH  = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('buildRegisterProfileCall', () => {
  it('encodes register(agent, displayName, description, agentKind, schemaURI)', () => {
    const call = buildRegisterProfileCall({
      profileResolver: PROF,
      agent: ALICE,
      displayName: 'Alice',
      description: 'founder',
      agentKind: KIND,
      profileSchemaURI: 'https://example.com/schema.json',
    });
    expect(call.to).toBe(PROF);
    expect(call.value).toBe(0n);
    const { functionName, args } = decodeFunctionData({
      abi: agentProfileResolverAbi,
      data: call.data,
    });
    expect(functionName).toBe('register');
    expect(args).toEqual([ALICE, 'Alice', 'founder', KIND, 'https://example.com/schema.json']);
  });

  it('defaults all optional fields when omitted', () => {
    const call = buildRegisterProfileCall({ profileResolver: PROF, agent: ALICE });
    const { args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(args).toEqual([ALICE, '', '', ZERO_BYTES32, '']);
  });
});

describe('buildSetProfileMetadataCall', () => {
  it('encodes setMetadata(agent, uri, hash)', () => {
    const call = buildSetProfileMetadataCall({
      profileResolver: PROF, agent: ALICE, metadataURI: 'ipfs://x', metadataHash: HASH,
    });
    const { functionName, args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(functionName).toBe('setMetadata');
    expect(args).toEqual([ALICE, 'ipfs://x', HASH]);
  });
});

describe('typed property setters', () => {
  it('encodes setStringProperty(agent, predicate, value)', () => {
    const call = buildSetProfileStringCall({
      profileResolver: PROF, agent: ALICE, predicate: keccak256(toHex('atl:description')), value: 'hi',
    });
    const { functionName, args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(functionName).toBe('setStringProperty');
    expect(args).toEqual([ALICE, keccak256(toHex('atl:description')), 'hi']);
  });

  it('encodes setAddressProperty(agent, predicate, value)', () => {
    const call = buildSetProfileAddressCall({
      profileResolver: PROF, agent: ALICE, predicate: keccak256(toHex('atl:something')), value: ALICE,
    });
    const { functionName, args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(functionName).toBe('setAddressProperty');
    expect(args).toEqual([ALICE, keccak256(toHex('atl:something')), ALICE]);
  });

  it('encodes setBytes32Property(agent, predicate, value)', () => {
    const call = buildSetProfileBytes32Call({
      profileResolver: PROF, agent: ALICE, predicate: keccak256(toHex('atl:agentKind')), value: KIND,
    });
    const { functionName, args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(functionName).toBe('setBytes32Property');
    expect(args).toEqual([ALICE, keccak256(toHex('atl:agentKind')), KIND]);
  });
});

describe('buildSetProfileActiveCall', () => {
  it('encodes setActive(agent, true)', () => {
    const call = buildSetProfileActiveCall({ profileResolver: PROF, agent: ALICE, active: true });
    const { functionName, args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(functionName).toBe('setActive');
    expect(args).toEqual([ALICE, true]);
  });

  it('encodes setActive(agent, false)', () => {
    const call = buildSetProfileActiveCall({ profileResolver: PROF, agent: ALICE, active: false });
    const { args } = decodeFunctionData({ abi: agentProfileResolverAbi, data: call.data });
    expect(args).toEqual([ALICE, false]);
  });
});
