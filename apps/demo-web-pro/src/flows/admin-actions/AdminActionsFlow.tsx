/**
 * Admin actions — propose + execute admin-tier changes through the
 * CustodyPolicy's EIP-712 typed-data surface (spec 207 § 15,
 * phase 6c.5-f).
 *
 * Supported actions in this flow (T4 tier, 1h timelock default):
 *   - AddOwner          uint8 = 0
 *   - RemoveOwner       uint8 = 1
 *   - AddGuardian       uint8 = 4
 *   - RemoveGuardian    uint8 = 5
 *   - ChangeMode        uint8 = 6
 *
 * Higher tiers (T5 UpgradeImpl, T6 RecoverAccount) need their own
 * flow because of longer timelocks + different signer-set semantics.
 *
 * Paired doc: ../../../docs/multi-sig/flows/admin-actions.md
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useChainId,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
} from 'wagmi';
import {
  isAddress,
  keccak256,
  encodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { config as deploymentConfig } from '../../config';
import { shortAddress } from '../../components';
import { useGaslessTx } from '../../lib/gasless';

const validatorAbi = [
  {
    type: 'function',
    name: 'proposeAdmin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'action', type: 'uint8' },
      { name: 'args', type: 'bytes' },
      { name: 'quorumSigs', type: 'bytes' },
    ],
    outputs: [{ name: 'proposalId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'executeAdmin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'proposalId', type: 'uint256' },
      { name: 'quorumSigs', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isInstalledOn',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'proposalCount',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'timelockDuration',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ type: 'uint32' }],
  },
  {
    type: 'function',
    name: 'getPendingAdmin',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'proposalId', type: 'uint256' },
    ],
    outputs: [
      { name: 'action', type: 'uint8' },
      { name: 'args', type: 'bytes' },
      { name: 'proposedAt', type: 'uint64' },
      { name: 'eta', type: 'uint64' },
      { name: 'proposer', type: 'address' },
      { name: 'executed', type: 'bool' },
      { name: 'cancelled', type: 'bool' },
    ],
  },
] as const;

const ACTIONS = [
  { id: 0, label: 'AddOwner',       description: 'Add an EOA to the account\'s owner set.' },
  { id: 1, label: 'RemoveOwner',    description: 'Remove an EOA from the owner set. Last-signer guard enforced on chain.' },
  { id: 4, label: 'AddGuardian',    description: 'Add a guardian (recovery role; cannot spend).' },
  { id: 5, label: 'RemoveGuardian', description: 'Remove a guardian. Recovery-threshold invariant enforced on chain.' },
  { id: 6, label: 'ChangeMode',     description: 'Switch the account between single / hybrid / threshold / org modes.' },
] as const;
type ActionId = (typeof ACTIONS)[number]['id'];

type Phase = 'configure' | 'propose-signing' | 'propose-pending' | 'await-timelock' | 'execute-signing' | 'execute-pending' | 'done';

export function AdminActionsFlow() {
  const { address: signerAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { signTypedDataAsync, error: signError, reset: resetSign } = useSignTypedData();
  const gasless = useGaslessTx();

  const validatorAddress = deploymentConfig.thresholdValidator;
  const expectedChainId = deploymentConfig.chainId;

  const [account, setAccount] = useState<string>('');
  const [actionId, setActionId] = useState<ActionId>(0);
  const [argInput, setArgInput] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('configure');
  const [proposalId, setProposalId] = useState<bigint | null>(null);
  const [proposalEta, setProposalEta] = useState<bigint | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const accountAddr = isAddress(account) ? (account as Address) : null;

  const { data: isInstalled } = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'isInstalledOn',
    args: accountAddr ? [accountAddr] : undefined,
    query: { enabled: !!accountAddr && !!validatorAddress },
  });

  const { data: timelockSeconds } = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'timelockDuration',
    args: accountAddr ? [accountAddr, 4] : undefined,
    query: { enabled: !!accountAddr && !!validatorAddress },
  });

  const { data: proposalCountData, refetch: refetchProposalCount } = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'proposalCount',
    args: accountAddr ? [accountAddr] : undefined,
    query: { enabled: !!accountAddr && !!validatorAddress },
  });

  const { data: pendingProposal, refetch: refetchPending } = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'getPendingAdmin',
    args: accountAddr && proposalId !== null ? [accountAddr, proposalId] : undefined,
    query: { enabled: !!accountAddr && proposalId !== null },
  });

  // Decode args based on action.
  const encodedArgs = useMemo<Hex | null>(() => {
    try {
      if (actionId === 0 || actionId === 1 || actionId === 4 || actionId === 5) {
        if (!isAddress(argInput)) return null;
        return encodeAbiParameters([{ type: 'address' }], [argInput as Address]);
      }
      if (actionId === 6) {
        const m = Number(argInput);
        if (!Number.isInteger(m) || m < 0 || m > 3) return null;
        return encodeAbiParameters([{ type: 'uint8' }], [m]);
      }
      return null;
    } catch {
      return null;
    }
  }, [actionId, argInput]);

  const wrongChain = expectedChainId !== undefined && chainId !== expectedChainId;
  const ready = isConnected && !!validatorAddress && !wrongChain && !!accountAddr && isInstalled === true && !!encodedArgs;

  // Track gasless.state → phase transitions.
  useEffect(() => {
    if (gasless.state !== 'done') return;
    if (phase === 'propose-pending') {
      refetchProposalCount().then((result) => {
        const count = result.data as bigint | undefined;
        if (count !== undefined) {
          setProposalId(count);
          setPhase('await-timelock');
          gasless.reset();
        }
      });
    } else if (phase === 'execute-pending') {
      setPhase('done');
    }
  }, [gasless, phase, refetchProposalCount]);

  // When proposalId set, pull the stored eta.
  useEffect(() => {
    if (proposalId === null || !pendingProposal) return;
    const eta = pendingProposal[3] as bigint;
    setProposalEta(eta);
  }, [proposalId, pendingProposal]);

  // Refetch pending periodically to refresh "ready to execute" countdown.
  useEffect(() => {
    if (phase !== 'await-timelock') return;
    const t = setInterval(() => refetchPending(), 5000);
    return () => clearInterval(t);
  }, [phase, refetchPending]);

  const reset = () => {
    setPhase('configure');
    setProposalId(null);
    setProposalEta(null);
    setSubmitError(null);
    resetSign();
    gasless.reset();
  };

  // ─── Propose step ─────────────────────────────────────────────────

  const handlePropose = async () => {
    if (!ready || !accountAddr || !encodedArgs || !validatorAddress || !expectedChainId) return;
    setSubmitError(null);
    setPhase('propose-signing');
    try {
      const nextId = ((proposalCountData as bigint) ?? 0n) + 1n;
      const argsHash = keccak256(encodedArgs);

      const sig = await signTypedDataAsync({
        domain: {
          name: 'agenticprimitives.CustodyPolicy',
          version: '1',
          chainId: expectedChainId,
          verifyingContract: validatorAddress,
        },
        types: {
          AdminProposeRequest: [
            { name: 'account', type: 'address' },
            { name: 'action', type: 'uint8' },
            { name: 'argsHash', type: 'bytes32' },
            { name: 'proposalId', type: 'uint256' },
          ],
        },
        primaryType: 'AdminProposeRequest',
        message: {
          account: accountAddr,
          action: actionId,
          argsHash,
          proposalId: nextId,
        },
      });

      const quorumSigs = sig as Hex;

      // Build the inner call (validator.proposeAdmin) + wrap in
      // account.execute so the userOp's sender is the smart account.
      const inner = encodeFunctionData({
        abi: validatorAbi,
        functionName: 'proposeAdmin',
        args: [accountAddr, actionId, encodedArgs, quorumSigs],
      });
      const outer = encodeFunctionData({
        abi: ACCOUNT_EXECUTE_ABI,
        functionName: 'execute',
        args: [validatorAddress, 0n, inner],
      });

      setPhase('propose-pending');
      gasless.reset();
      await gasless.submit({ sender: accountAddr, callData: outer });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setPhase('configure');
    }
  };

  // ─── Execute step ─────────────────────────────────────────────────

  const handleExecute = async () => {
    if (
      !ready ||
      !accountAddr ||
      !encodedArgs ||
      !validatorAddress ||
      !expectedChainId ||
      proposalId === null ||
      proposalEta === null
    )
      return;
    setSubmitError(null);
    setPhase('execute-signing');
    try {
      const argsHash = keccak256(encodedArgs);
      const sig = await signTypedDataAsync({
        domain: {
          name: 'agenticprimitives.CustodyPolicy',
          version: '1',
          chainId: expectedChainId,
          verifyingContract: validatorAddress,
        },
        types: {
          AdminExecuteRequest: [
            { name: 'account', type: 'address' },
            { name: 'action', type: 'uint8' },
            { name: 'argsHash', type: 'bytes32' },
            { name: 'proposalId', type: 'uint256' },
            { name: 'eta', type: 'uint64' },
          ],
        },
        primaryType: 'AdminExecuteRequest',
        message: {
          account: accountAddr,
          action: actionId,
          argsHash,
          proposalId,
          eta: proposalEta,
        },
      });

      const inner = encodeFunctionData({
        abi: validatorAbi,
        functionName: 'executeAdmin',
        args: [accountAddr, proposalId, sig as Hex],
      });
      const outer = encodeFunctionData({
        abi: ACCOUNT_EXECUTE_ABI,
        functionName: 'execute',
        args: [validatorAddress, 0n, inner],
      });

      setPhase('execute-pending');
      gasless.reset();
      await gasless.submit({ sender: accountAddr, callData: outer });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setPhase('await-timelock');
    }
  };

  // Tiny inline ABI for account.execute(target, value, data).
  const ACCOUNT_EXECUTE_ABI = useMemo(() => [
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
  ] as const, []);

  // ─── Derived rendering data ───────────────────────────────────────

  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = proposalEta !== null ? Math.max(0, Number(proposalEta) - now) : null;
  const canExecuteNow = secondsLeft !== null && secondsLeft <= 0;

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Capability · Admin action</p>
        <h1>Propose, wait, execute.</h1>
        <p>
          T4 admin actions go through the validator's propose / execute path. Your wallet signs an
          EIP-712 typed-data request (MetaMask shows the structured fields); a tx submits the
          proposal; after the T4 timelock elapses (1h default), a second signature + tx executes.
        </p>
      </div>

      {!validatorAddress && (
        <p className="err">
          <code>VITE_THRESHOLD_VALIDATOR</code> not set in this build.
        </p>
      )}
      {!isConnected && <p className="muted">Connect a wallet first — owner signature is required.</p>}
      {isConnected && wrongChain && (
        <p className="err">
          Wallet is on chain <code>{chainId}</code>. This demo targets chain{' '}
          <code>{expectedChainId}</code> (Base Sepolia).{' '}
          <button
            onClick={() => expectedChainId && switchChain({ chainId: expectedChainId })}
            disabled={isSwitching}
          >
            {isSwitching ? 'Switching…' : 'Switch chain'}
          </button>
        </p>
      )}

      <div className="split">
        <section className="card">
          <p className="eyebrow">Configure</p>
          <h2>Action</h2>
          <label className="field">
            <span>AgentAccount</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value.trim())}
              placeholder="0x…"
              data-testid="admin-action-account"
              spellCheck={false}
            />
            {account && !accountAddr && <small className="err">Not a valid 0x address.</small>}
            {accountAddr && isInstalled === false && (
              <small className="err">
                Validator is not installed on this account. Use the create-account flow against
                this validator to get an account with admin support.
              </small>
            )}
          </label>

          <label className="field">
            <span>Action</span>
            <select
              value={actionId}
              onChange={(e) => {
                setActionId(Number(e.target.value) as ActionId);
                setArgInput('');
              }}
              data-testid="admin-action-type"
            >
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.label}
                </option>
              ))}
            </select>
            <small className="muted">{ACTIONS.find((a) => a.id === actionId)?.description}</small>
          </label>

          {(actionId === 0 || actionId === 1 || actionId === 4 || actionId === 5) && (
            <label className="field">
              <span>Address</span>
              <input
                value={argInput}
                onChange={(e) => setArgInput(e.target.value.trim())}
                placeholder="0x…"
                data-testid="admin-action-arg-address"
                spellCheck={false}
              />
              {argInput && !isAddress(argInput) && <small className="err">Not a valid 0x address.</small>}
            </label>
          )}
          {actionId === 6 && (
            <label className="field">
              <span>New mode</span>
              <select
                value={argInput}
                onChange={(e) => setArgInput(e.target.value)}
                data-testid="admin-action-arg-mode"
              >
                <option value="">— pick a mode —</option>
                <option value="0">0 · single</option>
                <option value="1">1 · hybrid</option>
                <option value="2">2 · threshold</option>
                <option value="3">3 · org</option>
              </select>
            </label>
          )}

          <p className="muted" style={{ fontSize: '0.85rem' }}>
            T4 timelock on this account:{' '}
            <code>{timelockSeconds !== undefined ? `${Number(timelockSeconds)}s` : '—'}</code>{' '}
            ({timelockSeconds !== undefined ? formatDuration(Number(timelockSeconds)) : '—'})
          </p>
        </section>

        <section className="card">
          <p className="eyebrow">{phase === 'configure' ? 'Step 1 of 2' : phase === 'done' ? 'Done' : 'In progress'}</p>
          <h2>{phaseTitle(phase)}</h2>

          <ol className="status-list" style={{ marginTop: '0.5rem' }}>
            <li className={phase === 'configure' ? 'pending' : 'approved'}>
              <span>{phase === 'configure' ? '○' : '✓'}</span>
              Propose (sign + send tx)
            </li>
            <li
              className={
                phase === 'await-timelock' || phase === 'execute-signing' || phase === 'execute-pending'
                  ? 'pending'
                  : phase === 'done'
                    ? 'approved'
                    : ''
              }
            >
              <span>{phase === 'done' ? '✓' : phase === 'await-timelock' || phase === 'execute-signing' || phase === 'execute-pending' ? '○' : ''}</span>
              Wait for T4 timelock
            </li>
            <li className={phase === 'done' ? 'approved' : phase === 'execute-signing' || phase === 'execute-pending' ? 'pending' : ''}>
              <span>{phase === 'done' ? '✓' : phase === 'execute-signing' || phase === 'execute-pending' ? '○' : ''}</span>
              Execute (sign + send tx)
            </li>
          </ol>

          {phase === 'configure' && (
            <button
              className="primary"
              onClick={handlePropose}
              disabled={!ready || gasless.state === 'building' || gasless.state === 'signing' || gasless.state === 'submitting'}
              data-testid="admin-action-propose"
              style={{ marginTop: '1rem' }}
            >
              {gasless.state === 'building' ? 'Building userOp…' : gasless.state === 'signing' ? 'Confirm in wallet…' : gasless.state === 'submitting' ? 'Submitting…' : 'Propose (gasless)'}
            </button>
          )}

          {phase === 'propose-signing' && <p className="muted">Sign the EIP-712 request in MetaMask…</p>}
          {phase === 'propose-pending' && gasless.txHash && (
            <p className="muted">
              Propose tx submitted: <code>{shortAddress(gasless.txHash)}</code>. Waiting for confirmation…
            </p>
          )}

          {phase === 'await-timelock' && (
            <div style={{ marginTop: '1rem' }}>
              <p>
                Proposal <code>#{proposalId !== null ? String(proposalId) : '—'}</code> queued. Ready
                to execute{' '}
                {secondsLeft !== null && secondsLeft > 0 ? (
                  <>
                    in <strong>{formatDuration(secondsLeft)}</strong> (ETA{' '}
                    <code>{proposalEta !== null ? new Date(Number(proposalEta) * 1000).toLocaleString() : '—'}</code>
                    ).
                  </>
                ) : (
                  <>now.</>
                )}
              </p>
              <button
                className="primary"
                onClick={handleExecute}
                disabled={!canExecuteNow}
                data-testid="admin-action-execute"
              >
                {canExecuteNow ? 'Execute' : `Wait ${formatDuration(secondsLeft ?? 0)}`}
              </button>
            </div>
          )}

          {phase === 'execute-signing' && <p className="muted">Sign the execute request in MetaMask…</p>}
          {phase === 'execute-pending' && gasless.txHash && (
            <p className="muted">
              Execute tx submitted: <code>{shortAddress(gasless.txHash)}</code>. Waiting for confirmation…
            </p>
          )}

          {phase === 'done' && (
            <p className="ok" data-testid="admin-action-done">
              ✓ Action applied on chain (gasless). Tx <code>{gasless.txHash}</code>.{' '}
              <button onClick={reset}>Run another</button>
            </p>
          )}

          {submitError && <p className="err">{submitError}</p>}
          {signError && <p className="err">Sign error: {signError.message}</p>}
          {gasless.error && <p className="err">{gasless.error}</p>}
        </section>
      </div>

      <p className="muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
        Walkthrough: <code>docs/multi-sig/flows/admin-actions.md</code> · Spec 207 § 15
      </p>
    </section>
  );
}

function phaseTitle(phase: Phase): string {
  switch (phase) {
    case 'configure':       return 'Build the proposal';
    case 'propose-signing': return 'Sign propose…';
    case 'propose-pending': return 'Awaiting propose confirmation…';
    case 'await-timelock':  return 'Timelock running';
    case 'execute-signing': return 'Sign execute…';
    case 'execute-pending': return 'Awaiting execute confirmation…';
    case 'done':            return 'Done';
  }
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
