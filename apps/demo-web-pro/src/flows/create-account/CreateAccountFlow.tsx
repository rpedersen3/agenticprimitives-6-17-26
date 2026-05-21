/**
 * Create AgentAccount — supports all 4 factory modes (single / hybrid /
 * threshold / org). Validator gets installed atomically in the same tx;
 * downstream capabilities (admin actions, recovery) target it.
 *
 * Status: live against Base Sepolia. The deploy button calls
 * factory.createAccountWithMode + waits for the receipt + parses the
 * AgentAccountCreatedWithMode event to surface the new address.
 *
 * Paired doc: ../../../docs/multi-sig/flows/create-account.md
 */

import { useMemo, useState } from 'react';
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { decodeEventLog, type Address } from 'viem';
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { config as deploymentConfig } from '../../config';
import { AddressChipInput, ModePill, shortAddress } from '../../components';

const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

type Mode = 0 | 1 | 2 | 3;
const MODE_LABEL: Record<Mode, string> = {
  0: 'single',
  1: 'hybrid',
  2: 'threshold',
  3: 'org',
};
const MODE_GUARDIAN_MIN: Record<Mode, number> = { 0: 0, 1: 0, 2: 2, 3: 3 };
const MODE_DESCRIPTION: Record<Mode, string> = {
  0: 'Just me — single EOA owner. No guardians, no quorum. Simplest demo path.',
  1: 'Me plus backups — primary EOA + optional guardians for recovery. Default consumer shape.',
  2: 'Multiple approvers — N owners + ≥ 2 guardians for recovery. Quorum required for admin actions.',
  3: 'Organization — N owners + ≥ 3 guardians + separation-of-duties (any signer that proposes cannot also execute).',
};

export function CreateAccountFlow() {
  const { address: connectedAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const {
    writeContract,
    data: txHash,
    isPending: isWriting,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const [mode, setMode] = useState<Mode>(1);
  const [salt, setSalt] = useState<string>(() => String(Math.floor(Math.random() * 1_000_000)));
  const [extraOwners, setExtraOwners] = useState<Address[]>([]);
  const [guardians, setGuardians] = useState<Address[]>([]);
  // T4 admin-action timelock. 0 = spec default (1h). The factory's
  // createAccountWithModeCustomT4 entry lets us override at install time.
  const [t4Timelock, setT4Timelock] = useState<number>(0);

  const factoryAddress = deploymentConfig.factoryAddress;
  const validatorAddress = deploymentConfig.thresholdValidator;
  const expectedChainId = deploymentConfig.chainId;

  const owners = useMemo<Address[]>(
    () => (connectedAddress ? [connectedAddress, ...extraOwners] : extraOwners),
    [connectedAddress, extraOwners],
  );

  const guardianMin = MODE_GUARDIAN_MIN[mode];
  const guardianShortfall = Math.max(0, guardianMin - guardians.length);

  const params = useMemo(
    () =>
      connectedAddress
        ? ({
            mode,
            owners,
            guardians,
            initialPasskeyCredentialIdDigest: ZERO_BYTES32,
            initialPasskeyX: 0n,
            initialPasskeyY: 0n,
          } as const)
        : null,
    [connectedAddress, mode, owners, guardians],
  );

  const saltBigInt = useMemo(() => {
    try {
      return BigInt(salt);
    } catch {
      return null;
    }
  }, [salt]);

  const { data: predictedAddress } = useReadContract({
    address: factoryAddress,
    abi: agentAccountFactoryAbi,
    functionName: 'getAddressForMode',
    args: params && saltBigInt !== null ? [params, saltBigInt] : undefined,
    query: { enabled: !!params && saltBigInt !== null && !!factoryAddress && guardianShortfall === 0 },
  });

  const deployedAddress = useMemo<Address | null>(() => {
    if (!isConfirmed || !receipt) return null;
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
  const ready =
    isConnected &&
    !!factoryAddress &&
    !!validatorAddress &&
    !wrongChain &&
    !!params &&
    saltBigInt !== null &&
    guardianShortfall === 0;

  const handleDeploy = () => {
    if (!ready || !params || !factoryAddress || !validatorAddress || saltBigInt === null) return;
    resetWrite();
    // Always route through the custom-T4 entry; the contract treats
    // t4TimelockSeconds=0 as "use spec default (1h)" so passing 0 from
    // the dropdown is equivalent to the simple createAccountWithMode path.
    writeContract({
      address: factoryAddress,
      abi: agentAccountFactoryAbi,
      functionName: 'createAccountWithModeCustomT4',
      args: [params, validatorAddress, t4Timelock, saltBigInt],
    });
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Capability · Create AgentAccount</p>
        <h1>Pick a mode, deploy the account.</h1>
        <p>
          The factory deploys an <code>AgentAccount</code> proxy and installs the{' '}
          <code>CustodyPolicy</code> module atomically in the same transaction. After deploy,
          admin actions (add owner, change mode, recover) target the validator.
        </p>
      </div>

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
            data-testid="create-account-switch-chain"
          >
            {isSwitching ? 'Switching…' : 'Switch chain'}
          </button>
        </p>
      )}

      <div className="split">
        <section className="card">
          <p className="eyebrow">Account configuration</p>
          <h2>Mode + signers</h2>

          <label className="field">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(Number(e.target.value) as Mode)}
              data-testid="create-account-mode"
            >
              <option value={0}>0 · single (just me)</option>
              <option value={1}>1 · hybrid (me + backups)</option>
              <option value={2}>2 · threshold (≥ 2 guardians)</option>
              <option value={3}>3 · org (≥ 3 guardians + separation of duties)</option>
            </select>
            <small className="muted">{MODE_DESCRIPTION[mode]}</small>
          </label>

          <ModePill mode={MODE_LABEL[mode] as 'single' | 'hybrid' | 'threshold' | 'org'} detail="T4 1h · T5 24h · T6 48h" />

          <label className="field">
            <span>Primary owner</span>
            <input
              value={connectedAddress ?? '— not connected —'}
              readOnly
              data-testid="create-account-owner"
            />
          </label>

          {mode >= 2 && (
            <AddressChipInput
              label="Additional owners (optional)"
              value={extraOwners}
              onChange={setExtraOwners}
              help={`Owners total: ${owners.length}. The factory deploys the proxy with the FIRST owner only; the rest get added via T4 admin actions post-deploy (after the eta-coupling fix lands).`}
            />
          )}

          <AddressChipInput
            label="Guardians"
            value={guardians}
            onChange={setGuardians}
            help={
              guardianMin === 0
                ? `${guardians.length} guardian(s). Optional for ${MODE_LABEL[mode]} mode.`
                : `${guardians.length} of ${guardianMin}+ required for ${MODE_LABEL[mode]} mode.`
            }
          />
          {guardianShortfall > 0 && (
            <small className="err">
              {MODE_LABEL[mode]} mode requires at least {guardianMin} guardian
              {guardianMin === 1 ? '' : 's'}. Add {guardianShortfall} more.
            </small>
          )}

          <label className="field">
            <span>T4 admin timelock</span>
            <select
              value={t4Timelock}
              onChange={(e) => setT4Timelock(Number(e.target.value))}
              data-testid="create-account-t4-timelock"
            >
              <option value={0}>1h (spec default)</option>
              <option value={1}>Instant (1s — demo only)</option>
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={3600}>1 hour</option>
              <option value={21600}>6 hours</option>
              <option value={86400}>24 hours</option>
            </select>
            <small className="muted">
              Wait time between Propose and Execute on T4 admin actions (AddOwner, AddGuardian,
              ChangeMode, etc.). Set short for demo speed; longer is more secure (gives co-signers a
              window to cancel a hostile change). T5 and T6 timelocks stay at spec defaults (24h /
              48h) regardless.
            </small>
          </label>

          <label className="field">
            <span>Salt</span>
            <input
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
              data-testid="create-account-salt"
            />
            {saltBigInt === null && <small className="err">Salt must be a decimal integer.</small>}
          </label>
        </section>

        <section className="card">
          <p className="eyebrow">Review</p>
          <h2>Account will deploy with</h2>
          <ul className="status-list">
            <li className={connectedAddress ? 'approved' : 'pending'}>
              <span>{connectedAddress ? '✓' : '○'}</span>
              Primary owner {connectedAddress ? shortAddress(connectedAddress) : 'not connected'}
            </li>
            <li className={extraOwners.length > 0 ? 'approved' : 'pending'}>
              <span>{extraOwners.length > 0 ? '✓' : '○'}</span>
              {extraOwners.length} additional owner{extraOwners.length === 1 ? '' : 's'}
              {extraOwners.length === 0 && mode >= 2 && ' (added post-deploy via admin)'}
            </li>
            <li className={guardianShortfall === 0 ? (guardians.length > 0 ? 'approved' : 'pending') : 'err'}>
              <span>{guardianShortfall > 0 ? '✗' : guardians.length > 0 ? '✓' : '○'}</span>
              {guardians.length} guardian{guardians.length === 1 ? '' : 's'}
              {guardianShortfall > 0 && ` (need ${guardianMin}+ for ${MODE_LABEL[mode]} mode)`}
            </li>
            <li className="approved">
              <span>✓</span>CustodyPolicy installed as executor module
            </li>
          </ul>
          {predictedAddress && (
            <p className="muted">
              Predicted address: <code>{predictedAddress}</code>
            </p>
          )}
          <button
            onClick={handleDeploy}
            disabled={!ready || isWriting || isConfirming}
            data-testid="create-account-deploy"
            className="primary"
          >
            {isWriting
              ? 'Confirm in wallet…'
              : isConfirming
                ? 'Waiting for confirmation…'
                : 'Deploy account'}
          </button>

          {writeError && (
            <p className="err" data-testid="create-account-error">
              {writeError.message}
            </p>
          )}
          {txHash && !isConfirmed && (
            <p className="muted" data-testid="create-account-tx-pending">
              Tx submitted: <code>{txHash}</code>
            </p>
          )}
        </section>
      </div>

      {isConfirmed && deployedAddress && (
        <section className="card" data-testid="create-account-success">
          <p className="eyebrow ok">Account ready</p>
          <h2>Deployed account {shortAddress(deployedAddress)}</h2>
          <p>
            Address: <code>{deployedAddress}</code>
            <br />
            Tx: <code>{txHash}</code>
          </p>
          <p>
            <a className="button-link" href={`#/flows/view-account?address=${deployedAddress}`}>
              Inspect this account →
            </a>
          </p>
          <p className="muted" style={{ marginTop: '1rem' }}>
            <strong>Honest next steps</strong> (not buttons in this UI yet):
          </p>
          <ul className="muted">
            <li>
              Add a backup passkey — blocked on the <code>buildUserOp</code> SDK + demo-a2a
              endpoints (capability not in this app yet).
            </li>
            <li>
              Add more owners / guardians via the validator's admin path — blocked on task #101
              (scheduleCustodyChange eta-coupling).
            </li>
          </ul>
        </section>
      )}

      <p className="muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
        Walkthrough: <code>docs/multi-sig/flows/create-account.md</code>
      </p>
    </section>
  );
}
