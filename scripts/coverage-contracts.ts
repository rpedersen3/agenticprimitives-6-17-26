#!/usr/bin/env tsx
/**
 * coverage-contracts.ts — R6.9 per-contract coverage aggregator.
 *
 * R6.1 recon § 3.1 identified that `forge coverage --ir-minimum
 * --report summary` produces a SUMMARY TABLE that silently SKIPS
 * security-critical contracts (AgentAccount, AgentAccountFactory,
 * SmartAgentPaymaster, UniversalSignatureValidator, DelegationManager,
 * CustodyPolicy, the 5 enforcers) — they're missing from the table
 * entirely.
 *
 * R6.9 finding: **the LCOV report (`--report lcov`) DOES include
 * those contracts.** Only the summary-table rendering hides them.
 *
 * This script:
 *   1. Runs `forge coverage --ir-minimum --report lcov` (writes
 *      `packages/contracts/lcov.info`).
 *   2. Parses every `SF:` record under `src/**`.
 *   3. Computes line%, branch%, function% per contract.
 *   4. Emits a per-contract JSON to
 *      `packages/contracts/coverage-r6-9.json` for CI consumption.
 *   5. Prints a markdown summary table to stdout.
 *   6. Exits non-zero if any tracked critical contract is below
 *      its R6.10 push target (after R6.10 lands, this gate ratchets).
 *
 * The script is INFORMATIONAL today — it does not fail CI on
 * critical-contract gaps because R6.10 hasn't run yet. The summary
 * is intended as evidence for an external auditor's review of the
 * test pack.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const CONTRACTS_DIR = join(REPO_ROOT, 'packages/contracts');
const LCOV_PATH = join(CONTRACTS_DIR, 'lcov.info');
const OUTPUT_JSON = join(CONTRACTS_DIR, 'coverage-r6-9.json');

if (!existsSync(CONTRACTS_DIR)) {
  console.error(`[coverage-contracts] expected ${CONTRACTS_DIR} to exist; run from repo root.`);
  process.exit(2);
}

// ─── 1. Run forge coverage (or skip if --no-run is passed) ────────────
const skipRun = process.argv.includes('--no-run');
if (!skipRun) {
  console.log('[coverage-contracts] running `forge coverage --ir-minimum --report lcov` (~2 min)…');
  const result = spawnSync('forge', ['coverage', '--ir-minimum', '--report', 'lcov'], {
    cwd: CONTRACTS_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0 && result.status !== 1) {
    // forge returns 1 when tests fail; that's a pre-existing R5.9
    // env-bleed flakiness on this branch. The lcov.info file is still
    // produced. status > 1 is a real spawn failure.
    console.error(`[coverage-contracts] forge exited with ${result.status}; aborting.`);
    process.exit(2);
  }
}

if (!existsSync(LCOV_PATH)) {
  console.error(`[coverage-contracts] expected lcov.info at ${LCOV_PATH}; forge coverage did not produce it.`);
  process.exit(2);
}

// ─── 2. Parse the LCOV records ────────────────────────────────────────
//
// LCOV format: blocks separated by `end_of_record`. Each block has:
//   SF:<path>
//   FN:<line>,<fnname>
//   FNDA:<count>,<fnname>
//   DA:<line>,<count>       (line execution)
//   BRDA:<line>,<block>,<branch>,<count|->
//   LF:<lines-found>
//   LH:<lines-hit>
//   FNF / FNH               (functions)
//   BRF / BRH               (branches)
//
// We need LF/LH/BRF/BRH/FNF/FNH per src/ file.

interface Coverage {
  path: string;
  category: 'security-critical' | 'core' | 'naming-ontology' | 'governance' | 'library' | 'identity' | 'other';
  lines: { found: number; hit: number; pct: number };
  branches: { found: number; hit: number; pct: number };
  functions: { found: number; hit: number; pct: number };
}

const lcov = readFileSync(LCOV_PATH, 'utf8');
const blocks = lcov.split('end_of_record').map((b) => b.trim()).filter(Boolean);

function intField(block: string, key: string): number {
  const m = block.match(new RegExp(`^${key}:(\\d+)`, 'm'));
  return m ? parseInt(m[1]!, 10) : 0;
}

function pct(found: number, hit: number): number {
  return found === 0 ? 100 : Math.round((hit / found) * 10000) / 100;
}

const SECURITY_CRITICAL = new Set([
  'src/AgentAccount.sol',
  'src/AgentAccountFactory.sol',
  'src/SmartAgentPaymaster.sol',
  'src/UniversalSignatureValidator.sol',
  'src/agency/DelegationManager.sol',
  'src/custody/CustodyPolicy.sol',
  'src/enforcers/AllowedMethodsEnforcer.sol',
  'src/enforcers/AllowedTargetsEnforcer.sol',
  'src/enforcers/QuorumEnforcer.sol',
  'src/enforcers/TimestampEnforcer.sol',
  'src/enforcers/ValueEnforcer.sol',
]);

function categorize(path: string): Coverage['category'] {
  if (SECURITY_CRITICAL.has(path)) return 'security-critical';
  if (path.startsWith('src/libraries/')) return 'library';
  if (path.startsWith('src/governance/')) return 'governance';
  if (path.startsWith('src/naming/') || path.startsWith('src/ontology/')) return 'naming-ontology';
  if (path.startsWith('src/identity/') || path.startsWith('src/relationships/')) return 'identity';
  if (path.startsWith('src/')) return 'core';
  return 'other';
}

const rows: Coverage[] = [];
for (const block of blocks) {
  const sfMatch = block.match(/^SF:(.+)/m);
  if (!sfMatch) continue;
  const path = sfMatch[1]!.trim();
  if (!path.startsWith('src/')) continue;
  // Skip the abstract base — exercised through concretes.
  if (path === 'src/enforcers/CaveatEnforcerBase.sol') continue;

  const lf = intField(block, 'LF');
  const lh = intField(block, 'LH');
  const brf = intField(block, 'BRF');
  const brh = intField(block, 'BRH');
  const fnf = intField(block, 'FNF');
  const fnh = intField(block, 'FNH');

  rows.push({
    path,
    category: categorize(path),
    lines: { found: lf, hit: lh, pct: pct(lf, lh) },
    branches: { found: brf, hit: brh, pct: pct(brf, brh) },
    functions: { found: fnf, hit: fnh, pct: pct(fnf, fnh) },
  });
}

// ─── 3. Sort + emit JSON ──────────────────────────────────────────────
//
// Sort by (category, path) for stable diff. Aggregates per category +
// overall.

const categoryOrder: Coverage['category'][] = [
  'security-critical', 'core', 'naming-ontology', 'identity', 'governance', 'library', 'other',
];
rows.sort((a, b) => {
  const ca = categoryOrder.indexOf(a.category);
  const cb = categoryOrder.indexOf(b.category);
  if (ca !== cb) return ca - cb;
  return a.path.localeCompare(b.path);
});

function rollup(subset: Coverage[]) {
  const lf = subset.reduce((s, r) => s + r.lines.found, 0);
  const lh = subset.reduce((s, r) => s + r.lines.hit, 0);
  const brf = subset.reduce((s, r) => s + r.branches.found, 0);
  const brh = subset.reduce((s, r) => s + r.branches.hit, 0);
  const fnf = subset.reduce((s, r) => s + r.functions.found, 0);
  const fnh = subset.reduce((s, r) => s + r.functions.hit, 0);
  return {
    contracts: subset.length,
    lines: { found: lf, hit: lh, pct: pct(lf, lh) },
    branches: { found: brf, hit: brh, pct: pct(brf, brh) },
    functions: { found: fnf, hit: fnh, pct: pct(fnf, fnh) },
  };
}

const byCategory = Object.fromEntries(
  categoryOrder
    .map((cat) => [cat, rollup(rows.filter((r) => r.category === cat))])
    .filter(([, v]) => (v as { contracts: number }).contracts > 0),
);
const overall = rollup(rows);

const json = {
  generatedAt: new Date().toISOString(),
  source: 'lcov.info (forge coverage --ir-minimum --report lcov)',
  note: 'R6.9 — the summary-table rendering of `forge coverage` SKIPS security-critical contracts. This aggregator parses the LCOV record (which DOES include them) so the audit-trail can show evidence for every contract.',
  overall,
  byCategory,
  contracts: rows,
};

writeFileSync(OUTPUT_JSON, JSON.stringify(json, null, 2));
console.log(`[coverage-contracts] wrote ${OUTPUT_JSON} (${rows.length} contracts)`);

// ─── 4. Print markdown summary ────────────────────────────────────────

function bar(value: number): string {
  // 10-char unicode bar — for the markdown summary in stdout.
  const filled = Math.round((value / 100) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

console.log('');
console.log('## Per-contract coverage (R6.9 aggregator)');
console.log('');
console.log('| Contract | Category | Lines | Branches | Functions |');
console.log('|---|---|---:|---:|---:|');
for (const r of rows) {
  const lineStr = `${r.lines.pct.toFixed(1)}% (${r.lines.hit}/${r.lines.found})`;
  const brStr = `${r.branches.pct.toFixed(1)}% (${r.branches.hit}/${r.branches.found})`;
  const fnStr = `${r.functions.pct.toFixed(1)}% (${r.functions.hit}/${r.functions.found})`;
  console.log(`| ${r.path} | ${r.category} | ${lineStr} | ${brStr} | ${fnStr} |`);
}
console.log('');
console.log('## Category rollups');
console.log('');
console.log('| Category | Contracts | Lines | Branches | Functions |');
console.log('|---|---:|---:|---:|---:|');
for (const [cat, v] of Object.entries(byCategory)) {
  const r = v as { contracts: number; lines: { pct: number }; branches: { pct: number }; functions: { pct: number } };
  console.log(`| ${cat} | ${r.contracts} | ${r.lines.pct.toFixed(1)}% ${bar(r.lines.pct)} | ${r.branches.pct.toFixed(1)}% ${bar(r.branches.pct)} | ${r.functions.pct.toFixed(1)}% ${bar(r.functions.pct)} |`);
}
console.log('');
console.log(`**Overall:** ${overall.contracts} contracts · ${overall.lines.pct.toFixed(1)}% lines · ${overall.branches.pct.toFixed(1)}% branches · ${overall.functions.pct.toFixed(1)}% functions`);
console.log('');

// ─── 5. Gate (informational today, ratchet after R6.10) ───────────────
//
// R6.9 reports gaps but does NOT fail. R6.10 will close the named gaps
// + enable a ratchet floor.

const SECURITY_CRITICAL_FLOOR = 70;  // post-R3.3 / R3.5 baseline; R6.10 will raise
const RATCHET_ENABLED = false;       // flip after R6.10

let belowFloor = 0;
for (const r of rows) {
  if (r.category !== 'security-critical') continue;
  if (r.lines.pct < SECURITY_CRITICAL_FLOOR) {
    console.log(`⚠️  ${r.path}: ${r.lines.pct.toFixed(1)}% lines — below ${SECURITY_CRITICAL_FLOOR}% security-critical floor`);
    belowFloor++;
  }
}

if (belowFloor > 0 && RATCHET_ENABLED) {
  console.error(`[coverage-contracts] ${belowFloor} security-critical contract(s) below the floor.`);
  process.exit(1);
}

console.log(`[coverage-contracts] done — ${belowFloor} below floor (gate ${RATCHET_ENABLED ? 'ENFORCING' : 'INFORMATIONAL until R6.10'})`);
