/**
 * Read-only chain queries (Base Sepolia by default).
 *
 * Use these for: predicting deployment addresses via getAddressForMode,
 * verifying that an account has code after a deploy, reading custody
 * policy state for the dashboard, etc.
 *
 * Public-RPC only. No wallet, no signing.
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { custodyPolicyAbi } from '@agenticprimitives/custody';
import { config } from '../config';

// Use the same RPC the worker uses (Alchemy on prod) when available;
// the public Base Sepolia node lags behind by enough blocks to cause
// read-after-write inconsistencies when reading state the worker
// just wrote (e.g. `getScheduledChange` returning the all-zero default
// for a just-scheduled change). Falling back to viem's default RPC
// is fine only for local anvil; in prod the env var is always set.
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(config.rpcUrl),
});

export interface AgentAccountInitParams {
  mode: number;
  custodians: readonly Address[];
  trustees: readonly Address[];
  initialPasskeyCredentialIdDigest: Hex;
  initialPasskeyX: bigint;
  initialPasskeyY: bigint;
}

/**
 * Predict the deployed AgentAccount address for given init params + salt.
 * Factory uses CREATE2 so this is deterministic before the tx broadcasts.
 */
export async function predictAccountAddress(args: {
  factoryAddress: Address;
  initParams: AgentAccountInitParams;
  salt: bigint;
}): Promise<Address> {
  return (await publicClient.readContract({
    address: args.factoryAddress,
    abi: agentAccountFactoryAbi,
    functionName: 'getAddressForAgentAccount',
    args: [args.initParams, args.salt],
  })) as Address;
}

/** True if the address has code (i.e. has been deployed). */
export async function hasCode(address: Address): Promise<boolean> {
  const bytecode = await publicClient.getBytecode({ address });
  return !!bytecode && bytecode !== '0x';
}

/**
 * Poll for `hasCode(address)` to flip true. Useful right after a
 * userOp submit returns ok — the bundler\'s tx is mined but the public
 * RPC node may lag by a few hundred ms before getCode reflects it.
 */
export async function waitForCode(
  address: Address,
  args: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const attempts = args.attempts ?? 10;
  const intervalMs = args.intervalMs ?? 750;
  for (let i = 0; i < attempts; i++) {
    if (await hasCode(address)) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/** Read scheduledChangeCount(account) — the highest issued change id. */
export async function readScheduledChangeCount(args: {
  custodyPolicy: Address;
  account: Address;
}): Promise<bigint> {
  return (await publicClient.readContract({
    address: args.custodyPolicy,
    abi: custodyPolicyAbi,
    functionName: 'scheduledChangeCount',
    args: [args.account],
  })) as bigint;
}

/**
 * Read a single scheduled change. When `waitForExistence` is true, polls
 * until `eta > 0` (the absence sentinel from the contract) or the
 * attempt budget is exhausted. Use `waitForExistence: true` right after
 * a schedule succeeds — the read might hit an RPC node that lags the
 * one the worker submitted to, and the all-zero default record would
 * otherwise be returned and silently mis-signed as `eta=0`.
 */
export async function readScheduledChange(args: {
  custodyPolicy: Address;
  account: Address;
  changeId: bigint;
  waitForExistence?: boolean;
  attempts?: number;
  intervalMs?: number;
}): Promise<{
  action: number;
  args: Hex;
  proposedAt: bigint;
  eta: bigint;
  proposer: Address;
  executed: boolean;
  cancelled: boolean;
}> {
  // viem normalizes multi-named-output functions to an OBJECT keyed by
  // the output names (not a positional tuple). Reading by name is the
  // only correct shape — positional access (`result[3]`) returns
  // undefined for objects, which viem then coerces to `0n` when the
  // value is fed back into `encodeAbiParameters` for the apply-hash.
  // That's the bug that mis-signed every apply userOp in the old
  // version of this helper. See feedback memory
  // `feedback-viem-multi-named-output-is-object`.
  const attempts = args.waitForExistence ? (args.attempts ?? 8) : 1;
  const intervalMs = args.intervalMs ?? 750;

  let lastResult: ReturnType<typeof shape> | null = null;
  for (let i = 0; i < attempts; i++) {
    const raw = (await publicClient.readContract({
      address: args.custodyPolicy,
      abi: custodyPolicyAbi,
      functionName: 'getScheduledChange',
      args: [args.account, args.changeId],
    })) as unknown;
    // Defensive: viem's typing suggests a labeled tuple, but for some
    // ABI shapes the runtime value is an object keyed by output name.
    // Handle both by destructuring named fields first, falling back to
    // positional access if the object form isn't present. This is the
    // bug surface that caused every apply userOp to sign an applyHash
    // with `eta=0` (see feedback memory
    // `feedback-viem-multi-named-output-is-object`).
    const r = raw as Record<string, unknown> & ReadonlyArray<unknown>;
    lastResult = shape(r);
    if (!args.waitForExistence || lastResult.eta > 0n) return lastResult;
    if (i < attempts - 1) await new Promise((res) => setTimeout(res, intervalMs));
  }
  // All retries exhausted; return whatever we last saw (the caller can
  // inspect `eta == 0n` to know the change isn't visible yet on this RPC).
  return lastResult!;
}

function shape(r: Record<string, unknown> & ReadonlyArray<unknown>) {
  return {
    action: (r.action ?? r[0]) as number,
    args: (r.args ?? r[1]) as Hex,
    proposedAt: (r.proposedAt ?? r[2]) as bigint,
    eta: (r.eta ?? r[3]) as bigint,
    proposer: (r.proposer ?? r[4]) as Address,
    executed: (r.executed ?? r[5]) as boolean,
    cancelled: (r.cancelled ?? r[6]) as boolean,
  };
}

/**
 * Read `approvalsRequired(account, tier)` from the CustodyPolicy — the
 * current m-of-n threshold for the given risk tier. Used to detect
 * when Act 4's `ChangeApprovalsRequired(T4, 2)` has actually landed.
 */
export async function readApprovalsRequired(args: {
  custodyPolicy: Address;
  account: Address;
  tier: number;
}): Promise<number> {
  const v = (await publicClient.readContract({
    address: args.custodyPolicy,
    abi: custodyPolicyAbi,
    functionName: 'approvalsRequired',
    args: [args.account, args.tier],
  })) as unknown as number | bigint;
  return Number(v);
}

/** Read the per-tier safety delay from the CustodyPolicy. */
export async function readSafetyDelay(args: {
  custodyPolicy: Address;
  account: Address;
  tier: number;
}): Promise<number> {
  const value = (await publicClient.readContract({
    address: args.custodyPolicy,
    abi: custodyPolicyAbi,
    functionName: 'safetyDelay',
    args: [args.account, args.tier],
  })) as unknown as number | bigint;
  return Number(value);
}

/**
 * Read `isCustodian(signer)` on an AgentAccount. When `waitForTrue` is
 * set, polls until the read returns true or the attempt budget is
 * exhausted — Alchemy (and other RPC providers) can serve stale state
 * for a few seconds after a tx is confirmed because reads can land on
 * a different replica than the one the tx was indexed against. The
 * apply ceremony in Acts 3/4 calls this right after the apply tx
 * succeeds, so without polling the verify spuriously fails even though
 * the on-chain state IS correct.
 */
export async function readIsCustodian(args: {
  account: Address;
  signer: Address;
  waitForTrue?: boolean;
  attempts?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const isCustodianAbi = [
    {
      type: 'function',
      name: 'isCustodian',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ type: 'bool' }],
    },
  ] as const;
  const attempts = args.waitForTrue ? (args.attempts ?? 8) : 1;
  const intervalMs = args.intervalMs ?? 750;
  let last = false;
  for (let i = 0; i < attempts; i++) {
    last = (await publicClient.readContract({
      address: args.account,
      abi: isCustodianAbi,
      functionName: 'isCustodian',
      args: [args.signer],
    })) as boolean;
    if (!args.waitForTrue || last) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

/**
 * Read the factory address an AgentAccount was deployed by. Returns
 * null if the address isn't an AgentAccount (call reverts, no code,
 * etc.). Used to detect demo-state pointing at a stranded Org or
 * Treasury after a contract redeploy — those accounts still exist on
 * chain but the current CustodyPolicy isn't installed on them, so any
 * admin action would revert with `NotInstalledOn`.
 */
/**
 * Read the deployer EOA's wei balance. Used by the top-bar gas readout so
 * the visitor sees when the bundler/deployer is running low and needs a
 * refill before more deploys can happen.
 */
export async function readBalance(addr: Address): Promise<bigint> {
  return publicClient.getBalance({ address: addr });
}

/**
 * Read the EntryPoint's `balanceOf(paymaster)` view — the paymaster's
 * sponsorship deposit. When this approaches zero, gasless userOps start
 * failing with `AA31 paymaster deposit too low`. Top up by calling
 * `paymaster.deposit{value: ...}()` from any EOA.
 */
export async function readPaymasterDeposit(
  entryPoint: Address,
  paymaster: Address,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: entryPoint,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [paymaster],
  })) as bigint;
}

export async function readAccountFactory(account: Address): Promise<Address | null> {
  try {
    const factoryAbi = [
      {
        type: 'function',
        name: 'factory',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'address' }],
      },
    ] as const;
    return (await publicClient.readContract({
      address: account,
      abi: factoryAbi,
      functionName: 'factory',
    })) as Address;
  } catch {
    return null;
  }
}
