#!/usr/bin/env tsx
/**
 * check:audit-stub-drift — a per-package AUDIT.md must not claim "STUB" over shipped code.
 *
 * Closes finding ARCH-1: seven AUDIT.md files said "Status: STUB. No code yet" while
 * their `src/` shipped security-load-bearing code (e.g. verifiable-credentials' live
 * `verifyCredential` ERC-1271 verifier), which actively misleads a reviewer into
 * skipping audited surface. This guard fails CI when an AUDIT.md still says STUB while
 * its package has a non-trivial `src/`.
 *
 * "STUB" marker:    an AUDIT.md `Status:` line (or body) containing the word STUB.
 * "non-trivial":    more than STUB_LINE_BUDGET non-blank, non-comment lines of TypeScript
 *                   under src/ (excluding d.ts). A genuinely-empty scaffold stays valid.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const STUB_LINE_BUDGET = 25; // above this, "STUB. No code yet" is a lie

function listAuditMd(): string[] {
  const out: string[] = [];
  for (const base of ['packages', 'apps']) {
    const dir = join(REPO_ROOT, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const md = join(dir, name, 'AUDIT.md');
      if (existsSync(md)) out.push(md);
    }
  }
  return out;
}

function srcCodeLines(pkgDir: string): number {
  const srcDir = join(pkgDir, 'src');
  if (!existsSync(srcDir)) return 0;
  let n = 0;
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
      let block = false;
      for (const raw of readFileSync(p, 'utf8').split('\n')) {
        const l = raw.trim();
        if (l === '') continue;
        if (block) { if (l.includes('*/')) block = false; continue; }
        if (l.startsWith('//')) continue;
        if (l.startsWith('/*')) { if (!l.includes('*/')) block = true; continue; }
        if (l.startsWith('*')) continue;
        n++;
      }
    }
  };
  walk(srcDir);
  return n;
}

function saysStub(md: string): boolean {
  // a Status line, or any body line, that asserts STUB / "no code yet"
  return /^.*\bStatus:.*\bSTUB\b/im.test(md) || /\bSTUB\b[^\n]*\bno code\b/i.test(md);
}

function main(): void {
  const offenders: string[] = [];
  let scanned = 0;
  for (const md of listAuditMd()) {
    scanned++;
    const text = readFileSync(md, 'utf8');
    if (!saysStub(text)) continue;
    const lines = srcCodeLines(dirname(md));
    if (lines > STUB_LINE_BUDGET) {
      offenders.push(`${md.replace(REPO_ROOT + '/', '')} — says STUB but src/ has ${lines} code lines`);
    }
  }
  if (offenders.length) {
    console.error(`✗ check:audit-stub-drift FAILED — ${offenders.length} AUDIT.md claim STUB over shipped code (ARCH-1):\n`);
    for (const o of offenders) console.error(`  ${o}`);
    console.error('\nUpdate the AUDIT.md to reflect the shipped code (Status + Findings + test posture).');
    process.exit(1);
  }
  console.log(`✓ check:audit-stub-drift passed (${scanned} AUDIT.md scanned; no STUB-over-code drift).`);
}

main();
