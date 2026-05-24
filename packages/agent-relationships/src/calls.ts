/**
 * Pure encoded call builders for AgentRelationship writes
 * (RL Phase 4).
 *
 * Subpath: `@agenticprimitives/agent-relationships/calls`.
 *
 * Each builder returns a `ContractCall` (`{ to, value, data }`) so
 * callers can submit via any path — direct walletClient.sendTransaction
 * (see AgentRelationshipsClient), AgentAccount.execute, CustodyPolicy
 * ceremony, ERC-4337 UserOp, etc.
 *
 * The package boundary (spec 216 § 3) forbids importing custody /
 * delegation / mcp-runtime here — these builders stay pure encode-only.
 */

import { encodeFunctionData } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';
import { agentRelationshipAbi } from './abis';
import type { RelationshipType, Role } from './types';

/** Minimal call-shape: the standard `{ to, value, data }` triple. */
export interface ContractCall {
  to: Address;
  value: bigint;
  data: Hex;
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

/**
 * Build a call to propose a new edge. The caller MUST be the subject
 * (msg.sender == subject on chain).
 */
export function buildProposeEdgeCall(args: {
  relationships: Address;
  subject: Address;
  object: Address;
  relationshipType: RelationshipType;
  initialRoles?: Role[];
  metadataURI?: string;
  metadataHash?: Hex;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'proposeEdge',
      args: [
        args.subject,
        args.object,
        args.relationshipType,
        (args.initialRoles ?? []) as readonly Hex[],
        args.metadataURI ?? '',
        args.metadataHash ?? ZERO_BYTES32,
      ],
    }),
  };
}

/**
 * Build a call to confirm a PROPOSED edge. The caller MUST be the
 * object side.
 */
export function buildConfirmEdgeCall(args: {
  relationships: Address;
  edgeId: Hex;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'confirmEdge',
      args: [args.edgeId],
    }),
  };
}

/**
 * Build a call to activate a CONFIRMED edge. Either party may activate.
 */
export function buildActivateEdgeCall(args: {
  relationships: Address;
  edgeId: Hex;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'activateEdge',
      args: [args.edgeId],
    }),
  };
}

/**
 * Build a call to revoke an edge. Either party may revoke unilaterally.
 */
export function buildRevokeEdgeCall(args: {
  relationships: Address;
  edgeId: Hex;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'revokeEdge',
      args: [args.edgeId],
    }),
  };
}

/** Build a call to add a role to an existing edge. */
export function buildAddRoleCall(args: {
  relationships: Address;
  edgeId: Hex;
  role: Role;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'addRole',
      args: [args.edgeId, args.role],
    }),
  };
}

/** Build a call to remove a role from an existing edge. */
export function buildRemoveRoleCall(args: {
  relationships: Address;
  edgeId: Hex;
  role: Role;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'removeRole',
      args: [args.edgeId, args.role],
    }),
  };
}

/** Build a call to set / update an edge's off-chain metadata anchor. */
export function buildSetMetadataCall(args: {
  relationships: Address;
  edgeId: Hex;
  metadataURI: string;
  metadataHash: Hex;
}): ContractCall {
  return {
    to: args.relationships,
    value: 0n,
    data: encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'setMetadata',
      args: [args.edgeId, args.metadataURI, args.metadataHash],
    }),
  };
}
