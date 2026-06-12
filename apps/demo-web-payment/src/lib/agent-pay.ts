/**
 * Gasless SA execution (the project's canonical-identifier doctrine + paymaster).
 *
 * Every payment runs AS a Smart Agent via a paymaster-sponsored ERC-4337 UserOp:
 *   AgentAccount.execute(target, value, data) → built + sponsored by demo-a2a's
 *   SmartAgentPaymaster, signed by the custodian wallet (userOpHash), submitted by the
 *   relayer. Money moves SA → SA; the user pays NO gas. (Same path as demo-web-pro/gasless.ts.)
 *
 * The custodian EOA only SIGNS (the userOpHash) — it never holds or moves USDC.
 */

import { encodeFunctionData, type Address, type Hex } from 'viem';
import { config } from '../config';
import { ensureCsrfToken, csrfHeaders } from './csrf';
import type { PaymentWallet } from './wallet';

const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/** Encode `AgentAccount.execute(target, value, data)` — the SA's outer call. */
export function encodeExecute(target: Address, value: bigint, data: Hex): Hex {
  return encodeFunctionData({ abi: EXECUTE_ABI, functionName: 'execute', args: [target, value, data] });
}

/**
 * Execute `inner` (a call to `target`) AS `sa`, gaslessly. Builds a sponsored UserOp via
 * demo-a2a, the custodian wallet signs the userOpHash, the relayer submits it. Returns the
 * settlement tx hash. Throws if the userOp reverts on-chain.
 */
export async function executeViaSa(wallet: PaymentWallet, sa: Address, target: Address, value: bigint, inner: Hex): Promise<Hex> {
  const account = wallet.account?.address;
  if (!account) throw new Error('wallet not connected');
  const base = config.demoA2aUrl;
  if (!base) throw new Error('demo-a2a URL not configured');
  await ensureCsrfToken();

  const callData = encodeExecute(target, value, inner);
  const buildRes = await fetch(`${base.replace(/\/$/, '')}/account/build-call-userop`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ sender: sa, callData }),
  });
  if (!buildRes.ok) throw new Error(`build-call-userop ${buildRes.status}: ${(await buildRes.text()).slice(0, 200)}`);
  const build = (await buildRes.json()) as { userOp: Record<string, unknown>; userOpHash: Hex };

  const signature = await wallet.signMessage({ account, message: { raw: build.userOpHash } });

  const submitRes = await fetch(`${base.replace(/\/$/, '')}/account/submit-call-userop`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...build.userOp, signature } }),
  });
  if (!submitRes.ok) throw new Error(`submit-call-userop ${submitRes.status}: ${(await submitRes.text()).slice(0, 200)}`);
  const { transactionHash, status } = (await submitRes.json()) as { transactionHash: Hex; status: string };
  if (status !== 'success' && status !== '0x1') {
    throw new Error(`userOp included but reverted (status=${status}) — inspect ${transactionHash} on basescan.`);
  }
  return transactionHash;
}
