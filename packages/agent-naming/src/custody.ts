/**
 * Subpath `@agenticprimitives/agent-naming/custody`.
 *
 * Pure encoded call builders for name-registry + resolver writes.
 * Compose these into a custody ceremony, a direct EOA tx, an
 * ERC-4337 UserOp, or anything else that submits a transaction.
 * The package boundary (spec 215 § 3) prohibits importing
 * `@agenticprimitives/account-custody` from here — these builders MUST stay
 * pure encode-only.
 *
 * Each builder returns a `ContractCall` shape (`{ to, value, data }`)
 * matching the standard "compose-then-submit" pattern used across
 * other agenticprimitives packages.
 *
 * Phase 4 lands the encoders; the client (`AgentNamingClient`) layers
 * walletClient submission on top.
 */

import { encodeFunctionData } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';
import { normalizeLabel } from './normalize';
import {
  agentNameAttributeResolverAbi,
  agentNameRegistryAbi,
  permissionlessSubregistryAbi,
} from './abis';
import { PREDICATE_ID, AGENT_KIND_ID, type EncodedRecord } from './records';
import type { AgentKind } from './types';

/** Minimal call-shape: the standard `{ to, value, data }` triple. */
export interface ContractCall {
  to: Address;
  value: bigint;
  data: Hex;
}

// ─── Registry writes ───────────────────────────────────────────────

/**
 * Build a call to register `<label>.<parent>` under the parent
 * namespace. Caller MUST be the parent's owner OR subregistry
 * delegate (msg.sender check on chain).
 */
export function buildRegisterSubnameCall(args: {
  registry: Address;
  parentNode: Hex;
  label: string;
  newOwner: Address;
  resolver?: Address;
  expiry?: bigint;
}): ContractCall {
  // AN-1: normalize + reject on the WRITE path (homoglyph/case/zero-width squat defense).
  const label = normalizeLabel(args.label);
  return {
    to: args.registry,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameRegistryAbi,
      functionName: 'register',
      args: [
        args.parentNode,
        label,
        args.newOwner,
        args.resolver ?? ('0x0000000000000000000000000000000000000000' as Address),
        args.expiry ?? 0n,
      ],
    }),
  };
}

/**
 * Build a call to rotate the owner Smart Agent for a name.
 * Caller MUST be the current owner.
 */
export function buildRotateNameOwnerCall(args: {
  registry: Address;
  node: Hex;
  newOwner: Address;
}): ContractCall {
  return {
    to: args.registry,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameRegistryAbi,
      functionName: 'setOwner',
      args: [args.node, args.newOwner],
    }),
  };
}

/**
 * Build a call to swap the resolver contract for a name.
 * Caller MUST be the current owner.
 */
export function buildRotateNameResolverCall(args: {
  registry: Address;
  node: Hex;
  newResolver: Address;
}): ContractCall {
  return {
    to: args.registry,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameRegistryAbi,
      functionName: 'setResolver',
      args: [args.node, args.newResolver],
    }),
  };
}

/**
 * Build a call to delegate child-name issuance authority for a
 * subtree to a subregistry contract. Setting `subregistry = address(0)`
 * reverts to "owner-only" issuance.
 */
export function buildSetSubregistryCall(args: {
  registry: Address;
  node: Hex;
  subregistry: Address;
}): ContractCall {
  return {
    to: args.registry,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameRegistryAbi,
      functionName: 'setSubregistry',
      args: [args.node, args.subregistry],
    }),
  };
}

/**
 * Build a call to set the caller's primary name (reverse record).
 * Caller MUST be the agent for which the primary name is being set
 * (msg.sender == agent on chain). Setting `node = bytes32(0)` clears
 * the primary name.
 */
export function buildSetPrimaryNameCall(args: {
  registry: Address;
  node: Hex;
}): ContractCall {
  return {
    to: args.registry,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameRegistryAbi,
      functionName: 'setPrimaryName',
      args: [args.node],
    }),
  };
}

// ─── Resolver (record) writes ──────────────────────────────────────

/** Build a typed `setStringAttribute(node, predicate, value)` call. */
export function buildSetStringAttributeCall(args: {
  resolver: Address;
  node: Hex;
  predicate: Hex;
  value: string;
}): ContractCall {
  return {
    to: args.resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameAttributeResolverAbi,
      functionName: 'setStringAttribute',
      args: [args.node, args.predicate, args.value],
    }),
  };
}

/** Build a typed `setAddressAttribute(node, predicate, value)` call. */
export function buildSetAddressAttributeCall(args: {
  resolver: Address;
  node: Hex;
  predicate: Hex;
  value: Address;
}): ContractCall {
  return {
    to: args.resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameAttributeResolverAbi,
      functionName: 'setAddressAttribute',
      args: [args.node, args.predicate, args.value],
    }),
  };
}

/** Build a typed `setBytes32Attribute(node, predicate, value)` call. */
export function buildSetBytes32AttributeCall(args: {
  resolver: Address;
  node: Hex;
  predicate: Hex;
  value: Hex;
}): ContractCall {
  return {
    to: args.resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: agentNameAttributeResolverAbi,
      functionName: 'setBytes32Attribute',
      args: [args.node, args.predicate, args.value],
    }),
  };
}

// ─── Records bundle → array of typed-attribute calls ───────────────

/**
 * Translate an `AgentNameRecords` bundle into N typed-attribute
 * calls. Caller submits them via walletClient OR composes them into
 * a single AgentAccount.execute / CustodyPolicy ceremony.
 *
 * Mirrors `encodeRecords` from `agent-naming/records` but produces
 * full `ContractCall` shapes instead of `EncodedRecord` shapes.
 */
export function buildRecordCalls(args: {
  resolver: Address;
  node: Hex;
  records: import('./types').AgentNameRecords;
}): ContractCall[] {
  const out: ContractCall[] = [];
  const { resolver, node, records } = args;
  if (records.addr !== undefined) {
    out.push(buildSetAddressAttributeCall({ resolver, node, predicate: PREDICATE_ID.addr, value: records.addr }));
  }
  if (records.agentKind !== undefined) {
    out.push(buildSetBytes32AttributeCall({
      resolver, node,
      predicate: PREDICATE_ID.agentKind,
      value: AGENT_KIND_ID[records.agentKind as AgentKind],
    }));
  }
  if (records.displayName !== undefined) {
    out.push(buildSetStringAttributeCall({ resolver, node, predicate: PREDICATE_ID.displayName, value: records.displayName }));
  }
  if (records.a2aEndpoint !== undefined) {
    out.push(buildSetStringAttributeCall({ resolver, node, predicate: PREDICATE_ID.a2aEndpoint, value: records.a2aEndpoint }));
  }
  if (records.mcpEndpoint !== undefined) {
    out.push(buildSetStringAttributeCall({ resolver, node, predicate: PREDICATE_ID.mcpEndpoint, value: records.mcpEndpoint }));
  }
  if (records.metadataUri !== undefined) {
    out.push(buildSetStringAttributeCall({ resolver, node, predicate: PREDICATE_ID.metadataUri, value: records.metadataUri }));
  }
  if (records.metadataHash !== undefined) {
    out.push(buildSetBytes32AttributeCall({ resolver, node, predicate: PREDICATE_ID.metadataHash, value: records.metadataHash }));
  }
  if (records.passkeyCredentialDigest !== undefined) {
    out.push(buildSetBytes32AttributeCall({ resolver, node, predicate: PREDICATE_ID.passkeyCredentialDigest, value: records.passkeyCredentialDigest }));
  }
  if (records.custodyPolicy !== undefined) {
    out.push(buildSetAddressAttributeCall({ resolver, node, predicate: PREDICATE_ID.custodyPolicy, value: records.custodyPolicy }));
  }
  if (records.nativeId !== undefined) {
    out.push(buildSetStringAttributeCall({ resolver, node, predicate: PREDICATE_ID.nativeId, value: records.nativeId }));
  }
  return out;
}

// ─── PermissionlessSubregistry ─────────────────────────────────────

/**
 * Build a call to claim `<label>.<parent>` through a deployed
 * PermissionlessSubregistry instance. The caller pays gas; the
 * registered child name is owned by `newOwner` (typically the
 * caller's own PSA OR an account they control).
 *
 * Anti-spam: one claim per `msg.sender` is enforced on chain; the
 * call reverts with `AlreadyClaimed(existingNode)` if the caller
 * has previously claimed a name through this subregistry instance.
 */
export function buildSubregistryRegisterCall(args: {
  subregistry: Address;
  label: string;
  newOwner: Address;
}): ContractCall {
  // AN-1: normalize + reject on the WRITE path (homoglyph/case/zero-width squat defense).
  const label = normalizeLabel(args.label);
  return {
    to: args.subregistry,
    value: 0n,
    data: encodeFunctionData({
      abi: permissionlessSubregistryAbi,
      functionName: 'register',
      args: [label, args.newOwner],
    }),
  };
}

/**
 * Convenience: re-export the encoded-record shape from records.ts so
 * downstream callers can pick whichever level of abstraction fits
 * (EncodedRecord = pre-typed-setter args; ContractCall = full
 * encoded call).
 */
export type { EncodedRecord };
