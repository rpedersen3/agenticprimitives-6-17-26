/**
 * Use case 1 — Individual user, seamless recovery (spec 207 § 4.1).
 *
 * Walks the user through creating a `hybrid`-mode AgentAccount:
 * one EOA + room for a backup passkey + optional guardians. After
 * deploy, the next-step prompt nudges adding a backup signer so the
 * account flips out of `single` into something recoverable.
 *
 * Status (phase 6c.5-c (c)): live wired against Base Sepolia. The
 * deploy button calls factory.createAccountWithMode + waits for the
 * receipt + parses the AgentAccountCreatedWithMode event to surface
 * the new account address.
 *
 * Paired doc: ../../../docs/multi-sig/flows/hybrid-recovery.md
 */

import { useMemo, useState } from 'react';
import { useAccount, useChainId, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { decodeEventLog, type Address } from 'viem';
import { config as deploymentConfig } from '../../config';

// Minimal ABI — only the surfaces this flow touches. Keeps the bundle
// small + makes the dependency on `apps/contracts/src/AgentAccountFactory.sol`
// readable.
const factoryAbi = [
  {
    type: 'function',
    name: 'createAccountWithMode',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'owners', type: 'address[]' },
          { name: 'guardians', type: 'address[]' },
          { name: 'initialPasskeyCredentialIdDigest', type: 'bytes32' },
          { name: 'initialPasskeyX', type: 'uint256' },
          { name: 'initialPasskeyY', type: 'uint256' },
        ],
      },
      { name: 'validator', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getAddressForMode',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'owners', type: 'address[]' },
          { name: 'guardians', type: 'address[]' },
          { name: 'initialPasskeyCredentialIdDigest', type: 'bytes32' },
          { name: 'initialPasskeyX', type: 'uint256' },
          { name: 'initialPasskeyY', type: 'uint256' },
        ],
      },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'AgentAccountCreatedWithMode',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'validator', type: 'address', indexed: true },
      { name: 'mode', type: 'uint8', indexed: true },
      { name: 'nOwners', type: 'uint256', indexed: false },
      { name: 'nGuardians', type: 'uint256', indexed: false },
      { name: 'salt', type: 'uint256', indexed: false },
    ],
  },
] as const;

const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

export function HybridRecoveryFlow() {
  const { address: connectedAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContract, data: txHash, isPending: isWriting, error: writeError, reset: resetWrite } =
    useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  const [salt, setSalt] = useState<string>(() => String(Math.floor(Math.random() * 1_000_000)));
  const [guardiansInput, setGuardiansInput] = useState<string>('');

  const factoryAddress = deploymentConfig.factoryAddress;
  const validatorAddress = deploymentConfig.thresholdValidator;
  const expectedChainId = deploymentConfig.chainId;

  const guardianList = useMemo<Address[]>(
    () =>
      guardiansInput
        .split(',')
        .map((g) => g.trim())
        .filter((g): g is Address => /^0x[0-9a-fA-F]{40}$/.test(g)),
    [guardiansInput],
  );

  const params = useMemo(
    () =>
      connectedAddress
        ? ({
            mode: 1,
            owners: [connectedAddress],
            guardians: guardianList,
            initialPasskeyCredentialIdDigest: ZERO_BYTES32,
            initialPasskeyX: 0n,
            initialPasskeyY: 0n,
          } as const)
        : null,
    [connectedAddress, guardianList],
  );

  const saltBigInt = useMemo(() => {
    try {
      return BigInt(salt);
    } catch {
      return null;
    }
  }, [salt]);

  // Counterfactual address preview — cheap, doesn't require a write.
  const { data: predictedAddress } = useReadContract({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: 'getAddressForMode',
    args: params && saltBigInt !== null ? [params, saltBigInt] : undefined,
    query: { enabled: !!params && saltBigInt !== null && !!factoryAddress },
  });

  const deployedAddress = useMemo<Address | null>(() => {
    if (!isConfirmed || !receipt) return null;
    // Parse the AgentAccountCreatedWithMode event from receipt logs.
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: factoryAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'AgentAccountCreatedWithMode') {
          return decoded.args.account;
        }
      } catch {
        // not our event
      }
    }
    return null;
  }, [isConfirmed, receipt]);

  const wrongChain = expectedChainId !== undefined && chainId !== expectedChainId;
  const ready = isConnected && !!factoryAddress && !!validatorAddress && !wrongChain && !!params && saltBigInt !== null;

  const handleDeploy = () => {
    if (!ready || !params || !factoryAddress || !validatorAddress || saltBigInt === null) return;
    resetWrite();
    writeContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: 'createAccountWithMode',
      args: [params, validatorAddress, saltBigInt],
    });
  };

  return (
    <section style={{ margin: '2rem 0' }}>
      <h2>Hybrid recovery</h2>
      <p className="muted">
        Spec 207 use case #1: create a <code>hybrid</code>-mode account with the connected EOA
        as the primary signer + optional guardians. Default install: T4 = 1h timelock, T5 = 24h,
        T6 = 48h; T3 ceiling = 0.01 ETH; recovery threshold ={' '}
        <code>floor(guardians/2)+1</code> when guardians &gt; 0.
      </p>

      {!factoryAddress && (
        <p className="err">
          ⚠️ <code>VITE_FACTORY_ADDRESS</code> not set in this build. Redeploy via{' '}
          <code>pnpm deploy:cloudflare</code> from a checkout that has{' '}
          <code>deployments-base-sepolia.json</code>.
        </p>
      )}
      {!validatorAddress && factoryAddress && (
        <p className="err">
          ⚠️ <code>VITE_THRESHOLD_VALIDATOR</code> not set in this build.
        </p>
      )}

      {!isConnected && (
        <p className="muted">
          <strong>Connect a wallet first</strong> — the connected EOA becomes the primary signer.
        </p>
      )}

      {isConnected && wrongChain && (
        <p className="err">
          ⚠️ Wallet is on chain <code>{chainId}</code>. This demo targets chain{' '}
          <code>{expectedChainId}</code> (Base Sepolia).{' '}
          <button
            onClick={() => expectedChainId && switchChain({ chainId: expectedChainId })}
            disabled={isSwitching}
            data-testid="hybrid-recovery-switch-chain"
          >
            {isSwitching ? 'Switching…' : 'Switch chain'}
          </button>
        </p>
      )}

      <div className="card">
        <h3>Account configuration</h3>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Primary owner (your connected wallet)
          <input
            value={connectedAddress ?? '— not connected —'}
            readOnly
            style={{ width: '100%', fontFamily: 'monospace', padding: '0.25rem' }}
            data-testid="hybrid-recovery-owner"
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Salt
          <input
            value={salt}
            onChange={(e) => setSalt(e.target.value)}
            style={{ width: '100%', padding: '0.25rem' }}
            data-testid="hybrid-recovery-salt"
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Guardians (comma-separated 0x addresses; optional for <code>hybrid</code>)
          <textarea
            value={guardiansInput}
            onChange={(e) => setGuardiansInput(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '0.25rem', fontFamily: 'monospace' }}
            data-testid="hybrid-recovery-guardians"
          />
          <small className="muted">
            Parsed: {guardianList.length} valid guardian(s)
            {guardianList.length === 0 && ' — none, account is hybrid-without-recovery'}
          </small>
        </label>
        {predictedAddress && (
          <p className="muted" style={{ marginTop: 8 }}>
            Predicted address: <code>{predictedAddress}</code>
          </p>
        )}
        <button
          onClick={handleDeploy}
          disabled={!ready || isWriting || isConfirming}
          data-testid="hybrid-recovery-deploy"
        >
          {isWriting
            ? 'Confirm in wallet…'
            : isConfirming
              ? 'Waiting for confirmation…'
              : 'Deploy hybrid account'}
        </button>
      </div>

      {writeError && (
        <p className="err" data-testid="hybrid-recovery-error">
          {writeError.message}
        </p>
      )}
      {txHash && !isConfirmed && (
        <p className="muted" data-testid="hybrid-recovery-tx-pending">
          Tx submitted: <code>{txHash}</code>
        </p>
      )}
      {isConfirmed && deployedAddress && (
        <div className="card">
          <h3 className="ok">✓ Account deployed</h3>
          <p>
            Address: <code>{deployedAddress}</code>
          </p>
          <p>
            Tx: <code>{txHash}</code>
          </p>
          <p className="muted">
            <strong>Next step (recommended):</strong> add a backup passkey so this account isn't
            bound to a single device. See spec § 8 for the recovery threshold + 48h timelock
            semantics.
          </p>
        </div>
      )}

      <p className="muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
        Walkthrough: <code>docs/multi-sig/flows/hybrid-recovery.md</code>
      </p>
    </section>
  );
}
