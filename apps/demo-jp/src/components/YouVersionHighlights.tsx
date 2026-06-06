// Spec 265 W4 — the relying-app (JP) display of a connected member's YouVersion highlights. JP presents
// the person→JP site grant; demo-a2a verifies it + the person's data-scope, uses the KMS-custodied token
// server-side, and returns ONLY the data. JP never sees the YouVersion token.
import { useState } from 'react';
import type { DelegationWire } from '../lib/delegation';
import { readYouVersion } from '../lib/youversion-client';
import { Card, SectionHead, Btn, Banner } from './ui';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function YouVersionHighlights({ grant }: { grant: DelegationWire }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [msg, setMsg] = useState('');

  async function load() {
    setPhase('loading');
    setMsg('');
    try {
      setItems(await readYouVersion('highlights', grant));
      setPhase('done');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(
        m === 'no_youversion_link'
          ? 'No YouVersion account is linked to your Impact home yet — sign in with YouVersion there first.'
          : m.startsWith('scope_not_granted')
            ? 'JP isn’t allowed to read your highlights yet. Approve “Highlights” for JP in your Impact home → Connected Apps.'
            : `Couldn’t load highlights: ${m}`,
      );
      setPhase('error');
    }
  }

  return (
    <Card>
      <SectionHead
        eyebrow="YouVersion"
        title="Your highlights"
        sub="Read live from YouVersion through your Impact home — JP never sees your YouVersion token, only what you grant."
      />
      {phase === 'idle' && <Btn onClick={load}>Show my highlights</Btn>}
      {phase === 'loading' && <Banner tone="ok">Reading from YouVersion…</Banner>}
      {phase === 'error' && (
        <>
          <Banner tone="warn">{msg}</Banner>
          <div style={{ marginTop: '.6rem' }}><Btn onClick={load}>Try again</Btn></div>
        </>
      )}
      {phase === 'done' && (
        items.length === 0 ? (
          <Banner tone="ok">No highlights found in your YouVersion account.</Banner>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.88rem', lineHeight: 1.7 }}>
            {items.slice(0, 25).map((h, i) => (
              <li key={(h.id as string) ?? i}>
                {(h.reference as string) ?? (h.usfm as string) ?? (h.passage_id as string) ?? JSON.stringify(h)}
                {h.color ? <span style={{ opacity: 0.6 }}> · {String(h.color)}</span> : null}
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
  );
}
