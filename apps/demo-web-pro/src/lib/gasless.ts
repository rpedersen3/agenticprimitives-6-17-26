/**
 * useGaslessTx — runs a contract call through demo-a2a's relay endpoints
 * so the user pays NO gas. The smartAgentPaymaster sponsors the userOp;
 * the user signs the userOpHash with their connected wallet.
 *
 * Two endpoints:
 *   POST {demoA2aUrl}/account/build-call-userop  →  build unsigned userOp
 *   POST {demoA2aUrl}/account/submit-call-userop →  relay signed userOp via EntryPoint
 *
 * Two signatures from the user:
 *   1. EIP-712 typed-data (if the inner call requires one — e.g.
 *      validator admin proposals). Caller passes the sig as part of
 *      `callData` they build.
 *   2. The userOp hash itself. signMessage({raw: hash}) — MetaMask
 *      wraps with EIP-191. AgentAccount._verifyEcdsa tries raw recovery
 *      first then falls back to eth-signed wrap, so both work.
 *
 * Returns a hook with:
 *   submit({sender, callData}) — runs the full propose+sign+submit dance.
 *   state — 'idle' | 'building' | 'signing' | 'submitting' | 'done' | 'error'
 *   txHash — set after success
 *   error  — set on failure
 *   reset  — clear state to idle
 */

import { useState } from 'react';
import { useSignMessage } from 'wagmi';
import type { Address, Hex } from 'viem';
import { config } from '../config';

export type GaslessTxState = 'idle' | 'building' | 'signing' | 'submitting' | 'done' | 'error';

export interface GaslessTxResult {
  state: GaslessTxState;
  txHash: Hex | null;
  error: string | null;
  submit: (opts: { sender: Address; callData: Hex }) => Promise<Hex | null>;
  reset: () => void;
}

export function useGaslessTx(): GaslessTxResult {
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState<GaslessTxState>('idle');
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setState('idle');
    setTxHash(null);
    setError(null);
  };

  const submit = async ({ sender, callData }: { sender: Address; callData: Hex }) => {
    setError(null);
    setTxHash(null);
    if (!config.demoA2aUrl) {
      setError('demo-a2a URL not configured (VITE_DEMO_A2A_URL).');
      setState('error');
      return null;
    }

    try {
      setState('building');
      // CSRF bootstrap — fetch token (sets cookie + returns matching header value).
      const csrfRes = await fetch(`${config.demoA2aUrl}/auth/csrf`, { credentials: 'include' });
      if (!csrfRes.ok) throw new Error(`csrf bootstrap ${csrfRes.status}`);
      const { token: csrfToken } = (await csrfRes.json()) as { token: string };

      const buildRes = await fetch(`${config.demoA2aUrl}/account/build-call-userop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ sender, callData }),
      });
      if (!buildRes.ok) {
        const detail = await buildRes.text();
        throw new Error(`build-call-userop ${buildRes.status}: ${detail}`);
      }
      const build = (await buildRes.json()) as {
        userOp: Record<string, unknown> & { nonce: string; preVerificationGas: string };
        userOpHash: Hex;
      };

      setState('signing');
      const sig = await signMessageAsync({ message: { raw: build.userOpHash } });

      const signedUserOp = { ...build.userOp, signature: sig };

      setState('submitting');
      const submitRes = await fetch(`${config.demoA2aUrl}/account/submit-call-userop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ userOp: signedUserOp }),
      });
      if (!submitRes.ok) {
        const detail = await submitRes.text();
        throw new Error(`submit-call-userop ${submitRes.status}: ${detail}`);
      }
      const { transactionHash, status } = (await submitRes.json()) as {
        transactionHash: Hex;
        status: 'success' | 'reverted' | string;
      };
      setTxHash(transactionHash);
      // The HTTP response only tells us the userOp was submitted +
      // included in a block. The userOp itself can revert during
      // execution (insufficient gas, validator rejected, inner call
      // failed). Surface that as an error so the UI doesn't claim
      // success on a no-op tx.
      if (status !== 'success' && status !== '0x1') {
        throw new Error(
          `userOp included but reverted on chain (status=${status}). Inspect tx ${transactionHash} on basescan.org/sepolia.`,
        );
      }
      setState('done');
      return transactionHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState('error');
      return null;
    }
  };

  return { state, txHash, error, submit, reset };
}
