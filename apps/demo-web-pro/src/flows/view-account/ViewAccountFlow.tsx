/**
 * Inspect AgentAccount — read-only state inspector.
 *
 * Paste any deployed AgentAccount address (or arrive here via the
 * "Inspect this account →" link from the create flow) and the page
 * loads everything queryable: owners, ownerCount, account.accountId(),
 * mode + per-tier thresholds + guardianCount + recoveryThreshold from
 * the validator, and whether the ThresholdValidator + QuorumEnforcer
 * are installed as modules.
 *
 * No wallet required — uses the public-RPC chain transport from
 * wagmi-config.ts.
 *
 * Paired doc: ../../../docs/multi-sig/flows/view-account.md
 */

import { useEffect, useMemo, useState } from 'react';
import { useReadContract } from 'wagmi';
import { isAddress, type Address } from 'viem';
import { config as deploymentConfig } from '../../config';
import { shortAddress } from '../../components';

// Minimal AgentAccount ABI — just the views we need here. The package's
// exported ABI is scoped to the IAgentAccount interface and doesn't
// include `accountId`, so we declare what we need inline.
const accountAbi = [
  { type: 'function', name: 'accountId',  stateMutability: 'pure', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'ownerCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isOwner',    stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

// Minimal validator ABI — just the views we need here.
const validatorAbi = [
  { type: 'function', name: 'isInstalledOn',     stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'mode',              stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'recoveryThreshold', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'guardianCount',     stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'proposalCount',     stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 't3HighValueCeiling', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'threshold',         stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tier', type: 'uint8' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'timelockDuration', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'tier', type: 'uint8' }], outputs: [{ type: 'uint32' }] },
] as const;

const MODE_LABEL: Record<number, string> = {
  0: 'single',
  1: 'hybrid',
  2: 'threshold',
  3: 'org',
};

const TIERS = [
  { id: 1, label: 'T1 Read' },
  { id: 2, label: 'T2 Write' },
  { id: 3, label: 'T3 Value' },
  { id: 4, label: 'T4 Admin' },
  { id: 5, label: 'T5 Critical' },
] as const;

export function ViewAccountFlow() {
  // Initial address: pulled from `#/flows/view-account?address=0x…` if present.
  const initialAddress = useMemo<string>(() => {
    if (typeof window === 'undefined') return '';
    const hash = window.location.hash;
    const m = hash.match(/[?&]address=([^&]+)/);
    return m && m[1] ? decodeURIComponent(m[1]) : '';
  }, []);

  const [input, setInput] = useState<string>(initialAddress);
  const [activeAddress, setActiveAddress] = useState<Address | null>(
    isAddress(initialAddress) ? (initialAddress as Address) : null,
  );

  useEffect(() => {
    if (isAddress(input)) setActiveAddress(input as Address);
    else setActiveAddress(null);
  }, [input]);

  const validatorAddress = deploymentConfig.thresholdValidator;

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Capability · Inspect AgentAccount</p>
        <h1>Read account state from chain.</h1>
        <p>
          Read-only inspector. Loads everything queryable about a deployed{' '}
          <code>AgentAccount</code>: owner set, mode, per-tier thresholds, guardian count,
          validator install status. No wallet required.
        </p>
      </div>

      <section className="card">
        <label className="field">
          <span>Account address</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.trim())}
            placeholder="0x…"
            data-testid="view-account-input"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {input && !activeAddress && (
            <small className="err">Not a valid 0x address (must be 42 chars, hex).</small>
          )}
        </label>
      </section>

      {activeAddress && (
        <AccountInspector account={activeAddress} validatorAddress={validatorAddress} />
      )}

      {!input && (
        <section className="card muted">
          <p className="eyebrow">Tip</p>
          <p>
            Paste an AgentAccount address above. From the create flow, the "Inspect this account →"
            link will pre-fill it.
          </p>
        </section>
      )}
    </section>
  );
}

function AccountInspector({
  account,
  validatorAddress,
}: {
  account: Address;
  validatorAddress?: Address;
}) {
  // ─── Account-side reads ───
  const accountIdQ = useReadContract({
    address: account,
    abi: accountAbi,
    functionName: 'accountId',
  });
  const ownerCountQ = useReadContract({
    address: account,
    abi: accountAbi,
    functionName: 'ownerCount',
  });

  // ─── Validator-side reads ───
  const isInstalledQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'isInstalledOn',
    args: [account],
    query: { enabled: !!validatorAddress },
  });
  const modeQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'mode',
    args: [account],
    query: { enabled: !!validatorAddress && isInstalledQ.data === true },
  });
  const recThrQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'recoveryThreshold',
    args: [account],
    query: { enabled: !!validatorAddress && isInstalledQ.data === true },
  });
  const guardiansQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'guardianCount',
    args: [account],
    query: { enabled: !!validatorAddress && isInstalledQ.data === true },
  });
  const proposalsQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'proposalCount',
    args: [account],
    query: { enabled: !!validatorAddress && isInstalledQ.data === true },
  });

  const installed = isInstalledQ.data === true;
  const noCode = accountIdQ.isError && /returned no data|returned a empty/i.test(String(accountIdQ.error?.message ?? ''));

  return (
    <div className="split">
      <section className="card">
        <p className="eyebrow">Account · core</p>
        <h2>{shortAddress(account)}</h2>
        <dl className="kv">
          <dt>Account ID</dt>
          <dd>
            {accountIdQ.isLoading ? (
              '…'
            ) : noCode ? (
              <span className="err">No contract at this address</span>
            ) : (
              <code>{(accountIdQ.data as string) ?? '—'}</code>
            )}
          </dd>
          <dt>Owner count</dt>
          <dd>
            {ownerCountQ.isLoading ? '…' : ownerCountQ.data !== undefined ? String(ownerCountQ.data) : '—'}
          </dd>
        </dl>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          To enumerate individual owners you'd need an event scan
          (<code>OwnerAdded</code> / <code>OwnerRemoved</code>) — not done here. Per-address
          membership: <code>account.isOwner(0x…)</code>.
        </p>
      </section>

      <section className="card">
        <p className="eyebrow">ThresholdValidator · per-account config</p>
        <h2>{installed ? `Mode: ${MODE_LABEL[Number(modeQ.data ?? 0)] ?? '?'}` : 'Not installed'}</h2>
        {!validatorAddress ? (
          <p className="err">
            <code>VITE_THRESHOLD_VALIDATOR</code> not set in this build.
          </p>
        ) : !installed ? (
          <p className="muted">
            Validator <code>{shortAddress(validatorAddress)}</code> is not installed on this
            account. Either the account was deployed via the legacy{' '}
            <code>createAccount(owner, salt)</code> path (no admin surface) or via a different
            factory.
          </p>
        ) : (
          <>
            <dl className="kv">
              <dt>Mode</dt>
              <dd>
                <code>{Number(modeQ.data ?? 0)}</code> · {MODE_LABEL[Number(modeQ.data ?? 0)] ?? '?'}
              </dd>
              <dt>Guardian count</dt>
              <dd>{guardiansQ.isLoading ? '…' : String(guardiansQ.data ?? 0n)}</dd>
              <dt>Recovery threshold</dt>
              <dd>{recThrQ.isLoading ? '…' : `${recThrQ.data ?? 0} of ${guardiansQ.data ?? 0n}`}</dd>
              <dt>Proposal count</dt>
              <dd>{proposalsQ.isLoading ? '…' : String(proposalsQ.data ?? 0n)}</dd>
            </dl>
            <p className="muted" style={{ marginTop: '1rem', fontWeight: 600 }}>
              Per-tier thresholds + timelocks
            </p>
            <TierTable account={account} validatorAddress={validatorAddress} />
          </>
        )}
      </section>
    </div>
  );
}

function TierTable({ account, validatorAddress }: { account: Address; validatorAddress: Address }) {
  return (
    <table className="tier-table">
      <thead>
        <tr>
          <th>Tier</th>
          <th>Threshold</th>
          <th>Timelock</th>
        </tr>
      </thead>
      <tbody>
        {TIERS.map((t) => (
          <TierRow key={t.id} account={account} validatorAddress={validatorAddress} tier={t.id} label={t.label} />
        ))}
      </tbody>
    </table>
  );
}

function TierRow({
  account,
  validatorAddress,
  tier,
  label,
}: {
  account: Address;
  validatorAddress: Address;
  tier: number;
  label: string;
}) {
  const thresholdQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'threshold',
    args: [account, tier],
  });
  const timelockQ = useReadContract({
    address: validatorAddress,
    abi: validatorAbi,
    functionName: 'timelockDuration',
    args: [account, tier],
  });
  const seconds = Number(timelockQ.data ?? 0);
  const timelockLabel =
    seconds === 0
      ? 'instant'
      : seconds >= 86400
        ? `${Math.round(seconds / 86400)}h × 24 (${(seconds / 86400).toFixed(1)} days)`
        : seconds >= 3600
          ? `${(seconds / 3600).toFixed(1)} h`
          : `${seconds} s`;
  return (
    <tr>
      <td>{label}</td>
      <td>{thresholdQ.isLoading ? '…' : String(thresholdQ.data ?? '—')}</td>
      <td>{timelockQ.isLoading ? '…' : timelockLabel}</td>
    </tr>
  );
}
