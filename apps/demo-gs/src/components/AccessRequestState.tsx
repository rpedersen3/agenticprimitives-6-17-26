// Request-access / missing-delegation state (production UX Wave C, design spec §3a "missing-delegation
// is not a first-class state" + §15c + the mockup `demo-gs-access-request-state.svg`). Shown when a
// member workspace needs vault data but the scoped grant is missing/failed — instead of a raw error
// banner. Per ADR-0013 there is NO silent fallback: the GCO org→Switchboard grant is the ONE mechanism
// to read the org's needs, so the recovery is to re-mint it (re-create the org), with an explicit
// limited-view escape.
//
// Reusable: the access disclosure (owner / scope / grantee / revoke) + the primary recovery CTA + the
// optional limited-view option are passed in, so a KC variant (Wave D) can reuse this shell.

import { Card } from './ui';

export interface GrantDisclosure {
  owner: string; // who owns the data, e.g. "your GCO org"
  scope: string; // what would be read, e.g. "the needs your org posts"
  grantee: string; // who receives access, e.g. "Global Switchboard"
}

export function AccessRequestState({
  title, body, disclosure, primary, limited,
}: {
  title: string;
  body: string;
  disclosure: GrantDisclosure;
  /** The recovery action — re-mint the grant (e.g. re-create the org). */
  primary: { label: string; onClick: () => void };
  /** Optional escape to a limited view without the grant. */
  limited?: { label: string; onClick: () => void };
}) {
  return (
    <Card style={{ maxWidth: 560, margin: '1rem auto', borderColor: 'var(--c-accent-border)' }}>
      <div style={{ fontSize: '2rem', textAlign: 'center' }} aria-hidden="true">🔒</div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 800, textAlign: 'center', marginTop: '.4rem' }}>{title}</h2>
      <p style={{ fontSize: '.88rem', color: 'var(--c-g600)', textAlign: 'center', marginTop: '.5rem', lineHeight: 1.5 }}>{body}</p>

      <div style={{ background: 'var(--c-accent-subtle)', border: '1px solid var(--c-accent-border)', borderRadius: 12, padding: '.8rem 1rem', margin: '1.1rem 0', display: 'grid', gap: '.35rem' }}>
        <Row k="Owner" v={disclosure.owner} />
        <Row k="Scope" v={disclosure.scope} />
        <Row k="Grantee" v={disclosure.grantee} />
        <Row k="Revoke" v="Anytime, from your Global.Church home" />
      </div>

      <button
        className="btn-primary"
        onClick={primary.onClick}
        style={{ width: '100%', borderRadius: 10, padding: '.7rem 1rem', fontWeight: 700, fontSize: '.9rem', border: 'none', cursor: 'pointer' }}
      >
        {primary.label}
      </button>
      {limited && (
        <button
          onClick={limited.onClick}
          style={{ width: '100%', marginTop: '.6rem', background: 'none', border: 'none', color: 'var(--c-primary)', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}
        >
          {limited.label}
        </button>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: '.5rem', fontSize: '.82rem', color: 'var(--c-accent)' }}>
      <span style={{ fontWeight: 800, minWidth: 64 }}>{k}</span>
      <span style={{ color: 'var(--c-g700)' }}>{v}</span>
    </div>
  );
}
