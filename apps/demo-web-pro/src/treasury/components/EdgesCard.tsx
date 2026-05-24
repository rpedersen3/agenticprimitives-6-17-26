import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import {
  buildRevokeEdgeCall,
  EdgeStatus,
  TYPE_SEMANTICS,
  type Edge,
} from '@agenticprimitives/agent-relationships';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import { useEdgesFor } from '../../lib/use-agent-relationships';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { executeCallFromAgent } from '../../lib/execute-call';
import { config } from '../../config';

/**
 * Read-side companion to ProposeEdgeForm. Shows the active PSA's
 * outbound edges (`subject == active PSA`) with a per-row Revoke
 * button. Mounts above the form so the user sees their existing
 * edges before proposing new ones.
 */
export function EdgesCard() {
  const queryClient = useQueryClient();
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

  const { data: edges, isLoading } = useEdgesFor(psaInfo?.personAgent);

  if (!config.agentRelationship) return null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: '1px solid #d1d5db',
        borderRadius: 8,
        background: '#fafbfc',
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 14 }}>Your PSA's outbound edges</strong>
        {psaInfo ? (
          <code style={{ fontSize: 11, color: '#6b7280' }}>
            {psaInfo.personAgent.slice(0, 6)}…{psaInfo.personAgent.slice(-4)}
          </code>
        ) : null}
      </div>

      {!psaInfo ? (
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          Claim a seat first (Act 1).
        </div>
      ) : isLoading ? (
        <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 12 }}>fetching edges…</div>
      ) : !edges || edges.length === 0 ? (
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          No edges yet. Use the form below to propose one.
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {edges.map((e) => (
            <EdgeRow key={e.edgeId} edge={e} psa={psaInfo} onChange={() => {
              queryClient.invalidateQueries({
                queryKey: ['agent-edges-subject', psaInfo.personAgent.toLowerCase()],
              });
            }} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af' }}>
        Read path: <code>AgentRelationship.getEdgesBySubject</code> → parallel{' '}
        <code>getEdge</code> per id → typed Edge tuples with status enum.
      </div>
    </div>
  );
}

function EdgeRow({
  edge,
  psa,
  onChange,
}: {
  edge: Edge;
  psa: { personAgent: Address; passkey: import('../../lib/passkey').DemoPasskey };
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typeName = TYPE_SEMANTICS[edge.relationshipType]?.name ?? '?';
  const statusName = EdgeStatus[edge.status] ?? `status=${edge.status}`;

  const revoke = async () => {
    setErr(null);
    setBusy(true);
    try {
      const call = buildRevokeEdgeCall({
        relationships: config.agentRelationship!,
        edgeId: edge.edgeId,
      });
      const callData = buildExecuteCallData({
        to: call.to as Address,
        value: call.value,
        data: call.data as Hex,
      });
      const result = await executeCallFromAgent({
        sender: psa.personAgent,
        passkey: psa.passkey,
        callData,
      });
      if (!result.ok) throw new Error(result.reason ?? result.error);
      onChange();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const isTerminal = edge.status === EdgeStatus.REVOKED;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr 90px 80px',
        gap: 8,
        alignItems: 'center',
        padding: '6px 0',
        borderTop: '1px solid #f3f4f6',
      }}
    >
      <code style={{ fontSize: 11 }}>{typeName}</code>
      <code style={{ fontSize: 11 }}>
        → {edge.object.slice(0, 6)}…{edge.object.slice(-4)}
      </code>
      <span style={{ fontSize: 11, color: isTerminal ? '#dc2626' : '#059669' }}>{statusName}</span>
      <button
        onClick={revoke}
        disabled={busy || isTerminal}
        style={{
          padding: '2px 8px',
          fontSize: 11,
          background: isTerminal ? '#e5e7eb' : '#dc2626',
          color: isTerminal ? '#9ca3af' : 'white',
          border: 'none',
          borderRadius: 4,
          cursor: isTerminal || busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? '…' : isTerminal ? 'revoked' : 'revoke'}
      </button>
      {err ? (
        <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#dc2626' }}>{err}</div>
      ) : null}
    </div>
  );
}
