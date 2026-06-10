#!/usr/bin/env tsx
/**
 * check:no-passwithnotests-primary — keep the primary package test gate honest.
 *
 * P1-2 (external production-readiness audit, 2026-06-10): `vitest run --passWithNoTests`
 * exits 0 even when ZERO tests are collected. On a package's PRIMARY `test` script —
 * the gate `check:<pkg>` / CI runs — that silently greens a package whose tests stopped
 * being discovered (renamed dir, broken glob, deleted suite). For authority-bearing
 * packages that is exactly how a regression ships unnoticed.
 *
 * Rule: a package's `scripts.test` (under packages/) MUST NOT contain `--passWithNoTests`.
 * Scoped runners (`test:unit`, `test:integration`) MAY keep it — those legitimately
 * target optional sub-scopes that can be empty. This guard only polices the primary gate.
 *
 * Dependency-free; run: `pnpm check:no-passwithnotests-primary`.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const PKGS = join(REPO_ROOT, 'packages');

function main(): void {
  const offenders: string[] = [];
  for (const name of readdirSync(PKGS)) {
    const pj = join(PKGS, name, 'package.json');
    if (!existsSync(pj)) continue;
    let json: { scripts?: Record<string, string> };
    try {
      json = JSON.parse(readFileSync(pj, 'utf8'));
    } catch {
      offenders.push(`packages/${name}/package.json: not valid JSON`);
      continue;
    }
    const primary = json.scripts?.test;
    if (primary && primary.includes('--passWithNoTests')) {
      offenders.push(
        `packages/${name}/package.json: primary "test" script uses --passWithNoTests ` +
          `("${primary}") — the gate would pass with zero tests. Remove it (scoped test:unit / ` +
          `test:integration may keep it).`,
      );
    }
  }

  if (offenders.length) {
    console.error(`✗ check:no-passwithnotests-primary FAILED — ${offenders.length} package(s):\n`);
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }
  console.log('✓ check:no-passwithnotests-primary passed — no primary package test gate masks zero tests.');
}

main();
