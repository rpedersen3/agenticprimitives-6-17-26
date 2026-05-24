import { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import type { Address } from 'viem';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { config } from '../../config';

/**
 * "Register a name under demo.agent" form. Phase 4 SDK demonstration
 * — uses the connected wallet via wagmi + the Phase 4
 * AgentNamingClient.registerSubname write path.
 *
 * Authority constraint: the connected wallet MUST own the parent name
 * (`demo.agent`). For the bootstrap deployment that's the deployer
 * EOA — only the user who connects with that key can register here.
 * In production this would route through a worker endpoint OR a
 * permissionless subregistry contract.
 *
 * Footer hint explains the constraint.
 */
export function RegisterNameForm({ onRegistered }: { onRegistered?: (name: string) => void }) {
  const [label, setLabel] = useState('');
  const [recordAddr, setRecordAddr] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const namingAvailable = !!config.agentNameRegistry && !!config.agentNameUniversalResolver && !!config.rpcUrl;
  const canSubmit =
    namingAvailable &&
    !!walletClient &&
    label.trim().length > 0 &&
    /^[a-z0-9-]+$/.test(label.trim()) &&
    state !== 'submitting';

  const submit = async () => {
    setError(null);
    setTxHash(null);
    if (!walletClient || !namingAvailable) return;
    setState('submitting');
    try {
      const naming = new AgentNamingClient({
        rpcUrl: config.rpcUrl!,
        chainId: config.chainId!,
        registry: config.agentNameRegistry!,
        universalResolver: config.agentNameUniversalResolver!,
      });
      const ownerAddr = (recordAddr.trim() || address) as Address | undefined;
      if (!ownerAddr) {
        throw new Error('Connect a wallet OR enter an address for the addr record.');
      }
      const hash = await naming.registerSubname(
        {
          parent: 'demo.agent',
          label: label.trim(),
          owner: ownerAddr,
          resolver: config.agentNameResolver,
          initialRecords: {
            addr: ownerAddr,
            displayName: label.trim(),
            agentKind: 'service',
          },
        },
        { walletClient },
      );
      setTxHash(hash);
      setState('done');
      onRegistered?.(`${label.trim()}.demo.agent`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Most common revert: caller is not the parent owner.
      if (msg.includes('0xea8e4eb5') || msg.toLowerCase().includes('notauthorized')) {
        setError(
          'NotAuthorized — your connected wallet does NOT own demo.agent. Only the deployer (root owner) can register names there in this v0.',
        );
      } else {
        setError(msg);
      }
      setState('error');
    }
  };

  if (!namingAvailable) return null;

  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderTop: '1px dashed #e5e7eb',
      }}
    >
      <div style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>
        Register a name under demo.agent
      </div>
      <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="label (a-z, 0-9, -)"
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase())}
          disabled={state === 'submitting'}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
        />
        <input
          type="text"
          placeholder={address ? `addr (default ${address.slice(0, 6)}…)` : 'addr (0x…)'}
          value={recordAddr}
          onChange={(e) => setRecordAddr(e.target.value)}
          disabled={state === 'submitting'}
          style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
        />
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            background: canSubmit ? '#3b82f6' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {state === 'submitting' ? 'submitting…' : 'register'}
        </button>
      </div>
      {state === 'done' && txHash ? (
        <div style={{ marginTop: 6, fontSize: 11, color: '#059669' }}>
          ✓ registered as <code>{label}.demo.agent</code> · tx{' '}
          <code>
            {txHash.slice(0, 10)}…{txHash.slice(-6)}
          </code>
        </div>
      ) : null}
      {state === 'error' && error ? (
        <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626' }}>error: {error}</div>
      ) : null}
      <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
        Requires the connected wallet to own <code>demo.agent</code> (deployer key in v0). Per-user PSA-controlled
        registration via a subregistry / worker endpoint ships in a follow-up.
      </div>
    </div>
  );
}
