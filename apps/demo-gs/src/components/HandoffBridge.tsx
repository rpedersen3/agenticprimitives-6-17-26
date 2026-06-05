// Spec 255 W2 — the handoff bridge: a short interstitial shown BEFORE the redirect out to the member's
// Global.Church home, so the domain transition (and, for known-method paths, the one-step preview) is
// expected and not mistaken for phishing. It does NOT change the ceremony — the caller fires the actual
// startConnect / startOrgCreation only on onContinue (their PKCE stash + redirect must not run before
// the user confirms, or cancel).
//
// VARIANTS:
//  - 'org-create' : the GCO org-create launch (known passkey method) → full one-step treatment.
//
// The connect-entry 'new-user' + reconnect 'reconnect' variants were removed in spec 258 — the
// credential-first ConnectScreen launches the popup directly with no pre-ceremony bridge, so org-create
// (the one known-passkey, deliberate-confirm step from inside the hub) is the only remaining use.
//
// Auto-advances to onContinue after 3s unless cancelled (no visible countdown). Esc cancels; the primary
// CTA is focused on mount. Domain note is gated to non-localhost (only the real impact-agent.me hosts the
// per-handle RP), mirroring lib/domain's hostname gating.

import { useEffect, useRef } from 'react';
import { CONNECT_DOMAIN } from '../lib/domain';
import { Btn, Card, Pill } from './ui';

export type HandoffVariant = 'org-create';

const AUTO_ADVANCE_MS = 3000;

// Only the real central host (impact-agent.me) serves the per-handle home where the OS prompt names the
// domain; on localhost / pages.dev the prompt names the dev host, so the domain note would be misleading.
function showDomainNote(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === CONNECT_DOMAIN || h.endsWith('.' + CONNECT_DOMAIN);
}

export function HandoffBridge({ variant, orgName, onContinue, onCancel }: {
  variant: HandoffVariant;
  orgName?: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const continueRef = useRef<HTMLDivElement>(null);

  // Focus the primary CTA on mount + auto-advance after 3s (cancelled on unmount / cancel).
  useEffect(() => {
    continueRef.current?.querySelector('button')?.focus();
    const t = setTimeout(onContinue, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc = cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = variantCopy(variant, orgName);
  const domainNote = showDomainNote() ? copy.domainNote : null;

  return (
    <Card style={{ maxWidth: 560, margin: '0 auto' }}>
      <div
        role="region"
        aria-label="Taking you to your Global.Church home"
        className="handoff-bridge"
      >
        <div className="eyebrow">Taking you to your home</div>
        <h2 style={{ fontSize: '1.4rem', marginTop: '.35rem' }}>{copy.heading}</h2>
        <p style={{ fontSize: '.92rem', color: 'var(--c-g700)', marginTop: '.6rem', lineHeight: 1.55 }}>
          {copy.body}
        </p>

        {copy.step && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <Pill tone="ok">What you&rsquo;ll do there</Pill>
            <div style={{ fontSize: '.88rem', color: 'var(--c-g800)', lineHeight: 1.5, display: 'flex', gap: '.5rem' }}>
              <span aria-hidden="true" style={{ color: 'var(--c-primary)', fontWeight: 800 }}>1.</span>
              <span>{copy.step}</span>
            </div>
          </div>
        )}

        {domainNote && (
          <p className="soon" style={{ marginTop: '1rem', background: 'var(--c-g50)', borderColor: 'var(--c-g200)', color: 'var(--c-g600)' }}>
            {domainNote}
          </p>
        )}

        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div ref={continueRef}>
            <Btn variant="primary" onClick={onContinue}>{copy.continueLabel}</Btn>
          </div>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
          <span style={{ fontSize: '.78rem', color: 'var(--c-g500)', marginLeft: 'auto' }}>
            Taking you there in a moment — or continue now
          </span>
        </div>
      </div>
    </Card>
  );
}

interface BridgeCopy {
  heading: string;
  body: string;
  /** A single passkey one-step line. */
  step?: string;
  domainNote: string;
  continueLabel: string;
}

function variantCopy(variant: HandoffVariant, orgName?: string): BridgeCopy {
  switch (variant) {
    case 'org-create':
      return {
        heading: 'Taking you to your Impact home to create the org',
        body: 'Your org will be created and custodied at your Impact home — not by Global Switchboard.',
        step: `Approve creating ${orgName || 'your organization'} — starts the org, claims its name, and gives Switchboard scoped read access to its posted needs.`,
        domainNote: "The prompt will say 'impact-agent.me' — that is your home, not a new site.",
        continueLabel: 'Continue to Impact',
      };
  }
}
