// Connected role hub (spec 252 design spec §9/§15a; reworked per direct UX feedback). This IS the
// connected intranet home — a person lands here right after connecting (not auto into a workspace) and
// chooses what to do. Two cards:
//   • KC (supply) — "Offer your expertise" → open the KC workspace immediately (the person session
//     already grants KC vault access; no extra ceremony).
//   • GCO (demand) — "Set up an organization to post needs" → launch the org-create ceremony directly
//     (the connected person is the signatory). If a gco session already exists → "Open GCO workspace".
//     If an org-create is in flight (org-pending) → "Resume org setup".
// The actions are the App's responsibility; this is presentation.

import type { RoleCapabilities, RoleKind } from '../lib/role-capabilities';
import { GS } from '../lib/gs-brand';
import { Btn, Card, Pill } from './ui';

interface CardCopy { side: string; title: string; sub: string; bullets: string[] }

const COPY: Record<RoleKind, CardCopy> = {
  kc: {
    side: 'SUPPLY',
    title: 'Offer your expertise (KC)',
    sub: 'Act as your own individual person agent',
    bullets: ['Publish your expertise offering', 'Browse coarsened demand', 'Accept requests on your terms'],
  },
  gco: {
    side: 'DEMAND',
    title: 'Set up an organization to post needs (GCO)',
    sub: 'An organization you create + sign for',
    bullets: ['Create the org + mint its grant', 'Post a skill need', 'Review explainable matches'],
  },
};

export function RoleHub({ name, caps, onOpen, onResumeOrg, onSetupGco, onOpenHome }: {
  /** The connected person's display name, or '' when name-deferred (signed in with Google/passkey and
   *  hasn't claimed a public handle yet). We NEVER render a placeholder name — the heading goes
   *  identity-light instead of saying "Welcome, you". */
  name: string;
  caps: RoleCapabilities;
  /** Open a ready workspace (KC immediately, or an already-created GCO). */
  onOpen: (kind: RoleKind) => void;
  /** Resume the GCO org-create (org-pending). */
  onResumeOrg: () => void;
  /** Launch the GCO org-create ceremony from the hub (connected person = signatory). */
  onSetupGco: () => void;
  /** Open the person's Global.Church home. */
  onOpenHome: () => void;
}) {
  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>
          {name ? `Welcome, ${name}` : `You’re connected to ${GS.community}`}
        </h1>
        <p style={{ fontSize: '.9rem', color: 'var(--c-g600)', marginTop: '.3rem' }}>
          What would you like to do? You can do both and switch any time &mdash; it&rsquo;s all one
          connection, not separate accounts.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {/* KC first: "offer your expertise" is the no-ceremony path the connected person can take now. */}
        {(['kc', 'gco'] as RoleKind[]).map((kind) => {
          const cap = caps.byKind[kind];
          const c = COPY[kind];
          return (
            <Card key={kind}>
              <Pill tone="ok">{c.side}</Pill>
              <h2 style={{ fontSize: '1.25rem', marginTop: '.6rem' }}>{c.title}</h2>
              <p style={{ fontSize: '.85rem', color: 'var(--c-g600)', marginTop: '.2rem' }}>{c.sub}</p>
              <ul style={{ paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.3rem', marginTop: '.8rem' }}>
                {c.bullets.map((b) => <li key={b} style={{ fontSize: '.84rem', color: 'var(--c-g700)' }}>{b}</li>)}
              </ul>
              <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                <StatePill state={cap.state} />
                <span style={{ flex: 1 }} />
                <RoleAction
                  kind={kind}
                  state={cap.state}
                  onOpen={() => onOpen(kind)}
                  onResumeOrg={onResumeOrg}
                  onSetupGco={onSetupGco}
                />
              </div>
            </Card>
          );
        })}
      </div>

      <Card style={{ background: 'var(--c-g50)' }}>
        <button onClick={onOpenHome} style={{ background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, fontSize: '.88rem', cursor: 'pointer', padding: 0 }}>
          Open {GS.community} home
        </button>
        <p style={{ fontSize: '.8rem', color: 'var(--c-g500)', marginTop: '.3rem' }}>
          Your data lives in your {GS.community} home; Switchboard reads only what you grant.
        </p>
      </Card>
    </div>
  );
}

function StatePill({ state }: { state: RoleCapabilities['byKind']['gco']['state'] }) {
  if (state === 'ready') return <Pill tone="live">ready</Pill>;
  if (state === 'org-pending') return <Pill tone="warn">org pending</Pill>;
  return <Pill tone="neutral">not started</Pill>;
}

function RoleAction({ kind, state, onOpen, onResumeOrg, onSetupGco }: {
  kind: RoleKind;
  state: RoleCapabilities['byKind']['gco']['state'];
  onOpen: () => void;
  onResumeOrg: () => void;
  onSetupGco: () => void;
}) {
  if (state === 'ready') {
    const label = kind === 'kc' ? 'Offer your expertise' : 'Open your organization';
    return <Btn size="sm" onClick={onOpen}>{label}</Btn>;
  }
  if (state === 'org-pending') {
    return <Btn size="sm" onClick={onResumeOrg}>Resume org setup</Btn>;
  }
  // empty: KC opens immediately (no ceremony — the person session already grants it); GCO launches the
  // org-create ceremony directly from the hub.
  if (kind === 'kc') {
    return <Btn size="sm" onClick={onOpen}>Offer your expertise</Btn>;
  }
  return <Btn variant="ghost" size="sm" onClick={onSetupGco}>Set up an organization</Btn>;
}
