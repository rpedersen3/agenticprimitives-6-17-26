// Pattern-A Switchboard read bridge — the BROKER's import surface (Jane runs it). Shows the external
// Switchboard Role postings, previews the ETL (skills/region mapped vs. unmapped against the shared
// taxonomy), and imports them as gc:Needs that flow onto the match board + public signal. Read-only:
// Switchboard stays the system of record; we never write back.

import { useEffect, useMemo, useState } from 'react';
import { SWITCHBOARD_ROLES } from '../data/switchboard-roles';
import { importSwitchboardRoles, mapRoles, skillLabels } from '../lib/switchboard-bridge';
import { regionByUri } from '../data/taxonomy';
import { loadBridgedNeeds } from '../lib/store';
import { Banner, Btn, Card, Pill, SectionHead } from './ui';
import { useToast } from './Toast';

export function SwitchboardBridgePanel() {
  // Stable preview (no time dependency) so the mapping render is deterministic.
  const preview = useMemo(() => mapRoles(SWITCHBOARD_ROLES, 'preview'), []);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  // The currently-bridged set lives in Jane's vault (gs:broker:bridge).
  useEffect(() => {
    let cancelled = false;
    void loadBridgedNeeds().then((ns) => { if (!cancelled) setImportedIds(new Set(ns.map((n) => n.id))); }).catch(() => {});
    return () => { cancelled = true; };
  }, [done]);

  const totalSkills = preview.results.reduce((n, r) => n + r.mappedSkills.length + r.unmappedSkills.length, 0);
  const mappedSkills = totalSkills - preview.totalUnmappedSkills;
  const allImported = preview.results.every((r) => importedIds.has(r.need.id));

  async function runImport() {
    setBusy(true); setErr(null);
    try {
      const res = await importSwitchboardRoles(SWITCHBOARD_ROLES);
      setDone(res.imported);
      toast(`Imported ${res.imported} role${res.imported === 1 ? '' : 's'} as needs`, 'ok');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m); toast(m, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ borderColor: 'var(--c-accent-border)', background: 'var(--c-accent-subtle)' }}>
      <SectionHead
        eyebrow="Pattern-A · read bridge"
        title="Import demand from Global Switchboard"
        sub="Switchboard publishes open Roles; this bridge translates them into Needs against the shared 22-category / 193-skill taxonomy, so external demand scores against KC Offerings by concept identity. Read-only — Switchboard stays the system of record; we never write back."
      />

      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
        <Pill tone="ok">{preview.imported} roles</Pill>
        <Pill tone="ok">{mappedSkills}/{totalSkills} skills mapped</Pill>
        {preview.totalUnmappedSkills > 0 && <Pill tone="warn">{preview.totalUnmappedSkills} skill(s) unmapped</Pill>}
        {preview.totalUnmappedRegions > 0 && <Pill tone="warn">{preview.totalUnmappedRegions} region(s) unmapped</Pill>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {preview.results.map((r) => {
          const already = importedIds.has(r.need.id);
          const regionLabel = r.region ? regionByUri(r.region.uri)?.label ?? r.region.label : undefined;
          return (
            <div key={r.need.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 10, padding: '.7rem .85rem', background: '#fff' }}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '.9rem' }}>{r.need.title}</strong>
                {already && <Pill tone="live">imported</Pill>}
                {r.need.visibility === 'confidential' && <Pill tone="warn">sensitive region · coarsened</Pill>}
              </div>
              <div style={{ fontSize: '.74rem', color: 'var(--c-g500)', marginTop: '.15rem' }}>
                {r.need.provenance?.sourceLabel} · {r.need.needKind} · <a href={r.need.provenance?.sourceUri} target="_blank" rel="noreferrer" style={{ color: 'var(--c-accent)' }}>{r.need.provenance?.sourceUri}</a>
              </div>
              <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.5rem', alignItems: 'center' }}>
                {skillLabels(r.mappedSkills).map((l) => <Pill key={l} tone="ok">{l}</Pill>)}
                {r.unmappedSkills.map((s) => <Pill key={s} tone="warn">⚠ {s} (no concept)</Pill>)}
                {regionLabel && <Pill tone="neutral">📍 {regionLabel}</Pill>}
                {r.unmappedRegion && <Pill tone="warn">⚠ region {r.unmappedRegion}</Pill>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn onClick={runImport} busy={busy}>{allImported && done === null ? 'Re-import roles as Needs' : `Import ${preview.imported} roles as Needs`}</Btn>
        {done !== null && <Banner tone="ok">Imported {done} Switchboard role(s) as Needs — they now appear on the match board + public signal. Unmapped skills are recorded on each Need&rsquo;s provenance, not dropped.</Banner>}
        {err && <Banner tone="err">{err}</Banner>}
      </div>
      <p style={{ fontSize: '.72rem', color: 'var(--c-g500)', marginTop: '.6rem' }}>
        Bridged Needs are owned by a bridge-scoped pseudo-agent (no real Smart Account) and tagged
        <code style={{ background: 'var(--c-g100)', padding: '0 .3rem', borderRadius: 4, margin: '0 .2rem' }}>provenance.source = switchboard-bridge</code>
        so they&rsquo;re never confused with locally-authored GCO Needs.
      </p>
    </Card>
  );
}
