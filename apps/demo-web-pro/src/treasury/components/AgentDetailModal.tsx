/**
 * AgentDetailModal — click "Alice / Bob / Acme Construction / Treasury"
 * (or any other Smart Agent label in the UI) to see the full identity
 * surface per the ADR-0010 / ADR-0011 framing.
 *
 * Sections (in order):
 *   1. Canonical identifier — CAIP-10 string + raw address + Basescan link.
 *      The SA address IS the identity; everything else is a facet.
 *   2. Agent Naming Service (facet) — live reverse-resolve + forward
 *      sanity check + records bundle + manual refresh. Doubles as a
 *      diagnostic for the "name didn't show up" case: the modal shows
 *      EXACTLY what reverseResolve / resolveName / getRecords return
 *      right now, so the user can tell the difference between
 *      "claim never landed" and "cache is stale".
 *   3. Control credentials (facet) — passkey + SIWE EOA per
 *      ADR-0011. Lists the credential's stored agentName so the user
 *      can see the passkey-↔-SA name match.
 *   4. Profile (placeholder) — AgentCard if published; otherwise a
 *      hint that profile publishing is available via PublishProfileForm.
 *
 * Use NameDisplay only for SECONDARY references inside this modal;
 * the modal's job is to show the canonical identifier and the raw
 * naming-service truth side by side.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Address } from 'viem';
import {
  useAgentNamingClient,
  useResolveAgentName,
  useAgentRecords,
} from '../../lib/use-agent-naming';
import { config } from '../../config';
import {
  loadSeats,
  getPasskeyAuth,
  getSiweAuth,
  type SeatClaim,
} from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { setPrimaryNameOnly } from '../../lib/claim-psa-name';
import { getCachedName, NAME_CACHE_EVENT } from '../../lib/name-cache';

export type AgentDetailKind = 'person' | 'org' | 'service' | 'treasury';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The canonical Smart Agent address. */
  address: Address | null | undefined;
  /** Friendly label shown in the modal header (e.g. "Alice"). */
  label: string;
  /** Agent kind — drives copy + section visibility. */
  kind: AgentDetailKind;
  /** Optional seat id — when present, modal pulls the seat's credentials. */
  seatId?: string;
}

const BASESCAN = 'https://sepolia.basescan.org';

export function AgentDetailModal({
  open,
  onClose,
  address,
  label,
  kind,
  seatId,
}: Props) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        overflow: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          padding: '20px 24px',
          maxWidth: 720,
          width: '100%',
          boxShadow: '0 24px 48px rgba(15, 23, 42, 0.25)',
          maxHeight: '85vh',
          overflow: 'auto',
        }}
      >
        <ModalHeader label={label} kind={kind} onClose={onClose} />
        {address ? (
          <Body address={address} label={label} kind={kind} seatId={seatId} />
        ) : (
          <p style={{ color: '#6b7280' }}>
            This agent has not been deployed yet. Run the relevant Act to
            create its canonical Smart Agent first.
          </p>
        )}
      </div>
    </div>
  );
}

function ModalHeader({
  label,
  kind,
  onClose,
}: {
  label: string;
  kind: AgentDetailKind;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 14,
        paddingBottom: 10,
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {kindLabel(kind)}
          <span style={{ marginLeft: 8, opacity: 0.6 }}>· build v29-pin-siwe-signer-account</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{label}</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 22,
          cursor: 'pointer',
          color: '#6b7280',
          padding: 0,
          lineHeight: 1,
        }}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}

function Body({
  address,
  label,
  kind,
  seatId,
}: {
  address: Address;
  label: string;
  kind: AgentDetailKind;
  seatId?: string;
}) {
  const queryClient = useQueryClient();
  const client = useAgentNamingClient();

  const seat: SeatClaim | null = seatId ? loadSeats()[seatId] ?? null : null;
  const passkey = seat ? getPasskeyAuth(seat) : undefined;
  const siwe = seat ? getSiweAuth(seat) : undefined;
  const passkeyMirror = seatId ? getPasskeyForSeat(seatId) : null;
  const storedAgentName = passkeyMirror?.agentName;

  // Reverse: read from the local name cache (per ADR-0012 — no
  // browser-side eth_getLogs). We re-render on cache updates.
  const [cachedName, setCachedNameState] = useState<string | undefined>(() =>
    getCachedName(address),
  );
  useEffect(() => {
    setCachedNameState(getCachedName(address));
    const onCache = () => setCachedNameState(getCachedName(address));
    window.addEventListener(NAME_CACHE_EVENT, onCache);
    return () => window.removeEventListener(NAME_CACHE_EVENT, onCache);
  }, [address]);
  // Forward sanity check (if we know an expected name) — single
  // chain read per modal open, used to verify round-trip.
  const forwardQ = useResolveAgentName(cachedName ?? storedAgentName ?? undefined);
  // Records bundle (displayName, agentKind, addr, nativeId, …).
  const recordsQ = useAgentRecords(cachedName ?? storedAgentName ?? undefined);

  // Recovery state for the "Set primary name now" button.
  const [setPrimaryState, setSetPrimaryState] = useState<
    'idle' | 'running' | 'done' | 'error'
  >('idle');
  const [setPrimaryError, setSetPrimaryError] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-name', address.toLowerCase()] });
    if (storedAgentName) {
      queryClient.invalidateQueries({ queryKey: ['resolve-name', storedAgentName] });
      queryClient.invalidateQueries({ queryKey: ['agent-records', storedAgentName] });
    }
    queryClient.invalidateQueries({ queryKey: ['naming-status'] });
  };

  // Cache-based reverse: no async settle state. If cache has the
  // name, render it; if not, show "unknown locally" hint.
  const reverseSettled = true;
  const reverseEmpty = !cachedName;
  const forwardMatches =
    forwardQ.data && forwardQ.data.toLowerCase() === address.toLowerCase();

  // Recovery: forward record points at this SA but we have no cached
  // reverse — i.e. setPrimaryName may have failed in Act 1. Show the
  // recovery button so the user can re-run setPrimaryName.
  const canRecover =
    !!passkeyMirror &&
    !!storedAgentName &&
    reverseEmpty &&
    forwardMatches &&
    !cachedName;

  const runSetPrimary = async () => {
    if (!passkeyMirror || !storedAgentName) return;
    setSetPrimaryState('running');
    setSetPrimaryError(null);
    const result = await setPrimaryNameOnly({
      personAgent: address,
      passkey: passkeyMirror,
      agentName: storedAgentName,
    });
    if (result.ok) {
      setSetPrimaryState('done');
      refresh();
    } else {
      setSetPrimaryState('error');
      setSetPrimaryError(result.reason);
    }
  };

  const caip10 = config.chainId ? `eip155:${config.chainId}:${address}` : address;

  return (
    <>
      {/* 1. Canonical identifier ─────────────────────────────── */}
      <Section title="Canonical identifier" hint="ADR-0010 · the Smart Agent IS the identity">
        <Field label="CAIP-10">
          <code style={{ fontSize: 12 }}>{caip10}</code>
        </Field>
        <Field label="Address">
          <code style={{ fontSize: 12 }}>{address}</code>
          {'  '}
          <a
            href={`${BASESCAN}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 8, fontSize: 12 }}
          >
            Basescan ↗
          </a>
        </Field>
      </Section>

      {/* 2. Agent Naming Service ──────────────────────────────── */}
      <Section
        title="Agent Naming Service (facet)"
        hint="Reverse + forward reads against the live universal resolver"
        action={
          <button
            type="button"
            onClick={refresh}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            ↻ refresh
          </button>
        }
      >
        {!client ? (
          <p style={{ color: '#9ca3af', fontSize: 12 }}>
            Naming contracts not configured in this build.
          </p>
        ) : (
          <>
            <Field label="Primary name (reverse-resolve)">
              {cachedName ? (
                <strong style={{ color: '#059669' }}>{cachedName}</strong>
              ) : (
                <span style={{ color: '#b45309' }}>
                  not yet resolved
                  {storedAgentName ? ` (expected ${storedAgentName})` : ''}
                </span>
              )}
            </Field>
            {storedAgentName && (
              <Field label="Forward resolve (sanity)">
                <code style={{ fontSize: 12 }}>{storedAgentName}</code>{' '}
                →{' '}
                {forwardQ.isFetching && !forwardQ.data ? (
                  <span style={{ color: '#9ca3af' }}>resolving…</span>
                ) : forwardQ.data ? (
                  <code
                    style={{
                      fontSize: 12,
                      color:
                        forwardQ.data.toLowerCase() === address.toLowerCase()
                          ? '#059669'
                          : '#dc2626',
                    }}
                  >
                    {forwardQ.data}
                    {forwardQ.data.toLowerCase() === address.toLowerCase()
                      ? ' ✓ matches'
                      : ' ✗ mismatch (round-trip will fail)'}
                  </code>
                ) : (
                  <span style={{ color: '#b45309' }}>not registered</span>
                )}
              </Field>
            )}
            {recordsQ.data && (
              <>
                {recordsQ.data.displayName && (
                  <Field label="Display name (record)">
                    {recordsQ.data.displayName}
                  </Field>
                )}
                {recordsQ.data.agentKind && (
                  <Field label="Agent kind (record)">
                    {recordsQ.data.agentKind}
                  </Field>
                )}
                {recordsQ.data.addr && (
                  <Field label="addr (record)">
                    <code style={{ fontSize: 12 }}>{recordsQ.data.addr}</code>
                  </Field>
                )}
                {recordsQ.data.nativeId && (
                  <Field label="nativeId (CAIP-10 record)">
                    <code style={{ fontSize: 12 }}>{recordsQ.data.nativeId}</code>
                  </Field>
                )}
                {recordsQ.data.metadataUri && (
                  <Field label="Metadata URI (record)">
                    <code style={{ fontSize: 12 }}>{recordsQ.data.metadataUri}</code>
                  </Field>
                )}
              </>
            )}
          </>
        )}
      </Section>

      {/* 3. Control credentials ──────────────────────────────── */}
      {(passkey || siwe) && (
        <Section
          title="Control credentials (facets)"
          hint="ADR-0011 · credentials are replaceable; the SA persists"
        >
          {passkey && (
            <>
              <Field label="Passkey credential">
                {storedAgentName ? (
                  <strong>{storedAgentName}</strong>
                ) : (
                  <span style={{ color: '#9ca3af' }}>
                    (no OS-level name stored)
                  </span>
                )}
              </Field>
              <Field label="PIA (passkey identity address)">
                <code style={{ fontSize: 12 }}>{passkey.pia}</code>
              </Field>
              <Field label="credentialIdDigest">
                <code style={{ fontSize: 11 }}>{passkey.credentialIdDigest}</code>
              </Field>
            </>
          )}
          {siwe && (
            <Field label="Wallet (SIWE) EOA">
              <code style={{ fontSize: 12 }}>{siwe.eoa}</code>
            </Field>
          )}
        </Section>
      )}

      {/* 4. Profile (forward-looking placeholder) ────────────── */}
      <Section
        title="Profile (facet)"
        hint="Optional HCS-11-aligned AgentCard anchored at this SA"
      >
        {kind === 'person' ? (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            Profile publishing is available from the dashboard once at
            least one seat is claimed. The profile JSON is anchored at the
            canonical SA; its content-hash lives on chain via{' '}
            <code>AgentProfileResolver</code>.
          </p>
        ) : (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            Org / treasury profiles are wired in a later Act.
          </p>
        )}
      </Section>

      {/*
        Diagnostic ONLY after the initial query has settled. Avoids the
        confusing "Primary name: resolving…" + amber diagnostic combo
        the user saw during the first fetch.
      */}
      {client && storedAgentName && reverseEmpty && (
        <div
          style={{
            marginTop: 14,
            padding: 10,
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            fontSize: 12,
            color: '#78350f',
          }}
        >
          <strong>Diagnostic:</strong>{' '}
          {forwardMatches
            ? `the forward record claims ${storedAgentName} → this SA, but the SA's reverse record (primaryName) was never set on chain. setPrimaryName is the missing step.`
            : `${storedAgentName} doesn't resolve to this SA. subregistry.register may have failed; check the success card from the act that created this agent.`}
          {canRecover && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                disabled={setPrimaryState === 'running'}
                onClick={() => void runSetPrimary()}
                style={{
                  padding: '6px 12px',
                  background: setPrimaryState === 'running' ? '#9ca3af' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: setPrimaryState === 'running' ? 'wait' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {setPrimaryState === 'running'
                  ? 'Signing + waiting for confirmation (up to ~60s)…'
                  : setPrimaryState === 'done'
                    ? '✓ Set — refreshing'
                    : `Set primary name now (${storedAgentName})`}
              </button>
              {setPrimaryState === 'error' && setPrimaryError && (
                <div
                  style={{
                    marginTop: 6,
                    color: '#dc2626',
                    fontSize: 11,
                    background: 'white',
                    padding: 6,
                    borderRadius: 4,
                  }}
                >
                  {setPrimaryError}
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 11, color: '#92400e' }}>
                Sends one gasless userOp from this SA via the passkey
                path. The SA already owns <code>{storedAgentName}</code>
                ; this just writes the SA→node reverse record.
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
          {hint && (
            <div style={{ fontSize: 11, color: '#6b7280' }}>{hint}</div>
          )}
        </div>
        {action}
      </div>
      <div
        style={{
          padding: 10,
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: '#f9fafb',
          fontSize: 13,
          display: 'grid',
          gap: 4,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8 }}>
      <div style={{ color: '#6b7280', fontSize: 12 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function kindLabel(kind: AgentDetailKind): string {
  switch (kind) {
    case 'person': return 'Person Smart Agent';
    case 'org': return 'Organization Smart Agent';
    case 'service': return 'Service Smart Agent';
    case 'treasury': return 'Treasury Service Agent';
  }
}
