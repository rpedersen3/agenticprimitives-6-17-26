import { useMemo } from 'react';
import type { Address } from 'viem';
import { useAgentProfile } from '../../lib/use-agent-identity';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { config } from '../../config';
import { NameDisplay } from './NameDisplay';

/**
 * Read-side companion to PublishProfileForm. Renders the active PSA's
 * current on-chain-anchored AgentCard via
 * AgentIdentityClient.fetchProfile (which round-trips the metadata
 * hash against the on-chain anchor).
 *
 * Empty state: "no profile published yet" — invites the user to use
 * the form below.
 * Hash-mismatch error: surfaces ProfileHashMismatchError as a
 * tamper warning.
 */
export function PublishedProfileCard() {
  const psaAddr = useMemo<Address | undefined>(() => {
    const seatId = loadActiveSeat();
    if (!seatId) return undefined;
    const seat = loadSeats()[seatId];
    return seat?.personAgent;
  }, []);

  const { data: profile, isLoading, error } = useAgentProfile(psaAddr);

  if (!config.agentProfileResolver) return null;

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
        <strong style={{ fontSize: 14 }}>Your PSA's published profile</strong>
        {psaAddr ? (
          <code style={{ fontSize: 11, color: '#6b7280' }}>
            <NameDisplay address={psaAddr} />
          </code>
        ) : null}
      </div>

      {!psaAddr ? (
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          Claim a seat first (Act 1). The card surfaces the active PSA's profile.
        </div>
      ) : isLoading ? (
        <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 12 }}>
          fetching profile from on-chain anchor…
        </div>
      ) : error ? (
        <div style={{ marginTop: 6, color: '#dc2626', fontSize: 12 }}>
          {(error as Error).message?.includes('mismatch')
            ? '⚠ profile content-hash MISMATCH — the off-chain JSON does not match the on-chain anchor (tamper warning).'
            : `fetch failed: ${(error as Error).message ?? String(error)}`}
        </div>
      ) : !profile ? (
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          No profile published yet. Use the form below to publish one — the SDK round-trips the
          canonical-JSON content hash against the on-chain anchor so any tampered fetch is rejected.
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          <Row label="display name" value={profile.displayName ?? '—'} />
          <Row label="kind" value={profile.type} />
          {profile.type === 'org' || profile.type === 'person' ? (
            (profile as { description?: string }).description ? (
              <Row label="description" value={(profile as { description?: string }).description!} />
            ) : null
          ) : null}
          {(profile as { description?: string }).description ? (
            <Row label="description" value={(profile as { description?: string }).description!} />
          ) : null}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af' }}>
        Read path: AgentProfileResolver.getStringProperty(atl:metadataURI) +
        getBytes32Property(atl:metadataHash) → HTTP-fetch JSON →
        recompute profileContentHash → assert match → return AgentCard.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: '#6b7280', fontSize: 11 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
