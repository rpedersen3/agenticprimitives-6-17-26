import { useMemo, useState } from 'react';
import { config } from '../../config';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { claimPsaName } from '../../lib/claim-psa-name';

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
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [registerTx, setRegisterTx] = useState<string | null>(null);
  const [primaryTx, setPrimaryTx] = useState<string | null>(null);

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
    setRegisterTx(null);
    setPrimaryTx(null);
    if (!psaInfo || !config.permissionlessSubregistry) return;
    setState('submitting');
    const result = await claimPsaName({
      baseLabel: label.trim(),
      personAgent: psaInfo.personAgent,
      passkey: psaInfo.passkey,
    });
    if (result.ok) {
      setRegisterTx(result.registerTx ?? null);
      setPrimaryTx(result.primaryTx ?? null);
      setState('done');
      onRegistered?.(result.name);
    } else {
      setError(result.reason);
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
          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="label (a-z, 0-9, -, min 3)"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase())}
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
          {state === 'done' ? (
            <div style={{ marginTop: 6, fontSize: 11, color: '#059669' }}>
              ✓ claimed <code>{label}.demo.agent</code> as your PSA's primary name
              {registerTx ? <> · register tx <code>{registerTx.slice(0, 10)}…</code></> : null}
              {primaryTx ? <> · primary tx <code>{primaryTx.slice(0, 10)}…</code></> : null}
            </div>
          ) : null}
          {state === 'error' && error ? (
            <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626' }}>error: {error}</div>
          ) : null}
        </>
      )}
      <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
        Phase 4 SDK: subregistry.register → registry.setPrimaryName, both gasless via your PSA's
        passkey. Act 1 auto-claims <code>&lt;seat&gt;.demo.agent</code> already; use this form to
        claim an additional label OR if the auto-claim failed.
      </div>
    </div>
  );
}
