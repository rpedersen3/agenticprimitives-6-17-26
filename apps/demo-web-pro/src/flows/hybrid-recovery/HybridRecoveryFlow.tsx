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
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { config as deploymentConfig } from '../../config';
import { AddressChipInput, ModePill, shortAddress } from '../../components';

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
  const [guardians, setGuardians] = useState<Address[]>([]);

  const factoryAddress = deploymentConfig.factoryAddress;
  const validatorAddress = deploymentConfig.thresholdValidator;
  const expectedChainId = deploymentConfig.chainId;

  const params = useMemo(
    () =>
      connectedAddress
        ? ({
            mode: 1,
            owners: [connectedAddress],
            guardians,
            initialPasskeyCredentialIdDigest: ZERO_BYTES32,
            initialPasskeyX: 0n,
            initialPasskeyY: 0n,
          } as const)
        : null,
    [connectedAddress, guardians],
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
    abi: agentAccountFactoryAbi,
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
          abi: agentAccountFactoryAbi,
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
      abi: agentAccountFactoryAbi,
      functionName: 'createAccountWithMode',
      args: [params, validatorAddress, saltBigInt],
    });
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Works now</p>
        <h1>Deploy a hybrid AgentAccount</h1>
        <p>
          This is the one live demo path. It calls the factory to deploy an account in `hybrid`
          mode, installs `ThresholdValidator`, and records optional guardians at install time.
        </p>
      </div>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <p className="eyebrow">What you are doing</p>
        <h2>One chain write</h2>
        <ul className="status-list">
          <li className="approved"><span>✓</span>Use your connected wallet as the first owner.</li>
          <li className="approved"><span>✓</span>Optionally add guardian addresses for future recovery policy.</li>
          <li className="approved"><span>✓</span>Preview the deterministic CREATE2 account address.</li>
          <li className="approved"><span>✓</span>Submit `createAccountWithMode` to the configured factory.</li>
        </ul>
        <p className="muted">
          Not included yet: backup passkey registration, live recovery execution, high-risk agent
          delegation approval, org treasury execution.
        </p>
      </section>

      {!factoryAddress && (
        <p className="err">
          <code>VITE_FACTORY_ADDRESS</code> not set in this build. Redeploy via{' '}
          <code>pnpm deploy:cloudflare</code> from a checkout that has{' '}
          <code>deployments-base-sepolia.json</code>.
        </p>
      )}
      {!validatorAddress && factoryAddress && (
        <p className="err">
          <code>VITE_THRESHOLD_VALIDATOR</code> not set in this build.
        </p>
      )}

      {!isConnected && (
        <p className="muted">
          <strong>Connect a wallet first</strong> — the connected EOA becomes the primary signer.
        </p>
      )}

      {isConnected && wrongChain && (
        <p className="err">
          Wallet is on chain <code>{chainId}</code>. This demo targets chain{' '}
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

      <div className="split">
        <section className="card">
          <p className="eyebrow">Account configuration</p>
          <h2>Me plus backups</h2>
          <ModePill mode="hybrid" detail="T4 1h · T5 24h · T6 48h" />
          <p className="muted">
            Guardians are stored on the validator config. The full recovery UI is future work; this
            screen only deploys the account with those guardians.
          </p>
        <label className="field">
          <span>Primary owner</span>
          <input
            value={connectedAddress ?? '— not connected —'}
            readOnly
            data-testid="hybrid-recovery-owner"
          />
        </label>
        <label className="field">
          <span>Salt</span>
          <input
            value={salt}
            onChange={(e) => setSalt(e.target.value)}
            data-testid="hybrid-recovery-salt"
          />
          {saltBigInt === null && <small className="err">Salt must be a decimal integer.</small>}
        </label>
        <AddressChipInput
          label="Guardians"
          value={guardians}
          onChange={setGuardians}
          help={`${guardians.length} guardian(s). ${guardians.length >= 2 ? 'Recovery quorum is available.' : 'Add two or more for recovery quorum.'}`}
        />
        </section>

        <section className="card">
          <p className="eyebrow">Review</p>
          <h2>Account will deploy with</h2>
          <ul className="status-list">
            <li className="approved"><span>✓</span>Primary owner {connectedAddress ? shortAddress(connectedAddress) : 'not connected'}</li>
            <li className={guardians.length >= 2 ? 'approved' : 'pending'}><span>{guardians.length >= 2 ? '✓' : '○'}</span>{guardians.length} guardian(s)</li>
            <li className="approved"><span>✓</span>ThresholdValidator installed as executor module</li>
            <li className="pending"><span>○</span>Backup passkey registration is not live in this app</li>
          </ul>
          {predictedAddress && (
            <p className="muted">
              Your account will live at <code>{predictedAddress}</code>
            </p>
          )}
          <div className="actions">
            <button
              className="primary"
              onClick={handleDeploy}
              disabled={!ready || isWriting || isConfirming}
              data-testid="hybrid-recovery-deploy"
            >
              {isWriting ? 'Confirm in wallet…' : isConfirming ? 'Waiting for chain…' : isConfirmed ? 'Account ready' : 'Deploy account'}
            </button>
          </div>
          {txHash && (
            <p className="muted">
              Transaction: <code>{txHash}</code>
            </p>
          )}
          {writeError && (
            <p className="err" data-testid="hybrid-recovery-error">
              {writeError.message}
            </p>
          )}
        </section>
      </div>

      {isConfirmed && (
        <section className="card" style={{ marginTop: '1rem' }} data-testid="hybrid-recovery-success">
          <p className="eyebrow">Next best action</p>
          <h2 className="ok">Account ready</h2>
          <p>
            {deployedAddress ? (
              <>Deployed account <code>{deployedAddress}</code>.</>
            ) : (
              <>Transaction confirmed. Could not parse the account event, but the write succeeded.</>
            )}
          </p>
          <p>
            This demo stops here. Backup passkey registration and recovery execution are not wired in
            this app yet.
          </p>
          <div className="actions">
            <a href="#/">Back to what works now</a>
          </div>
        </section>
      )}
    </section>
  );
}
