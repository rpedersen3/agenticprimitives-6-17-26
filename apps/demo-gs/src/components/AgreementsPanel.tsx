// Agreement / connection lifecycle + provenance (spec 250 §12.4, §15, §17.1). Shows confirmed
// relationships, the 9-state lifecycle, the provenance timeline, and the contact released on accept.
// Role-aware: the KC accepts/declines a request; either party concludes; the broker can fulfil.

import { useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import type { GsAgreement, GsConnectionStatus } from '../domain/gs-status';
import { CONNECTION_STATUS_LABEL, nextStatuses } from '../domain/gs-status';
import { needById, respondToRequest, transitionAgreement } from '../lib/store';
import type { Persona } from '../lib/personas';
import { AgreementTimeline } from './AgreementTimeline';
import { AddrChip, Btn, Card, Pill, SectionHead } from './ui';
import { useToast } from './Toast';

const STATUS_TONE: Record<GsConnectionStatus, 'ok' | 'warn' | 'neutral' | 'live'> = {
  proposed: 'neutral', requested: 'warn', confirmed: 'ok', ongoing: 'live',
  gco_declined: 'neutral', kc_declined: 'neutral', gco_concluded: 'neutral', kc_concluded: 'neutral', fulfilled: 'live',
};

export function AgreementsPanel({ agreements, role, actorPerson, onChanged }: {
  agreements: GsAgreement[];
  role: Persona;
  actorPerson: Address;
  onChanged?: () => void;
}) {
  if (agreements.length === 0) {
    return <Card><SectionHead eyebrow="Switchboard · connections" title="Agreements" /><p style={{ color: 'var(--c-g500)', fontSize: '.88rem' }}>No connections yet. Request one from the match board.</p></Card>;
  }

  // Track which agreement is mid-action so its buttons show a busy/spinner state (the underlying
  // store ops are async vault round-trips). A small error surfaces if the op throws.
  const [pending, setPending] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const toast = useToast();
  // `successToast` fires only after the async op resolves; an error is toasted (+ inline) on throw.
  const act = (id: string, fn: () => void | Promise<unknown>, successToast?: { msg: string; tone: 'ok' | 'info' }) => {
    setPending(id); setActErr(null);
    void Promise.resolve(fn())
      .then(() => { onChanged?.(); if (successToast) toast(successToast.msg, successToast.tone); })
      .catch((e) => { const m = e instanceof Error ? e.message : String(e); setActErr(m); toast(m, 'err'); })
      .finally(() => setPending(null));
  };

  return (
    <Card>
      <SectionHead eyebrow="Switchboard · connections" title="Agreements" sub="The Agreement is the audit backbone: who agreed to serve whom, for which need, on which skill, when, and how it ended. Confidential contact is released only after the KC accepts." />
      {agreements.map((a) => {
        const need = needById(a.needId);
        const transitions = nextStatuses(a.status).filter((t) => t !== 'confirmed' && t !== 'kc_declined');
        return (
          <div key={a.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 12, padding: '1rem', marginBottom: '.8rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill tone={STATUS_TONE[a.status]}>{CONNECTION_STATUS_LABEL[a.status]}</Pill>
              <strong style={{ fontSize: '.92rem' }}>{need?.title ?? a.needId}</strong>
            </div>
            <p style={{ fontSize: '.82rem', color: 'var(--c-g600)', marginTop: '.4rem' }}>
              <AddrChip id={a.gcoOrgAgentId} /> (GCO) ↔ <AddrChip id={a.kcPersonAgentId} /> (KC)
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.7rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {a.status === 'requested' && role === 'kc' && (
                <>
                  <Btn busy={pending === a.id} size="sm" onClick={() => act(a.id, () => respondToRequest(a.id, true, actorPerson), { msg: 'Connection accepted — contact released', tone: 'ok' })}>Accept connection</Btn>
                  <Btn busy={pending === a.id} variant="ghost" size="sm" onClick={() => act(a.id, () => respondToRequest(a.id, false, actorPerson), { msg: 'Request declined', tone: 'info' })}>Decline</Btn>
                </>
              )}
              {a.status === 'requested' && role !== 'kc' && (
                <span style={{ fontSize: '.8rem', color: 'var(--c-g500)' }}>Awaiting the KC's response — switch to KC Expert to accept.</span>
              )}
              {transitions.map((t) => (
                <Btn key={t} busy={pending === a.id} variant="ghost" size="sm" onClick={() => act(a.id, () => transitionAgreement(a.id, t, actorPerson, `${role} → ${t}`), { msg: `Marked ${CONNECTION_STATUS_LABEL[t]}`, tone: 'ok' })}>
                  Mark {CONNECTION_STATUS_LABEL[t]}
                </Btn>
              ))}
            </div>
            {actErr && pending === null && <p style={{ fontSize: '.78rem', color: '#d97706', marginTop: '.4rem' }}>Couldn’t complete that action: {actErr}</p>}

            {/* Expandable match→agreement timeline (Wave E): actor swimlanes, the canonical
                concept-join, who-can-see-what, contact reveal, opt-in public assertion, and
                demo-admin jumps. Collapsed by default so the list stays scannable. The raw
                provenance event log is kept as a nested forensic sub-detail. */}
            <details style={{ marginTop: '.7rem' }}>
              <summary style={{ fontSize: '.78rem', color: 'var(--c-g500)', cursor: 'pointer', fontWeight: 700 }}>Timeline &amp; who can see what ({a.statusEvents.length} event{a.statusEvents.length === 1 ? '' : 's'})</summary>
              <AgreementTimeline agreement={a} role={role} />
              <details style={{ marginTop: '.7rem' }}>
                <summary style={{ fontSize: '.74rem', color: 'var(--c-g400)', cursor: 'pointer', fontWeight: 700 }}>Provenance log ({a.statusEvents.length} event{a.statusEvents.length === 1 ? '' : 's'})</summary>
                <ol style={{ margin: '.5rem 0 0', paddingLeft: '1.1rem' }}>
                  {a.statusEvents.map((e) => (
                    <li key={e.id} style={{ fontSize: '.78rem', color: 'var(--c-g600)', marginBottom: '.3rem' }}>
                      {e.previousStatus ? `${CONNECTION_STATUS_LABEL[e.previousStatus]} → ` : ''}<strong>{CONNECTION_STATUS_LABEL[e.nextStatus]}</strong>
                      {' '}by <AddrChip id={e.actorPersonAgentId} /> · {new Date(e.occurredAt).toLocaleString()}
                      {e.reason ? ` · ${e.reason}` : ''}
                    </li>
                  ))}
                </ol>
              </details>
            </details>
          </div>
        );
      })}
    </Card>
  );
}
