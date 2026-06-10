#!/usr/bin/env tsx
/**
 * check:audit-freshness — keep the security finding ledger honest against source.
 *
 * `docs/audits/findings.yaml` is the single source of truth for first-class
 * security findings (see its header). This gate fails CI when the ledger drifts
 * from the code:
 *
 *   1. every `concerns:` path must exist
 *   2. a `closed` finding's `anchor` string must appear in at least one of its
 *      `concerns` files  → "closed" cannot be claimed without the fix being in source
 *   3. each finding has the required fields, with severity/status from the vocab
 *
 * Intentionally dependency-free: a small block parser reads the controlled
 * findings.yaml schema (no YAML lib). Run: `pnpm check:audit-freshness`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const LEDGER = join(REPO_ROOT, 'docs', 'audits', 'findings.yaml');

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const STATUSES = new Set(['closed', 'open', 'accepted-risk', 'deferred']);
const REQUIRED = ['id', 'severity', 'title', 'status', 'concerns', 'origin'] as const;

interface Finding {
  id?: string;
  severity?: string;
  title?: string;
  status?: string;
  concerns?: string[];
  anchor?: string;
  tests?: string[];
  origin?: string;
  _line: number;
}

/** Minimal parser for the fixed findings.yaml schema: a `findings:` list of
 *  `- id:`-led blocks with scalar `key: value` fields and `key:` + `  - item`
 *  list fields. Block scalars (`>` / `|`) are collapsed to a marker (unused here). */
function parseFindings(src: string): Finding[] {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^findings:\s*$/.test(l));
  if (start < 0) throw new Error('findings.yaml: missing top-level `findings:` list');

  const out: Finding[] = [];
  let cur: Finding | null = null;
  let listKey: keyof Finding | null = null;
  let inBlockScalar = false;

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (/^\S/.test(raw)) break; // dedent to column 0 ends the findings list
    const line = raw.replace(/\s+$/, '');
    if (line === '') continue;

    const item = line.match(/^      - (.*)$/); // 6-space list item (under a key)
    const newFinding = line.match(/^  - id:\s*(.*)$/); // 2-space `- id:` starts a finding
    const scalar = line.match(/^    (\w+):\s?(.*)$/); // 4-space `key: value` or `key:`

    if (newFinding) {
      if (cur) out.push(cur);
      cur = { id: newFinding[1]!.trim(), _line: i + 1 };
      listKey = null;
      inBlockScalar = false;
      continue;
    }
    if (!cur) continue;
    if (item && listKey) {
      (cur[listKey] as string[]).push(item[1]!.trim());
      continue;
    }
    if (scalar) {
      const key = scalar[1] as keyof Finding;
      const val = scalar[2] ?? '';
      inBlockScalar = false;
      if (key === 'concerns' || key === 'tests') {
        if (val.startsWith('[') && val.endsWith(']')) {
          // inline flow list: `concerns: [a, b]`
          cur[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
          listKey = null;
        } else {
          cur[key] = [] as string[]; // block list: `concerns:` then `- item` lines
          listKey = key;
        }
      } else if (val === '>' || val === '|') {
        inBlockScalar = true; // multi-line note — we don't need its text
        listKey = null;
      } else {
        (cur as Record<string, unknown>)[key as string] = val.replace(/^['"]|['"]$/g, '');
        listKey = null;
      }
      continue;
    }
    // continuation line of a block scalar / wrapped value — ignore
    if (inBlockScalar) continue;
  }
  if (cur) out.push(cur);
  return out;
}

function main(): void {
  if (!existsSync(LEDGER)) {
    console.error(`✗ check:audit-freshness — ${LEDGER} not found`);
    process.exit(1);
  }
  const findings = parseFindings(readFileSync(LEDGER, 'utf8'));
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const f of findings) {
    const where = `findings.yaml:${f._line} [${f.id ?? '?'}]`;
    for (const k of REQUIRED) {
      if (f[k] === undefined || (Array.isArray(f[k]) && (f[k] as unknown[]).length === 0)) {
        errors.push(`${where}: missing required field "${k}"`);
      }
    }
    if (f.id) {
      if (ids.has(f.id)) errors.push(`${where}: duplicate id`);
      ids.add(f.id);
    }
    if (f.severity && !SEVERITIES.has(f.severity)) errors.push(`${where}: bad severity "${f.severity}"`);
    if (f.status && !STATUSES.has(f.status)) errors.push(`${where}: bad status "${f.status}"`);

    for (const p of f.concerns ?? []) {
      if (!existsSync(join(REPO_ROOT, p))) errors.push(`${where}: concerns path does not exist: ${p}`);
    }
    for (const t of f.tests ?? []) {
      if (!existsSync(join(REPO_ROOT, t))) errors.push(`${where}: tests path does not exist: ${t}`);
    }

    // A "closed" finding must prove the fix is in source: its anchor must appear
    // in at least one concerns file. (accepted-risk anchors are validated the same
    // way — the demo hole must still be present where we say it is.)
    if ((f.status === 'closed' || f.status === 'accepted-risk')) {
      if (!f.anchor) {
        errors.push(`${where}: status=${f.status} requires an "anchor" (a string proving it in source)`);
      } else {
        const found = (f.concerns ?? []).some((p) => {
          const fp = join(REPO_ROOT, p);
          return existsSync(fp) && readFileSync(fp, 'utf8').includes(f.anchor!);
        });
        if (!found) {
          errors.push(`${where}: anchor "${f.anchor}" not found in any concerns file — "${f.status}" may be stale`);
        }
      }
    }
  }

  if (errors.length) {
    console.error(`✗ check:audit-freshness FAILED — ${errors.length} issue(s) across ${findings.length} findings:\n`);
    for (const e of errors) console.error(`  ${e}`);
    console.error('\nThe finding ledger (docs/audits/findings.yaml) drifted from source. Update it.');
    process.exit(1);
  }
  const byStatus = (s: string) => findings.filter((f) => f.status === s).length;
  console.log(
    `✓ check:audit-freshness passed (${findings.length} findings: ` +
      `${byStatus('closed')} closed, ${byStatus('open')} open, ` +
      `${byStatus('accepted-risk')} accepted-risk, ${byStatus('deferred')} deferred — all anchors resolve).`,
  );
}

main();
