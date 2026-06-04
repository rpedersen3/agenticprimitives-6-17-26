// Connected role hub (spec 252 design spec §9/§15a). Shown when a person is connected but no active
// workspace is selected (or chosen from the header dropdown). Two cards — GCO (demand) + KC (supply) —
// each driven by the per-role state from `deriveRoleCapabilities`: `ready` → Open; `org-pending` →
// resume org-create; `empty` → set up. The actions are the App's responsibility; this is presentation.

import type { RoleCapabilities, RoleKind } from '../lib/role-capabilities';
import { GS } from '../lib/gs-brand';
import { Card, Pill } from './ui';

interface CardCopy { side: string; title: string; sub: string; bullets: string[] }

const COPY: Record<RoleKind, CardCopy> = {
  gco: {
    side: 'DEMAND',
    title: 'GCO Organization',
    sub: 'An organization you create + sign for',
    bullets: ['Create org + mint grant', 'Post a skill need', 'Review explainable matches'],
  },
  kc: {
    side: 'SUPPLY',
    title: 'KC Expert',
    sub: 'Your own individual person agent',
    bullets: ['Publish your expertise offering', 'Browse coarsened demand', 'Accept requests on your terms'],
  },
};

export function RoleHub({ name, caps, onOpen, onResumeOrg, onSetup, onOpenHome }: {
  name: string;
  caps: RoleCapabilities;
  /** Open a ready workspace. */
  onOpen: (kind: RoleKind) => void;
  /** Resume the GCO org-create (org-pending). */
  onResumeOrg: () => void;
  /** Begin setup for a not-started role (routes to the grant-review/connect entry). */
  onSetup: (kind: RoleKind) => void;
  /** Open the person's Global.Church home. */
  onOpenHome: () => void;
}) {
  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>Welcome back, {name}</h1>
        <p style={{ fontSize: '.9rem', color: 'var(--c-g600)', marginTop: '.3rem' }}>
          Choose or resume a workspace. You&rsquo;re connected as one person; roles are workspaces.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {(['gco', 'kc'] as RoleKind[]).map((kind) => {
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
                  onSetup={() => onSetup(kind)}
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

function RoleAction({ kind, state, onOpen, onResumeOrg, onSetup }: {
  kind: RoleKind;
  state: RoleCapabilities['byKind']['gco']['state'];
  onOpen: () => void;
  onResumeOrg: () => void;
  onSetup: () => void;
}) {
  if (state === 'ready') {
    return <button className="btn-primary" onClick={onOpen} style={btn}>Open {kind.toUpperCase()} workspace</button>;
  }
  if (state === 'org-pending') {
    return <button className="btn-primary" onClick={onResumeOrg} style={btn}>Resume org setup</button>;
  }
  return <button className="btn-ghost" onClick={onSetup} style={btn}>Set up {kind.toUpperCase()}</button>;
}

const btn: React.CSSProperties = {
  borderRadius: 10, padding: '.55rem 1.1rem', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', border: 'none',
};
