/**
 * Pure encoded call builders for AgentProfileResolver writes
 * (ID Phase 4).
 *
 * Subpath: `@agenticprimitives/agent-identity/calls`.
 *
 * Each builder returns a `ContractCall` (`{ to, value, data }`) so
 * callers can submit via any path — direct walletClient.sendTransaction
 * (see AgentIdentityClient), AgentAccount.execute, CustodyPolicy
 * ceremony, ERC-4337 UserOp, etc.
 *
 * Per ADR-0007 the package boundary forbids importing agent-naming /
 * agent-relationships / delegation / custody — these builders stay
 * pure encode-only.
 */

import { encodeFunctionData } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';
import { agentProfileResolverAbi } from './abis';

/** Minimal call-shape: the standard `{ to, value, data }` triple. */
export interface ContractCall {
  to: Address;
  value: bigint;
  data: Hex;
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

/**
 * Build a call to register an agent's profile for the first time.
 * The walletClient's account MUST equal `agent`. Subsequent updates
 * go through the typed setters / setMetadata.
 */
export function buildRegisterProfileCall(args: {
  profileResolver: Address;
  agent: Address;
  displayName?: string;
  description?: string;
  agentKind?: Hex;
  profileSchemaURI?: string;
}): ContractCall {
  return {
    to: args.profileResolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentProfileResolverAbi,
      functionName: 'register',
      args: [
        args.agent,
        args.displayName ?? '',
        args.description ?? '',
        args.agentKind ?? ZERO_BYTES32,
        args.profileSchemaURI ?? '',
      ],
    }),
  };
}

/**
 * Build a call to set / update the off-chain profile anchor
 * (metadataURI + metadataHash). The walletClient's account MUST
 * equal `agent` AND the agent must already be registered.
 */
export function buildSetProfileMetadataCall(args: {
  profileResolver: Address;
  agent: Address;
  metadataURI: string;
  metadataHash: Hex;
}): ContractCall {
  return {
    to: args.profileResolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentProfileResolverAbi,
      functionName: 'setMetadata',
      args: [args.agent, args.metadataURI, args.metadataHash],
    }),
  };
}

/** Set a single string property on an agent's profile. */
export function buildSetProfileStringCall(args: {
  profileResolver: Address;
  agent: Address;
  predicate: Hex;
  value: string;
}): ContractCall {
  return {
    to: args.profileResolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentProfileResolverAbi,
      functionName: 'setStringProperty',
      args: [args.agent, args.predicate, args.value],
    }),
  };
}

/** Set a single address property on an agent's profile. */
export function buildSetProfileAddressCall(args: {
  profileResolver: Address;
  agent: Address;
  predicate: Hex;
  value: Address;
}): ContractCall {
  return {
    to: args.profileResolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentProfileResolverAbi,
      functionName: 'setAddressProperty',
      args: [args.agent, args.predicate, args.value],
    }),
  };
}

/** Set a single bytes32 property on an agent's profile. */
export function buildSetProfileBytes32Call(args: {
  profileResolver: Address;
  agent: Address;
  predicate: Hex;
  value: Hex;
}): ContractCall {
  return {
    to: args.profileResolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentProfileResolverAbi,
      functionName: 'setBytes32Property',
      args: [args.agent, args.predicate, args.value],
    }),
  };
}

/** Flip the `atl:profileActive` boolean for an agent. */
export function buildSetProfileActiveCall(args: {
  profileResolver: Address;
  agent: Address;
  active: boolean;
}): ContractCall {
  return {
    to: args.profileResolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentProfileResolverAbi,
      functionName: 'setActive',
      args: [args.agent, args.active],
    }),
  };
}
