// App shell header (spec 252 design spec §6/§15a). Replaces the free RoleSwitcher: member roles now
// require a real Connect session, and Jane/Pete are clearly-labeled DEMO ADMIN shortcuts in a dropdown.
//
// Two states:
//   • signed out  — brand (left) + primary `Connect ▾` (right) with the demo-admin shortcuts + help link.
//   • connected   — identity pill (name · active role) + a dropdown with the identity summary, Open
//                   Global.Church home, Disconnect, role switch/setup (only when caps are known), and
//                   the same demo shortcuts.
// All actions are lifted to the App (it owns routing + the store/session); this is presentation.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { GS } from '../lib/gs-brand';
import { personalHome } from '../lib/domain';
import type { RoleCapabilities, RoleKind } from '../lib/role-capabilities';

const ROLE_LABEL: Record<RoleKind, string> = { gco: 'GCO', kc: 'KC Expert' };

export interface ConnectedIdentity {
  name: string;
  activeRole: RoleKind;
}

export function AppShellHeader({
  identity, caps,
  onConnect, onDemoJane, onDemoPete, onHelp,
  onOpenHome, onDisconnect, onSwitchRole, onSetupRole,
}: {
  /** The connected member, or null when signed out. */
  identity: ConnectedIdentity | null;
  /** Role capabilities (connected only) — drives the switch/setup entries. */
  caps: RoleCapabilities | null;
  /** Signed-out: open the role-aware connect entry (chooser). */
  onConnect: () => void;
  onDemoJane: () => void;
  onDemoPete: () => void;
  onHelp: () => void;
  /** Connected actions. */
  onOpenHome: () => void;
  onDisconnect: () => void;
  /** Switch to a ready role (connected, capabilities known). */
  onSwitchRole: (kind: RoleKind) => void;
  /** Begin setup for a not-yet-ready role. */
  onSetupRole: (kind: RoleKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const close = () => setOpen(false);
  const run = (fn: () => void) => () => { close(); fn(); };

  return (
    <header className="topbar">
      <div className="wrap">
        <div className="brand">
          <span className="brand-glyph" aria-hidden="true">🎛️</span>
          <span>{GS.org}<small>skills · needs · offerings · matches</small></span>
        </div>

        <div ref={ref} style={{ position: 'relative' }}>
          {identity ? (
            <button onClick={() => setOpen((v) => !v)} className="btn-primary" style={pillBtn} aria-haspopup="menu" aria-expanded={open}>
              <span>{identity.name} · {ROLE_LABEL[identity.activeRole]}</span>
              <span aria-hidden="true">▾</span>
            </button>
          ) : (
            <button onClick={() => setOpen((v) => !v)} className="btn-primary" style={pillBtn} aria-haspopup="menu" aria-expanded={open}>
              <span>Connect</span>
              <span aria-hidden="true">▾</span>
            </button>
          )}

          {open && (
            <div role="menu" style={menu}>
              {identity
                ? <ConnectedMenu
                    identity={identity} caps={caps}
                    onOpenHome={run(onOpenHome)} onDisconnect={run(onDisconnect)}
                    onSwitchRole={(k) => run(() => onSwitchRole(k))()} onSetupRole={(k) => run(() => onSetupRole(k))()}
                    onDemoJane={run(onDemoJane)} onDemoPete={run(onDemoPete)} onHelp={run(onHelp)}
                  />
                : <SignedOutMenu
                    onConnect={run(onConnect)} onDemoJane={run(onDemoJane)} onDemoPete={run(onDemoPete)} onHelp={run(onHelp)}
                  />}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function SignedOutMenu({ onConnect, onDemoJane, onDemoPete, onHelp }: {
  onConnect: () => void; onDemoJane: () => void; onDemoPete: () => void; onHelp: () => void;
}) {
  return (
    <>
      <MenuItem onClick={onConnect} primary>{GS.ssoCta}</MenuItem>
      <Divider />
      <DemoShortcuts onDemoJane={onDemoJane} onDemoPete={onDemoPete} />
      <Divider />
      <MenuItem onClick={onHelp} muted>Privacy &amp; data access</MenuItem>
    </>
  );
}

function ConnectedMenu({ identity, caps, onOpenHome, onDisconnect, onSwitchRole, onSetupRole, onDemoJane, onDemoPete, onHelp }: {
  identity: ConnectedIdentity;
  caps: RoleCapabilities | null;
  onOpenHome: () => void; onDisconnect: () => void;
  onSwitchRole: (k: RoleKind) => void; onSetupRole: (k: RoleKind) => void;
  onDemoJane: () => void; onDemoPete: () => void; onHelp: () => void;
}) {
  // Role switch/setup entries — only the OTHER role(s), and only when capabilities are known.
  const others: RoleKind[] = (['gco', 'kc'] as RoleKind[]).filter((k) => k !== identity.activeRole);
  return (
    <>
      <div style={{ padding: '.6rem .9rem' }}>
        <div style={{ fontWeight: 800, fontSize: '.95rem', color: 'var(--c-g900)' }}>{identity.name}</div>
        <div style={{ fontSize: '.76rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>{personalHome(identity.name)}</div>
        <div style={{ marginTop: '.4rem', display: 'inline-block', background: 'var(--c-primary-subtle)', border: '1px solid var(--c-primary-border)', borderRadius: 999, padding: '.15rem .55rem', fontSize: '.72rem', fontWeight: 700, color: 'var(--c-primary-active)' }}>
          Working as {ROLE_LABEL[identity.activeRole]}
        </div>
      </div>
      <Divider />
      <MenuItem onClick={onOpenHome}>Open {GS.community} home</MenuItem>
      {caps && others.map((k) => {
        const cap = caps.byKind[k];
        return cap.state === 'ready'
          ? <MenuItem key={k} onClick={() => onSwitchRole(k)}>Switch workspace: {ROLE_LABEL[k]}</MenuItem>
          : <MenuItem key={k} onClick={() => onSetupRole(k)} muted>Set up {ROLE_LABEL[k]} workspace</MenuItem>;
      })}
      <MenuItem onClick={onDisconnect} danger>Disconnect</MenuItem>
      <Divider />
      <DemoShortcuts onDemoJane={onDemoJane} onDemoPete={onDemoPete} />
      <Divider />
      <MenuItem onClick={onHelp} muted>Privacy &amp; data access</MenuItem>
    </>
  );
}

function DemoShortcuts({ onDemoJane, onDemoPete }: { onDemoJane: () => void; onDemoPete: () => void }) {
  return (
    <div style={{ padding: '.4rem .6rem .2rem' }}>
      <div style={{ fontSize: '.66rem', fontWeight: 800, letterSpacing: '.06em', color: 'var(--c-g400)', padding: '.1rem .3rem .35rem' }}>
        DEMO ADMIN — NOT PRODUCTION AUTHORIZATION
      </div>
      <button role="menuitem" onClick={onDemoJane} style={demoItem}>🎛️ Jane / Switchboard (broker)</button>
      <button role="menuitem" onClick={onDemoPete} style={demoItem}>⛪ Pete / Global Church (issuer)</button>
    </div>
  );
}

function MenuItem({ children, onClick, primary, muted, danger }: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; muted?: boolean; danger?: boolean;
}) {
  const color = danger ? '#d97706' : primary ? 'var(--c-primary)' : muted ? 'var(--c-g500)' : 'var(--c-g800)';
  return (
    <button role="menuitem" onClick={onClick} style={{ ...itemBase, color, fontWeight: primary || danger ? 700 : 500 }}>
      {children}
    </button>
  );
}

function Divider() { return <div style={{ height: 1, background: 'var(--c-g100)', margin: '.3rem 0' }} />; }

const pillBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '.45rem', borderRadius: 9, padding: '.5rem .9rem',
  fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', border: 'none',
};
const menu: CSSProperties = {
  position: 'absolute', right: 0, top: 'calc(100% + .5rem)', width: 320, background: '#fff',
  border: '1.5px solid var(--c-g200)', borderRadius: 12, boxShadow: '0 12px 32px rgba(15,23,42,.14)',
  padding: '.4rem', zIndex: 50,
};
const itemBase: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
  padding: '.55rem .9rem', fontSize: '.86rem', borderRadius: 8,
};
const demoItem: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '.5rem .6rem',
  fontSize: '.82rem', color: 'var(--c-g700)', borderRadius: 8, marginBottom: '.3rem',
  background: 'var(--c-accent-subtle)', border: '1px solid var(--c-accent-border)',
};
