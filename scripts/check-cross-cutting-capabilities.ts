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

// Parse the table — rows look like:
//   | **Capability** | [spec](path) | [demo](path) | `pkg1`, `pkg2` | status |
// The header + separator rows are skipped (they don't contain links).
const rows: CapabilityRow[] = [];
const rowLine = /^\|\s*\*\*([^*]+)\*\*\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*([^|]+)\|\s*[^|]+\|\s*$/;

for (const line of indexText.split('\n')) {
  const m = rowLine.exec(line.trim());
  if (!m) continue;
  const [, name, specRel, demoRel, pkgsStr] = m;
  // The index uses relative paths from `docs/architecture/`. Resolve.
  const indexDir = path.dirname(INDEX_PATH);
  const specPath = path.resolve(indexDir, specRel);
  const demoGuidePath = path.resolve(indexDir, demoRel);
  // pkgsStr is `agent-account, delegation, tool-policy, audit, mcp-runtime`
  // (the leading/trailing whitespace + ` markers are tolerated).
  const participatingPackages = pkgsStr
    .replace(/`/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  rows.push({ name, specPath, demoGuidePath, participatingPackages });
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
  // 1. Spec exists
  if (!existsSync(row.specPath)) {
    issues(row.name, `spec missing: ${path.relative(REPO_ROOT, row.specPath)}`);
  }

  // 2. Demo guide exists
  if (!existsSync(row.demoGuidePath)) {
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
    // Look for the "Capabilities this package participates in" section
    // AND a reference to this capability's name within ~the next section.
    const sectionRe = /##\s+Capabilities this package participates in([\s\S]*?)(?:\n##\s|$)/;
    const sectionMatch = sectionRe.exec(claudeText);
    if (!sectionMatch) {
      issues(
        row.name,
        `participating package ${pkg} CLAUDE.md missing "## Capabilities this package participates in" section`,
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
