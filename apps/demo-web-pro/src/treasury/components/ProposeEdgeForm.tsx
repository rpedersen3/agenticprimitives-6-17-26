import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import {
  buildProposeEdgeCall,
  RELATIONSHIP_TYPE,
  computeEdgeId,
  type RelationshipType,
} from '@agenticprimitives/agent-relationships';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import { config } from '../../config';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { executeCallFromAgent } from '../../lib/execute-call';
import { NameDisplay } from './NameDisplay';

const TYPE_OPTIONS: Array<{ label: string; value: keyof typeof RELATIONSHIP_TYPE }> = [
  { label: 'HAS_MEMBER',            value: 'HAS_MEMBER' },
  { label: 'HAS_GOVERNANCE_OVER',   value: 'HAS_GOVERNANCE_OVER' },
  { label: 'VALIDATION_TRUST',      value: 'VALIDATION_TRUST' },
  { label: 'PARTNERSHIP',           value: 'PARTNERSHIP' },
  { label: 'OPERATES_ON_BEHALF_OF', value: 'OPERATES_ON_BEHALF_OF' },
  { label: 'RECOMMENDS',            value: 'RECOMMENDS' },
];

/**
 * "Propose an edge from your PSA" form — third Phase-4 demo path.
 *
 * Same pattern as PublishProfileForm: build call via the relationships
 * SDK, wrap in AgentAccount.execute via buildExecuteCallData, submit
 * via demo-a2a relay + passkey WebAuthn sign.
 *
 * Subject is locked to the active PSA (contract enforces
 * msg.sender == subject for proposeEdge). User picks the object
 * address + relationship type. After submit, the EdgesCard above
 * picks up the new edge.
 */
export function ProposeEdgeForm() {
  const queryClient = useQueryClient();
  const [object, setObject] = useState('');
  const [typeKey, setTypeKey] = useState<keyof typeof RELATIONSHIP_TYPE>('HAS_MEMBER');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [newEdgeId, setNewEdgeId] = useState<string | null>(null);

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

  const relationshipsAvailable = !!config.agentRelationship;
  const canSubmit =
    relationshipsAvailable &&
    !!psaInfo &&
    /^0x[0-9a-fA-F]{40}$/.test(object.trim()) &&
    object.trim().toLowerCase() !== psaInfo?.personAgent.toLowerCase() &&
    state !== 'submitting';

  const submit = async () => {
    setError(null);
    setTxHash(null);
    setNewEdgeId(null);
    if (!psaInfo || !config.agentRelationship) return;
    setState('submitting');
    try {
      const objectAddr = object.trim() as Address;
      const relType = RELATIONSHIP_TYPE[typeKey] as RelationshipType;
      const call = buildProposeEdgeCall({
        relationships: config.agentRelationship,
        subject: psaInfo.personAgent,
        object: objectAddr,
        relationshipType: relType,
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
        throw new Error(result.reason ?? result.error);
      }
      const edgeId = computeEdgeId(psaInfo.personAgent, objectAddr, relType);
      setTxHash(result.transactionHash);
      setNewEdgeId(edgeId);
      setState('done');
      queryClient.invalidateQueries({
        queryKey: ['agent-edges-subject', psaInfo.personAgent.toLowerCase()],
      });
    } catch (err) {
      setError((err as Error).message ?? String(err));
      setState('error');
    }
  };

  if (!relationshipsAvailable) return null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: '1px solid #d1d5db',
        borderRadius: 8,
        background: '#ffffff',
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 14 }}>Propose an edge from your PSA</strong>
        <code style={{ fontSize: 11, color: '#6b7280' }}>
          {config.agentRelationship?.slice(0, 8)}…
        </code>
      </div>

      {!psaInfo ? (
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          Claim a seat first (Act 1). The edge gets proposed from your PSA.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
            Subject (your PSA):{' '}
            <code>
              <NameDisplay address={psaInfo.personAgent} />
            </code>
            . Edge enters <code>PROPOSED</code>; the object side must confirm before it goes to
            <code> ACTIVE</code>.
          </div>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 200px', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="object address (0x…)"
              value={object}
              onChange={(e) => setObject(e.target.value)}
              disabled={state === 'submitting'}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <select
              value={typeKey}
              onChange={(e) => setTypeKey(e.target.value as keyof typeof RELATIONSHIP_TYPE)}
              disabled={state === 'submitting'}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 6 }}>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: canSubmit ? '#3b82f6' : '#9ca3af',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {state === 'submitting' ? 'proposing…' : 'propose edge'}
            </button>
            {object.trim() && object.trim().toLowerCase() === psaInfo.personAgent.toLowerCase() ? (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#dc2626' }}>
                object cannot equal subject (self-edges rejected on chain)
              </span>
            ) : null}
          </div>
          {state === 'done' && txHash && newEdgeId ? (
            <div style={{ marginTop: 8, fontSize: 11, color: '#059669' }}>
              ✓ edge proposed · id{' '}
              <code>
                {newEdgeId.slice(0, 10)}…{newEdgeId.slice(-6)}
              </code>{' '}
              · tx{' '}
              <code>
                {txHash.slice(0, 10)}…{txHash.slice(-6)}
              </code>
            </div>
          ) : null}
          {state === 'error' && error ? (
            <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>error: {error}</div>
          ) : null}
        </>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af' }}>
        Phase 4 SDK: <code>buildProposeEdgeCall</code> → <code>buildExecuteCallData</code> →{' '}
        <code>executeCallFromAgent</code> (demo-a2a relay + WebAuthn passkey sign).{' '}
        <code>computeEdgeId</code> derives the new edge id off-chain via{' '}
        <code>keccak256(subject || object || type)</code> — same as the contract.
      </div>
    </div>
  );
}
