/**
 * check-cross-cutting-capabilities.ts
 *
 * CI rail enforcing the cross-cutting capability documentation pattern.
 *
 * For every capability listed in docs/architecture/cross-cutting-capabilities.md,
 * verify that all four artifacts exist:
 *
 *   1. specs/2XX-<capability>.md             (spec)
 *   2. apps/<demo>/docs/<capability>/guide.md (demo guide)
 *   3. docs/architecture/cross-cutting-capabilities.md row (index)
 *   4. Each participating package's CLAUDE.md "Capabilities this package
 *      participates in" section names the capability
 *
 * Fails CI if any of those is missing or any link path doesn't resolve.
 * Makes the pattern load-bearing — doc drift becomes a build error.
 *
 * Wired into pnpm check:all so every PR runs it. The script is
 * deliberately strict about path shape; loosening it requires updating
 * this file too, which keeps the doctrine visible.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'docs/architecture/cross-cutting-capabilities.md');

interface CapabilityRow {
  name: string;
  specPath: string;
  demoGuidePath: string;
  participatingPackages: string[];
}

interface Finding {
  capability: string;
  detail: string;
}

const findings: Finding[] = [];
const issues = (capability: string, detail: string): void => {
  findings.push({ capability, detail });
};

if (!existsSync(INDEX_PATH)) {
  console.error(`[cross-cutting] FATAL: index missing at ${INDEX_PATH}`);
  process.exit(2);
}

const indexText = readFileSync(INDEX_PATH, 'utf8');

// Expected number of capability rows. A row-count sentinel: if a row
// stops parsing (cell shape drifts), this fails LOUDLY instead of the
// old failure mode where rows were silently skipped and CI stayed green
// while only a subset was checked (audit AUD-06).
const EXPECTED_ROWS = 3;

// Parse the table by splitting each `| **Name** | … |` row on `|`
// (table cells never contain a literal pipe). Cells may hold MULTIPLE
// links + prose — e.g. the multi-sig row cites specs 207/209/213, and an
// in-flight row's demo cell is "TBD — …" with no link. We extract the
// FIRST [text](path) link from the spec + demo cells; a demo cell with
// no link means the guide is planned (skip its existence check).
const firstLink = (cell: string): string | null => {
  const m = /\[[^\]]+\]\(([^)]+)\)/.exec(cell);
  return m ? m[1]!.trim() : null;
};

interface ParsedRow extends Omit<CapabilityRow, 'demoGuidePath'> {
  demoGuidePath: string | null;
}
const rows: ParsedRow[] = [];
const indexDir = path.dirname(INDEX_PATH);

for (const rawLine of indexText.split('\n')) {
  const line = rawLine.trim();
  if (!/^\|\s*\*\*/.test(line)) continue; // only **Name**-led capability rows
  const cells = line.split('|').map((c) => c.trim());
  // ['', '**Name**', specCell, demoCell, pkgsCell, statusCell, '']
  if (cells.length < 7) continue;
  const name = cells[1]!.replace(/\*\*/g, '').trim();
  const specRel = firstLink(cells[2]!);
  const demoRel = firstLink(cells[3]!);
  // Strip backticks + parenthetical annotations (e.g. "tool-policy (T3+ …)"),
  // then keep only package-name tokens. Listed packages are validated
  // strictly below — a stale/renamed name (e.g. `custody` after the rename)
  // must FAIL, not be silently dropped, so we do NOT existence-filter here.
  const participatingPackages = cells[4]!
    .replace(/`/g, '')
    .replace(/\([^)]*\)/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z][a-z0-9-]+$/.test(s));
  if (!specRel) issues(name, 'spec cell has no resolvable [text](path) link');
  rows.push({
    name,
    specPath: specRel ? path.resolve(indexDir, specRel) : '',
    demoGuidePath: demoRel ? path.resolve(indexDir, demoRel) : null,
    participatingPackages,
  });
}

if (rows.length !== EXPECTED_ROWS) {
  issues(
    'index',
    `parsed ${rows.length} capability row(s) but expected ${EXPECTED_ROWS}. ` +
      'A row stopped matching (cell shape drifted) or a row was added/removed — ' +
      'update EXPECTED_ROWS in this script and confirm every row is intended.',
  );
}

if (rows.length === 0) {
  console.error(`[cross-cutting] FATAL: parsed 0 capability rows from ${INDEX_PATH}.`);
  console.error('  Either the index is empty (then nothing to check — exit 0)');
  console.error('  or the table format has changed and the row regex needs updating.');
  // If the table is intentionally empty, exit 0 quietly. If it's not but we
  // got 0 rows, that's a parse failure — but distinguishing those would
  // require a sentinel. For now: require at least 1 row OR a "<!-- empty -->"
  // marker. The current repo has multi-sig + audit so this branch shouldn't
  // hit in practice.
  if (indexText.includes('<!-- intentionally empty -->')) {
    process.exit(0);
  }
  process.exit(2);
}

console.log(`[cross-cutting] checking ${rows.length} capability row(s)`);

for (const row of rows) {
  // 1. Spec exists (the no-link case is already reported in the parser).
  if (row.specPath && !existsSync(row.specPath)) {
    issues(row.name, `spec missing: ${path.relative(REPO_ROOT, row.specPath)}`);
  }

  // 2. Demo guide exists — only when the cell links one. A "TBD" cell
  //    means the guide is planned for an in-flight capability; skip.
  if (row.demoGuidePath && !existsSync(row.demoGuidePath)) {
    issues(row.name, `demo guide missing: ${path.relative(REPO_ROOT, row.demoGuidePath)}`);
  }

  // 3. Each participating package has a CLAUDE.md that names this capability
  for (const pkg of row.participatingPackages) {
    const claudeMd = path.join(REPO_ROOT, `packages/${pkg}/CLAUDE.md`);
    if (!existsSync(claudeMd)) {
      issues(row.name, `participating package ${pkg} has no CLAUDE.md at ${path.relative(REPO_ROOT, claudeMd)}`);
      continue;
    }
    const claudeText = readFileSync(claudeMd, 'utf8');
    // Look for a Capabilities section AND a reference to this capability's
    // name within it. Tolerate the two header variants in use today:
    // "## Capabilities this package participates in" and
    // "## Capabilities (cross-cutting)".
    const sectionRe = /##\s+Capabilities[^\n]*\n([\s\S]*?)(?:\n##\s|$)/;
    const sectionMatch = sectionRe.exec(claudeText);
    if (!sectionMatch) {
      issues(
        row.name,
        `participating package ${pkg} CLAUDE.md missing a "## Capabilities …" section`,
      );
      continue;
    }
    // The capability name match is loose — substring of the row name (a
    // shorter rendition like "Multi-sig" works for "Multi-sig + threshold policy").
    const shortName = row.name.split(/[+/(]/)[0]!.trim();
    if (!sectionMatch[1]!.includes(shortName)) {
      issues(
        row.name,
        `participating package ${pkg} CLAUDE.md "Capabilities" section doesn't mention "${shortName}"`,
      );
    }
  }
}

console.log('');

if (findings.length === 0) {
  console.log(`[cross-cutting] ✓ all capabilities have all four artifacts wired`);
  process.exit(0);
}

console.error(`[cross-cutting] ✗ FAILED: ${findings.length} issue(s)`);
const byCapability = new Map<string, string[]>();
for (const f of findings) {
  if (!byCapability.has(f.capability)) byCapability.set(f.capability, []);
  byCapability.get(f.capability)!.push(f.detail);
}
for (const [cap, details] of byCapability) {
  console.error(`\n  ${cap}:`);
  for (const d of details) console.error(`    - ${d}`);
}
console.error(
  '\nFix paths:\n' +
    '  - Spec / guide missing: add the file at the path the index references.\n' +
    '  - Package CLAUDE.md missing section: add a `## Capabilities this package participates in` section + a bulleted link to the spec + demo guide.\n' +
    '  - Index row malformed: see the table shape in docs/architecture/cross-cutting-capabilities.md.\n',
);
process.exit(1);
