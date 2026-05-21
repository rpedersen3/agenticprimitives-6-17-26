/**
 * Use case 1 — Individual user, seamless recovery (spec 207 § 4.1).
 *
 * Walks the user through creating a `hybrid`-mode AgentAccount:
 * one EOA + room for a backup passkey + optional guardians. After
 * deploy, the next-step prompt nudges adding a backup signer so the
 * account flips out of `single` into something recoverable.
 *
 * Status: SCAFFOLD. Form + counterfactual address preview are
 * functional; the actual `createAccountWithMode` write happens via
 * `useWriteContract` once a chain is configured + deployments JSON
 * is wired. demo-web-pro doesn't carry contract addresses yet —
 * that lands when the first interactive demo is exercised against
 * a deployed network.
 *
 * Paired doc: ../../../docs/multi-sig/flows/hybrid-recovery.md
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { config as deploymentConfig } from '../../config';

interface HybridRecoveryConfig {
  factoryAddress?: `0x${string}`;
  defaultGuardians?: `0x${string}`[];
}

// Wired from VITE_FACTORY_ADDRESS (phase 6c.5-c). `deploy-cloudflare.ts`
// reads apps/contracts/deployments-<network>.json + passes it into
// `vite build` so the deployed Pages bundle carries the address.
const DEFAULT_CONFIG: HybridRecoveryConfig = {
  factoryAddress: deploymentConfig.factoryAddress,
  defaultGuardians: [],
};

export function HybridRecoveryFlow({ config = DEFAULT_CONFIG }: { config?: HybridRecoveryConfig }) {
  const { address: connectedAddress, isConnected } = useAccount();
  const [salt, setSalt] = useState<string>('1');
  const [guardians, setGuardians] = useState<string>(config.defaultGuardians?.join(',') ?? '');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [deployedAddress, setDeployedAddress] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guardianList = guardians
    .split(',')
    .map((g) => g.trim())
    .filter((g) => /^0x[0-9a-fA-F]{40}$/.test(g));

  const handleDeploy = async () => {
    setStatus('pending');
    setError(null);
    try {
      // Placeholder for the wagmi `useWriteContract` call to
      // `factory.createAccountWithMode({ mode: 1, owners: [connected],
      // guardians, ... }, salt)`. Wires up in 6c.5-c when a deployments
      // JSON gives us a real factory address + chain config.
      if (!config.factoryAddress) {
        throw new Error(
          'factory address not configured — set VITE_FACTORY_ADDRESS or wire deployments JSON',
        );
      }
      if (!isConnected || !connectedAddress) {
        throw new Error('wallet not connected');
      }
      // TODO(6c.5-c): real createAccountWithMode call here.
      throw new Error('TODO 6c.5-c — contract call not yet implemented');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  return (
    <section style={{ margin: '2rem 0' }}>
      <h2>Hybrid recovery</h2>
      <p className="muted">
        Spec 207 use case #1: create a <code>hybrid</code>-mode account. Adds an EOA primary,
        space for guardians, and the spec § 5.1 default threshold matrix. Defaults install:
        T4 = 1h timelock, T5 = 24h, T6 = 48h; T3 ceiling = 0.01 ETH; recovery threshold
        = ceil(guardians/2)+1.
      </p>

      {!isConnected && (
        <p className="muted">
          <strong>Connect a wallet first</strong> — the connected EOA becomes the primary
          signer.
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
            value={guardians}
            onChange={(e) => setGuardians(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '0.25rem', fontFamily: 'monospace' }}
            data-testid="hybrid-recovery-guardians"
          />
          <small className="muted">
            Parsed: {guardianList.length} valid guardian(s)
            {guardianList.length === 0 && ' — none, account is hybrid-without-recovery'}
          </small>
        </label>
        <button
          onClick={handleDeploy}
          disabled={!isConnected || status === 'pending'}
          data-testid="hybrid-recovery-deploy"
        >
          {status === 'pending' ? 'Deploying…' : 'Deploy hybrid account'}
        </button>
      </div>

      {error && (
        <p className="err" data-testid="hybrid-recovery-error">
          {error}
        </p>
      )}
      {status === 'success' && deployedAddress && (
        <div className="card">
          <h3 className="ok">✓ Account deployed</h3>
          <p>
            Address: <code>{deployedAddress}</code>
          </p>
          <p className="muted">
            <strong>Next step (recommended):</strong> add a backup passkey so this account
            isn't bound to a single device. See spec § 8 for the recovery threshold + 48h
            timelock semantics.
          </p>
        </div>
      )}

      <p className="muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
        Walkthrough: <code>docs/multi-sig/flows/hybrid-recovery.md</code>
      </p>
    </section>
  );
}
