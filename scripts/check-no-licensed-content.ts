/**
 * check-no-licensed-content.ts
 *
 * Enforces ADR-0033 R1: the verifiable-content substrate and its scripture
 * verticals must never reference or embed any copyrighted translation. Only
 * public-domain editions (BSB / KJV / WEB / ASV) may appear as data.
 *
 * Scope: packages/content-primitives/src + domains/scripture-content-extension/src.
 * (The scripture demo apps live in their own example repo, verifiable-content-demo,
 * which carries its own copy of this gate.) Other AP apps that integrate
 * third-party Bible APIs are out of scope. Specs + docs are not scanned: they
 * NAME editions to DEFINE the rule.
 *
 * High-precision detection: copyrighted acronyms as case-sensitive standalone
 * words (no ambiguous short tokens), plus full edition names case-insensitive.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');

const ACRONYMS = /\b(NIV|ESV|NASB|NLT|NKJV|NRSV|HCSB|NIrV|TNIV|NABRE)\b/;
const FULL_NAMES = /new international version|english standard version|new american standard|new living translation|new king james|new revised standard|christian standard bible|amplified bible|holman christian standard/i;

const SKIP_DIRS = new Set(['dist', 'node_modules', 'coverage', '.wrangler', '.next']);
const FILE_RE = /\.(ts|tsx|js|jsx|json)$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (FILE_RE.test(entry) && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function scanRoots(): string[] {
  const roots: string[] = [];
  // The substrate core (packages/) + the scripture vertical (domains/ tier).
  const core = join(ROOT, 'packages', 'content-primitives', 'src');
  if (existsSync(core)) roots.push(core);
  const dom = join(ROOT, 'domains', 'scripture-content-extension', 'src');
  if (existsSync(dom)) roots.push(dom);
  return roots;
}

const findings: string[] = [];
for (const src of scanRoots()) {
  for (const file of sourceFiles(src)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const hit = ACRONYMS.exec(line) ?? FULL_NAMES.exec(line);
      if (hit) {
        const where = file.replace(ROOT + '/', '') + ':' + (i + 1);
        findings.push('  ' + where + '  [licensed edition: ' + hit[0] + ']');
      }
    }
  }
}

if (findings.length > 0) {
  console.error('FAIL check:no-licensed-content - a copyrighted translation leaked into the substrate (ADR-0033 R1):');
  console.error(findings.join('\n'));
  console.error('Ship public-domain editions only (BSB/KJV/WEB/ASV); rights holders publish their own signed manifests. See ADR-0033.');
  process.exit(1);
}
console.log('OK check:no-licensed-content - no copyrighted translations in the substrate.');
