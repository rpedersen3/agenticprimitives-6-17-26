// Posted-needs card for the GCO workspace (production UX Wave C, design spec §10 "secondary card:
// posted needs (status pills)" + §15c "duplicate need → show existing + edit/withdraw"). Reads the
// GCO org's OWN needs from the entitled view (`allNeeds()`); each row shows a status pill + edit /
// withdraw actions. Mutations go through the ONE data mechanism (`saveGcoNeeds` on the org's own vault,
// via the session grant) then re-hydrate the entitled view (ADR-0013, no second path).
//
// Withdraw = set the need's `status` to `withdrawn`. Edit (a lighter "re-post") = withdraw the need
// and prefill the wizard via `onEdit` so the user re-posts it cleanly; full inline edit is deferred.

import { useState } from 'react';
import type { GcoNeedIntent } from '../domain/gs-types';
import { loadGcoNeeds, saveGcoNeeds } from '../lib/member-vault';
import { setActiveContext } from '../lib/store';
import type { MemberSession } from '../lib/session';
import { Banner, Card, Pill, SectionHead } from './ui';

/** Status → pill tone. Live work = live; open = ok; withdrawn/closed = warn/neutral. */
function tone(status: GcoNeedIntent['status']): 'ok' | 'warn' | 'neutral' | 'live' {
  if (status === 'fulfilled' || status === 'agreement_active') return 'live';
  if (status === 'withdrawn') return 'neutral';
  if (status === 'open') return 'ok';
  return 'warn'; // matched / requested / draft — in-flight
}

export function GcoPostedNeeds({ needs, session, orgName, onEdit }: {
  needs: GcoNeedIntent[];
  session: MemberSession;
  orgName: string;
  /** Re-open the wizard prefilled from this need (a "re-post"/edit). */
  onEdit?: (need: GcoNeedIntent) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Load → mutate → save → re-hydrate the entitled view. ONE mechanism (the org's own vault).
  async function mutateNeed(id: string, mut: (n: GcoNeedIntent) => GcoNeedIntent) {
    setBusyId(id); setErr(null);
    try {
      const current = await loadGcoNeeds(session.grant);
      const next = current.map((n) => (n.id === id ? mut(n) : n));
      await saveGcoNeeds(session.grant, next);
      await setActiveContext({ persona: 'gco', session });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const withdraw = (n: GcoNeedIntent) =>
    void mutateNeed(n.id, (cur) => ({ ...cur, status: 'withdrawn', updatedAt: new Date().toISOString() }));

  // Edit = withdraw the existing need (so we don't leave a duplicate) + prefill the wizard to re-post.
  const edit = (n: GcoNeedIntent) => {
    onEdit?.(n);
    void mutateNeed(n.id, (cur) => ({ ...cur, status: 'withdrawn', updatedAt: new Date().toISOString() }));
  };

  return (
    <Card>
      <SectionHead
        eyebrow="Your posted needs · org vault"
        title="Posted needs"
        sub={`Needs ${orgName} has declared (in your own org vault). The Switchboard scores them against KC offerings — switch to the Switchboard board to broker connections.`}
      />
      {err && <div style={{ marginBottom: '.6rem' }}><Banner tone="err">{err}</Banner></div>}
      {needs.length === 0 && <p style={{ fontSize: '.86rem', color: 'var(--c-g500)' }}>None yet — post one above.</p>}
      {needs.map((n) => {
        const closed = n.status === 'withdrawn' || n.status === 'fulfilled';
        const busy = busyId === n.id;
        return (
          <div key={n.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.5rem 0', borderBottom: '1px solid var(--c-g100)', fontSize: '.86rem', flexWrap: 'wrap' }}>
            <Pill tone={tone(n.status)}>{n.status}</Pill>
            <span style={{ flex: 1, minWidth: 160, textDecoration: n.status === 'withdrawn' ? 'line-through' : 'none', color: n.status === 'withdrawn' ? 'var(--c-g400)' : 'inherit' }}>{n.title}</span>
            {n.requiredSkills.map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{s.label}</span>)}
            {!closed && (
              <span style={{ display: 'flex', gap: '.8rem' }}>
                <RowBtn disabled={busy} onClick={() => edit(n)}>edit</RowBtn>
                <RowBtn disabled={busy} onClick={() => withdraw(n)}>{busy ? 'working…' : 'withdraw'}</RowBtn>
              </span>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function RowBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ fontSize: '.76rem', color: 'var(--c-primary)', background: 'none', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', textDecoration: 'underline', opacity: disabled ? 0.5 : 1, padding: 0 }}
    >
      {children}
    </button>
  );
}
