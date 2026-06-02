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
import { toOrgLabel, type MemberOrg } from '../lib/member-org';

export function MemberOrgSection({
  kind,
  org,
  onCreateOrg,
}: {
  kind: 'adopter' | 'facilitator';
  org: MemberOrg | null;
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
        {org ? <OrgActive kind={kind} org={org} /> : <OrgClaim label={label} onCreateOrg={onCreateOrg} />}
      </div>
    </section>
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

function OrgActive({ kind, org }: { kind: 'adopter' | 'facilitator'; org: MemberOrg }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--c-g900)' }}>{org.orgName}</span>
          <Pill tone="live">● Org SA</Pill>
          <span style={{ color: 'var(--c-g500)', fontSize: '.85rem' }}><AddrLink addr={org.orgAgent as Address} /></span>
          <Pill tone="neutral">custodied by you</Pill>
        </div>
        {org.orgDelegation && (
          <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginTop: '.5rem' }}>
            demo-jp holds a scoped org→app delegation (for reads) — not custody. Disconnect at your home and its access goes to zero.
          </p>
        )}
      </Card>

      <MemberTrustPanel kind={kind} orgAgent={org.orgAgent as Address} orgName={org.orgName} />
    </div>
  );
}
