// Member org section — mounted in the connected adopter / facilitator dashboard.
//
// The user (already connected via Impact SSO) creates THEIR org via the Impact
// org-create ceremony: the org Smart Agent is deployed + custodied by the user's
// ROOT credential at their home (demo-jp is never a custodian). Once the org
// exists, the member acts AS the org for all intent/agreement activity.
//
// Adopter Org / Facilitator Org are NOT public personas — this surface only
// appears once a member is connected.

import { useState } from 'react';
import type { Address } from '@agenticprimitives/types';

import { Card, SectionHead, Btn, Pill, Field, inputStyle, Banner, AddrLink } from './ui';
import { MemberTrustPanel } from './MemberTrustPanel';
import { toOrgLabel } from '../lib/member-org';
import { loadImpactProfile, type ImpactProfile } from '../lib/vault';
import type { RelatedOrgLink } from '../connect-client';

export function MemberOrgSection({
  kind,
  org,
  onCreateOrg,
}: {
  kind: 'adopter' | 'facilitator';
  org: RelatedOrgLink | null;
  /** Kicks off the Impact org-create ceremony with the given org name. */
  onCreateOrg: (orgName: string) => void | Promise<void>;
}) {
  const label = kind === 'adopter' ? 'Adopter' : 'Facilitator';
  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="sec-head">
        <div className="eyebrow">Your {label.toLowerCase()} organization · Base Sepolia</div>
        <h2>{org ? `Acting as ${org.orgName}` : `Create your ${label} Organization`}</h2>
        <p>
          {org
            ? `Everything below happens as your organization's Smart Agent — not as an individual. Your org is custodied by your own Impact credential; demo-jp only holds a scoped delegation.`
            : `Register your ${kind === 'adopter' ? 'church / organization' : 'facilitating organization'} as a Smart Agent. It's deployed + custodied by YOUR Impact credential — the same one that secures your personal home. You'll confirm with your device, then act as the org here.`}
        </p>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        {org ? (
          <>
            <OrgActive kind={kind} org={org} />
            <CreateAnother label={label} onCreateOrg={onCreateOrg} />
          </>
        ) : (
          <OrgClaim label={label} onCreateOrg={onCreateOrg} />
        )}
      </div>
    </section>
  );
}

/** When you already steward an org, the create form is collapsed behind a small link —
 *  you can still spin up another org, but the default view is your existing one. */
function CreateAnother({ label, onCreateOrg }: { label: string; onCreateOrg: (orgName: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ marginTop: '.8rem', background: 'none', border: 'none', color: 'var(--c-primary)', cursor: 'pointer', fontSize: '.82rem', padding: 0 }}
      >
        + Create another {label.toLowerCase()} organization
      </button>
    );
  }
  return (
    <div style={{ marginTop: '.9rem' }}>
      <OrgClaim label={label} onCreateOrg={onCreateOrg} />
    </div>
  );
}

function OrgClaim({ label, onCreateOrg }: { label: string; onCreateOrg: (orgName: string) => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const slug = toOrgLabel(name);
  const touched = name.trim().length > 0;
  const tooShort = slug.length < 2;
  const ok = !tooShort;
  // Did slugifying change the input (e.g. spaces/caps removed)? Tell the user.
  const normalized = touched && slug !== name.trim().toLowerCase();
  const go = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onCreateOrg(slug); // send the validated label, never the raw display text
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ maxWidth: 560 }}>
      <Field label="Organization name">
        <input
          style={inputStyle}
          placeholder={label === 'Adopter' ? 'e.g. Grace Community Church' : 'e.g. Frontier Path Network'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ok && !busy) go(); }}
        />
      </Field>
      {touched && (
        tooShort
          ? <div style={{ marginBottom: '.7rem' }}><Banner tone="warn">Use at least 2 letters or numbers (the name becomes a web-safe handle).</Banner></div>
          : <p style={{ fontSize: '.82rem', color: 'var(--c-g600)', marginBottom: '.7rem' }}>
              Registered as <code style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--c-primary-active)', fontWeight: 700 }}>{slug}.impact</code>
              {normalized && <span style={{ color: 'var(--c-g500)' }}> — spaces &amp; capitals are normalized to a web-safe handle.</span>}
            </p>
      )}
      <Btn busy={busy} disabled={!ok} onClick={go}>Create my {label} Org →</Btn>
      <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.7rem' }}>
        Opens your secure Impact home to confirm with your device. The org is deployed on Base Sepolia,
        custodied by you — then you return here to act as it.
      </p>
    </Card>
  );
}

function OrgActive({ kind, org }: { kind: 'adopter' | 'facilitator'; org: RelatedOrgLink }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--c-g900)' }}>{org.orgName}</span>
          <Pill tone="live">● Org SA</Pill>
          <span style={{ color: 'var(--c-g500)', fontSize: '.85rem' }}><AddrLink addr={org.orgAgent as Address} /></span>
          <Pill tone="neutral">custodied by you</Pill>
        </div>
        {org.delegation && (
          <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.5rem' }}>
            demo-jp holds a scoped org→app delegation (for reads) — not custody. Disconnect at your home and its access goes to zero.
          </p>
        )}
      </Card>

      <OrgMemberReadPanel org={org} />

      <MemberTrustPanel kind={kind} orgAgent={org.orgAgent as Address} orgName={org.orgName} />
    </div>
  );
}

/** What the org can read about its MEMBER, via the membership delegation (person→org,
 *  spec 246). The org presents that delegation to the per-agent vault; the data owner is
 *  the member (the delegator), so the relayer reads the member's own vault — the org sees
 *  its member without custodying their data. This is the concrete consume of the membership
 *  delegation (the stewardship direction is consumed on the person's Impact home /you). */
function OrgMemberReadPanel({ org }: { org: RelatedOrgLink }) {
  const d = org.membershipDelegation;
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<ImpactProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!d) return null; // older / operator-registered orgs carry no membership delegation

  const load = async () => {
    setOpen(true);
    if (profile) return;
    setBusy(true);
    setErr(null);
    try {
      setProfile(await loadImpactProfile(d));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'read failed');
    } finally {
      setBusy(false);
    }
  };

  const c = profile?.contact;
  const name = [c?.firstName, c?.lastName].filter(Boolean).join(' ');
  const fields: Array<[string, string | undefined]> = [
    ['Name', name || undefined],
    ['Email', c?.email],
    ['Country', c?.country],
    ['WEA Statement of Faith', profile?.attestations.wea ? 'signed ✓' : undefined],
  ];
  const known = fields.filter(([, v]) => v);

  return (
    <Card>
      <SectionHead
        eyebrow="Membership · what your org reads about you"
        title="Your org's view of you, its member"
        sub="As the organization, you hold a scoped membership delegation to read your member's community profile from their Impact vault — the data stays with the member."
      />
      {!open ? (
        <Btn variant="ghost" onClick={load}>Read my member profile (via membership delegation) →</Btn>
      ) : busy ? (
        <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>Reading the member&rsquo;s vault over the delegation…</p>
      ) : err ? (
        <Banner tone="warn">Couldn&rsquo;t read: {err}</Banner>
      ) : known.length === 0 ? (
        <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>
          The membership read succeeded — the member&rsquo;s community profile is empty so far. Once they add contact
          details or sign the WEA at their Impact home, the org sees them here.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {known.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: '.6rem', fontSize: '.85rem', borderTop: '1px solid var(--c-g100)', padding: '.4rem 0' }}>
              <span style={{ color: 'var(--c-g500)', minWidth: 170 }}>{k}</span>
              <span style={{ color: 'var(--c-g800)', fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <p style={{ fontSize: '.72rem', color: 'var(--c-g500)', marginTop: '.3rem' }}>
            Read from the member&rsquo;s own vault via the membership delegation — never copied into the org.
          </p>
        </div>
      )}
    </Card>
  );
}
