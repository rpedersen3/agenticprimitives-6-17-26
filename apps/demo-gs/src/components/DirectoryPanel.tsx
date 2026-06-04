// Directory / search — the browsable PUBLIC read surface over Needs + Offerings. Search by text;
// filter by skill category / region / cause. Privacy tiers are enforced in the projection
// (lib/directory.ts): confidential anchors are coarsened, sensitive entries are absent, contact is
// never shown. `scope` limits it to demand (needs), supply (offerings), or both.

import { useMemo, useState } from 'react';
import type { ExpertOffering, GcoNeedIntent, Uri } from '../domain/gs-types';
import { buildDirectory, directoryFacets, searchDirectory, type DirEntry } from '../lib/directory';
import { Card, Chip, Pill, SectionHead, TextField } from './ui';

type Scope = 'all' | 'need' | 'offering';

// Two entry sources, both ALREADY privacy-projected:
//   • Jane (broker, entitled): pass raw `needs`/`offerings` — we build the projection here.
//   • A member (kc/gco): pass `entries` — the store already coarsened them to the public tier so the
//     member never receives raw confidential data even in memory.
export function DirectoryPanel({ needs, offerings, entries, scope = 'all', eyebrow, title, sub }: {
  needs?: GcoNeedIntent[];
  offerings?: ExpertOffering[];
  entries?: DirEntry[];
  scope?: Scope;
  eyebrow?: string;
  title?: string;
  sub?: string;
}) {
  const all = useMemo(() => {
    const built = entries ?? buildDirectory(needs ?? [], offerings ?? []);
    return scope === 'all' ? built : built.filter((e) => e.kind === scope);
  }, [needs, offerings, entries, scope]);

  const [text, setText] = useState('');
  const [kind, setKind] = useState<Scope>('all');
  const [categoryUri, setCategoryUri] = useState<Uri | undefined>();
  const [regionUri, setRegionUri] = useState<Uri | undefined>();
  const [cause, setCause] = useState<string | undefined>();

  const facets = useMemo(() => directoryFacets(all), [all]);
  const results = useMemo(
    () => searchDirectory(all, { text, kind: scope === 'all' ? kind : scope, categoryUri, regionUri, cause }),
    [all, text, kind, scope, categoryUri, regionUri, cause],
  );
  const active = !!(text || categoryUri || regionUri || cause || (scope === 'all' && kind !== 'all'));
  const clear = () => { setText(''); setKind('all'); setCategoryUri(undefined); setRegionUri(undefined); setCause(undefined); };

  return (
    <Card>
      <SectionHead
        eyebrow={eyebrow ?? 'Public read surface · directory'}
        title={title ?? 'Search the directory'}
        sub={sub ?? 'The public projection of open needs + active offerings — what the ecosystem can browse. Confidential anchors are coarsened, sensitive regions collapsed, contact withheld until a connection is accepted.'}
      />

      <div style={{ marginBottom: '.7rem' }}>
        <TextField
          value={text} placeholder="Search skills, causes, organizations…" mono onChange={setText}
          style={{ padding: '.65rem .85rem', fontSize: '.92rem', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '.85rem' }}>
        {scope === 'all' && (
          <FacetRow label="Type">
            <Chip active={kind === 'need'} onClick={() => setKind(kind === 'need' ? 'all' : 'need')}>Needs (demand)</Chip>
            <Chip active={kind === 'offering'} onClick={() => setKind(kind === 'offering' ? 'all' : 'offering')}>Offerings (supply)</Chip>
          </FacetRow>
        )}
        {facets.categories.length > 0 && (
          <FacetRow label="Skill category">
            {facets.categories.map((c) => (
              <Chip key={c.uri} active={categoryUri === c.uri} onClick={() => setCategoryUri(categoryUri === c.uri ? undefined : c.uri)}>{c.label} · {c.n}</Chip>
            ))}
          </FacetRow>
        )}
        {facets.regions.length > 0 && (
          <FacetRow label="Region">
            {facets.regions.map((r) => (
              <Chip key={r.uri} active={regionUri === r.uri} tone={r.uri === 'sensitive' ? 'accent' : 'neutral'} onClick={() => setRegionUri(regionUri === r.uri ? undefined : r.uri)}>{r.label} · {r.n}</Chip>
            ))}
          </FacetRow>
        )}
        {facets.causes.length > 0 && (
          <FacetRow label="Cause">
            {facets.causes.map((c) => (
              <Chip key={c.label} active={cause === c.label} onClick={() => setCause(cause === c.label ? undefined : c.label)}>{c.label} · {c.n}</Chip>
            ))}
          </FacetRow>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.6rem' }}>
        <strong style={{ fontSize: '.82rem', color: 'var(--c-g600)' }}>{results.length} result{results.length === 1 ? '' : 's'}</strong>
        {active && <button onClick={clear} style={{ fontSize: '.76rem', color: 'var(--c-primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>clear filters</button>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
        {results.length === 0 && <p style={{ fontSize: '.85rem', color: 'var(--c-g500)' }}>Nothing matches those filters.</p>}
        {results.map((e) => <EntryCard key={e.id} e={e} />)}
      </div>
    </Card>
  );
}

function EntryCard({ e }: { e: DirEntry }) {
  const head = e.kind === 'need' ? e.title : (e.headline ?? 'Expertise offering');
  return (
    <div style={{ border: '1px solid var(--c-g200)', borderRadius: 10, padding: '.65rem .85rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Pill tone={e.kind === 'need' ? 'warn' : 'live'}>{e.kind === 'need' ? `need · ${e.needKind}` : 'offering'}</Pill>
        <strong style={{ fontSize: '.9rem', flex: 1 }}>{head}</strong>
        {e.kind === 'need' && e.bridged && <Pill tone="neutral">via Switchboard</Pill>}
        {e.kind === 'need' && e.confidential && <Pill tone="warn">confidential · details on connection</Pill>}
        {e.kind === 'offering' && e.availability && <Pill tone="ok">{e.availability}</Pill>}
      </div>
      <div style={{ fontSize: '.76rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>{e.ownerLabel}</div>
      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
        {e.skills.map((s) => <Pill key={s.uri} tone="ok">{s.label}</Pill>)}
        {e.regions.map((r) => (
          <span key={r.uri} style={{ fontSize: '.74rem', padding: '.1rem .5rem', borderRadius: 999, border: '1px solid', borderColor: r.coarsened ? 'var(--c-accent-border)' : 'var(--c-g200)', color: r.coarsened ? 'var(--c-accent)' : 'var(--c-g500)', background: r.coarsened ? 'var(--c-accent-subtle)' : 'transparent' }}>
            📍 {r.label}
          </span>
        ))}
        {e.causes.map((c) => <span key={c} style={{ fontSize: '.74rem', color: 'var(--c-g400)' }}>{c}</span>)}
      </div>
      {(e.languages.length > 0 || (e.kind === 'need' && e.commitmentLabel)) && (
        <div style={{ fontSize: '.72rem', color: 'var(--c-g400)', marginTop: '.4rem' }}>
          {e.kind === 'need' && e.commitmentLabel ? `${e.commitmentLabel} · ` : ''}{e.languages.join(', ')}
        </div>
      )}
    </div>
  );
}

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--c-g400)', fontWeight: 700, minWidth: 96 }}>{label}</span>
      {children}
    </div>
  );
}
