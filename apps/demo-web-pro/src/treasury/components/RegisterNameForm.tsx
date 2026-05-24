import { useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { buildSubregistryRegisterCall } from '@agenticprimitives/agent-naming';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import { config } from '../../config';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { executeCallFromAgent } from '../../lib/execute-call';

/**
 * "Register a name under demo.agent" form — PSA-controlled, routed
 * through the PermissionlessSubregistry contract.
 *
 * Flow:
 *   1. User picks a label (3-char min) + optional owner-of-record
 *      (defaults to their PSA).
 *   2. SDK builds the subregistry.register call via
 *      buildSubregistryRegisterCall (pure encoder).
 *   3. Wrapped in AgentAccount.execute via buildExecuteCallData.
 *   4. Submitted via executeCallFromAgent → demo-a2a relay → WebAuthn
 *      passkey sign on the PSA's userOp hash → on-chain.
 *
 * Anti-spam: the subregistry caps one claim per caller address.
 * Since the caller IS the PSA (msg.sender after AgentAccount.execute),
 * each PSA gets exactly one name. Re-claiming reverts with
 * AlreadyClaimed and the form surfaces a friendly error.
 */
export function RegisterNameForm({ onRegistered }: { onRegistered?: (name: string) => void }) {
  const [label, setLabel] = useState('');
  const [recordAddr, setRecordAddr] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const psaInfo = useMemo(() => {
    const seatId = loadActiveSeat();
    if (!seatId) return null;
    const seats = loadSeats();
    const seat = seats[seatId];
    if (!seat) return null;
    const passkey = getPasskeyForSeat(seatId);
    if (!passkey) return null;
    return { seatId, personAgent: seat.personAgent, passkey };
  }, []);

  const namingAvailable =
    !!config.agentNameRegistry &&
    !!config.agentNameUniversalResolver &&
    !!config.permissionlessSubregistry &&
    !!config.rpcUrl;

  const labelOk = /^[a-z0-9-]{3,}$/.test(label.trim());
  const canSubmit = namingAvailable && !!psaInfo && labelOk && state !== 'submitting';

  const submit = async () => {
    setError(null);
    setTxHash(null);
    if (!psaInfo || !config.permissionlessSubregistry) return;
    setState('submitting');
    try {
      const owner = (recordAddr.trim() || psaInfo.personAgent) as Address;
      const call = buildSubregistryRegisterCall({
        subregistry: config.permissionlessSubregistry,
        label: label.trim(),
        newOwner: owner,
      });
      const callData = buildExecuteCallData({
        to: call.to as Address,
        value: call.value,
        data: call.data as Hex,
      });
      const result = await executeCallFromAgent({
        sender: psaInfo.personAgent,
        passkey: psaInfo.passkey,
        callData,
      });
      if (!result.ok) {
        const reason = (result.reason ?? '').toLowerCase();
        if (reason.includes('alreadyclaimed')) {
          throw new Error('Your PSA has already claimed a name under demo.agent.');
        }
        if (reason.includes('labeltooshort')) {
          throw new Error('Label too short — minimum 3 characters.');
        }
        if (reason.includes('nodealreadyexists')) {
          throw new Error('That label is already taken under demo.agent.');
        }
        throw new Error(result.reason ?? result.error);
      }
      setTxHash(result.transactionHash);
      setState('done');
      onRegistered?.(`${label.trim()}.demo.agent`);
    } catch (err) {
      setError((err as Error).message ?? String(err));
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
        Register a name under demo.agent (via your PSA)
      </div>
      {!psaInfo ? (
        <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
          Claim a seat first (Act 1). The PermissionlessSubregistry caps one claim per PSA.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="label (a-z, 0-9, -, min 3)"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase())}
              disabled={state === 'submitting'}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <input
              type="text"
              placeholder={`owner (default ${psaInfo.personAgent.slice(0, 6)}…)`}
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
              ✓ claimed <code>{label}.demo.agent</code> · tx{' '}
              <code>
                {txHash.slice(0, 10)}…{txHash.slice(-6)}
              </code>
            </div>
          ) : null}
          {state === 'error' && error ? (
            <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626' }}>error: {error}</div>
          ) : null}
        </>
      )}
      <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
        Phase 4 SDK: <code>buildSubregistryRegisterCall</code> →{' '}
        <code>buildExecuteCallData</code> (wraps in AgentAccount.execute) →{' '}
        <code>executeCallFromAgent</code> (demo-a2a relay + WebAuthn passkey sign). One claim per
        PSA (subregistry caps spam at the contract level).
      </div>
    </div>
  );
}
