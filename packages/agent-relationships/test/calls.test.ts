import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  buildProposeEdgeCall,
  buildConfirmEdgeCall,
  buildActivateEdgeCall,
  buildRevokeEdgeCall,
  buildAddRoleCall,
  buildRemoveRoleCall,
  buildSetMetadataCall,
} from '../src/calls';
import { agentRelationshipAbi } from '../src/abis';
import { RELATIONSHIP_TYPE, ROLE } from '../src/constants';

const REL    = '0x35084a3D655240760BD3C0B24Fb8ca9776cf374E' as const;
const ALICE  = '0x1111111111111111111111111111111111111111' as const;
const BOB    = '0x2222222222222222222222222222222222222222' as const;
const EDGE_ID = '0x0000000000000000000000000000000000000000000000000000000000000099' as const;
const HASH    = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('buildProposeEdgeCall', () => {
  it('encodes with defaults for omitted optional fields', () => {
    const call = buildProposeEdgeCall({
      relationships: REL,
      subject: ALICE,
      object: BOB,
      relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER as never,
    });
    expect(call.to).toBe(REL);
    expect(call.value).toBe(0n);
    const { functionName, args } = decodeFunctionData({
      abi: agentRelationshipAbi,
      data: call.data,
    });
    expect(functionName).toBe('proposeEdge');
    expect(args).toEqual([ALICE, BOB, RELATIONSHIP_TYPE.HAS_MEMBER, [], '', ZERO_BYTES32]);
  });

  it('encodes with initial roles + metadata', () => {
    const call = buildProposeEdgeCall({
      relationships: REL,
      subject: ALICE,
      object: BOB,
      relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER as never,
      initialRoles: [ROLE.MEMBER as never, ROLE.BOARD_MEMBER as never],
      metadataURI: 'ipfs://x',
      metadataHash: HASH,
    });
    const { args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(args).toEqual([
      ALICE, BOB, RELATIONSHIP_TYPE.HAS_MEMBER,
      [ROLE.MEMBER, ROLE.BOARD_MEMBER],
      'ipfs://x', HASH,
    ]);
  });
});

describe('buildConfirmEdgeCall', () => {
  it('encodes confirmEdge(edgeId)', () => {
    const call = buildConfirmEdgeCall({ relationships: REL, edgeId: EDGE_ID });
    const { functionName, args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(functionName).toBe('confirmEdge');
    expect(args).toEqual([EDGE_ID]);
  });
});

describe('buildActivateEdgeCall', () => {
  it('encodes activateEdge(edgeId)', () => {
    const call = buildActivateEdgeCall({ relationships: REL, edgeId: EDGE_ID });
    const { functionName, args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(functionName).toBe('activateEdge');
    expect(args).toEqual([EDGE_ID]);
  });
});

describe('buildRevokeEdgeCall', () => {
  it('encodes revokeEdge(edgeId)', () => {
    const call = buildRevokeEdgeCall({ relationships: REL, edgeId: EDGE_ID });
    const { functionName, args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(functionName).toBe('revokeEdge');
    expect(args).toEqual([EDGE_ID]);
  });
});

describe('role builders', () => {
  it('encodes addRole(edgeId, role)', () => {
    const call = buildAddRoleCall({ relationships: REL, edgeId: EDGE_ID, role: ROLE.OPERATOR as never });
    const { functionName, args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(functionName).toBe('addRole');
    expect(args).toEqual([EDGE_ID, ROLE.OPERATOR]);
  });

  it('encodes removeRole(edgeId, role)', () => {
    const call = buildRemoveRoleCall({ relationships: REL, edgeId: EDGE_ID, role: ROLE.OPERATOR as never });
    const { functionName, args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(functionName).toBe('removeRole');
    expect(args).toEqual([EDGE_ID, ROLE.OPERATOR]);
  });
});

describe('buildSetMetadataCall', () => {
  it('encodes setMetadata(edgeId, uri, hash)', () => {
    const call = buildSetMetadataCall({
      relationships: REL, edgeId: EDGE_ID, metadataURI: 'ipfs://Qm123', metadataHash: HASH,
    });
    const { functionName, args } = decodeFunctionData({ abi: agentRelationshipAbi, data: call.data });
    expect(functionName).toBe('setMetadata');
    expect(args).toEqual([EDGE_ID, 'ipfs://Qm123', HASH]);
  });
});
