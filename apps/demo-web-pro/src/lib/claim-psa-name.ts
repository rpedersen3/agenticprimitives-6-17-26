/**
 * claim-psa-name.ts — auto-claim `<label>.demo.agent` for a freshly
 * deployed Person Smart Agent.
 *
 * Two on-chain steps, both gasless via the PSA's passkey path:
 *   1. PermissionlessSubregistry.register(label, psa) — claims the
 *      subname for the PSA. Caps at one claim per PSA (caller).
 *   2. AgentNameRegistry.setPrimaryName(node) — sets the PSA's reverse
 *      record so `reverseResolve(psa)` returns the new node and the
 *      NameDisplay component shows `<label>.demo.agent` everywhere
 *      the PSA's address renders.
 *
 * Best-effort: if the label is already taken globally OR the PSA has
 * already claimed a different name, returns a structured error so the
 * caller can render a hint without blocking the success state.
 */

import { keccak256, encodePacked, toHex, type Address, type Hex } from 'viem';
import {
  buildSubregistryRegisterCall,
  buildSetPrimaryNameCall,
} from '@agenticprimitives/agent-naming';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import { config } from '../config';
import { executeCallFromAgent } from './execute-call';
import type { DemoPasskey } from './passkey';

export type ClaimPsaNameResult =
  | { ok: true; name: string; registerTx?: Hex; primaryTx?: Hex }
  | { ok: false; reason: string };

const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

/** Compute namehash off-chain — matches the on-chain registry. */
function namehash(name: string): Hex {
  if (name === '') return ZERO_NODE;
  const labels = name.split('.');
  let node: Hex = ZERO_NODE;
  for (let i = labels.length - 1; i >= 0; i--) {
    const lh = keccak256(toHex(labels[i]!));
    node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, lh]));
  }
  return node;
}

export async function claimPsaName(args: {
  /** The label to register under demo.agent (3+ chars, a-z 0-9 -). */
  label: string;
  /** The Person Smart Agent's address. */
  personAgent: Address;
  /** The passkey bound to the PSA via its custodian set. */
  passkey: DemoPasskey;
}): Promise<ClaimPsaNameResult> {
  const { label, personAgent, passkey } = args;
  if (!config.permissionlessSubregistry || !config.agentNameRegistry) {
    return { ok: false, reason: 'naming contracts not configured (subregistry / registry missing)' };
  }
  if (!/^[a-z0-9-]{3,}$/.test(label)) {
    return { ok: false, reason: `label "${label}" must match /^[a-z0-9-]{3,}$/` };
  }

  // Step 1 — subregistry.register(label, personAgent).
  let registerTx: Hex | undefined;
  {
    const call = buildSubregistryRegisterCall({
      subregistry: config.permissionlessSubregistry,
      label,
      newOwner: personAgent,
    });
    const callData = buildExecuteCallData({
      to: call.to as Address,
      value: call.value,
      data: call.data as Hex,
    });
    const result = await executeCallFromAgent({
      sender: personAgent,
      passkey,
      callData,
    });
    if (!result.ok) {
      const reason = (result.reason ?? '').toLowerCase();
      // AlreadyClaimed → the PSA already has a name. Try to proceed to
      // setPrimaryName for the assumed-existing <label>.demo.agent
      // node; if that fails too, surface a clean error.
      if (reason.includes('alreadyclaimed')) {
        // Fall through to step 2; the PSA may have already registered
        // this exact label in a prior run.
      } else if (reason.includes('nodealreadyexists')) {
        return { ok: false, reason: `"${label}.demo.agent" is already taken by another caller.` };
      } else {
        return { ok: false, reason: result.reason ?? result.error };
      }
    } else {
      registerTx = result.transactionHash;
    }
  }

  // Step 2 — setPrimaryName for the PSA.
  const node = namehash(`${label}.demo.agent`);
  let primaryTx: Hex | undefined;
  {
    const call = buildSetPrimaryNameCall({
      registry: config.agentNameRegistry,
      node,
    });
    const callData = buildExecuteCallData({
      to: call.to as Address,
      value: call.value,
      data: call.data as Hex,
    });
    const result = await executeCallFromAgent({
      sender: personAgent,
      passkey,
      callData,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: `setPrimaryName failed: ${result.reason ?? result.error}` +
          (registerTx ? ` (register OK — node ${node.slice(0, 10)}…)` : ''),
      };
    }
    primaryTx = result.transactionHash;
  }

  return { ok: true, name: `${label}.demo.agent`, registerTx, primaryTx };
}
