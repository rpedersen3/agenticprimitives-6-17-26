#!/usr/bin/env tsx
/**
 * check-forge-coverage.ts — H7-E.2 / forge-coverage CI gate.
 *
 * Runs `forge coverage --ir-minimum --report summary` from
 * `packages/contracts/` and parses the per-contract summary, then
 * enforces per-tier coverage floors:
 *
 *   - libraries/ (security-critical primitives): ≥ 85% lines, ≥ 75% branches
 *   - src/* (everything else under src/): ≥ 60% lines, ≥ 35% branches
 *
 * Skips the test suite itself and any contract not under `src/`.
 *
 * Exits non-zero if any contract is below its tier's floor — fail-fast
 * regression gate. Tweaking the floors UP after each H7-D / R1 wave is
 * the way to push the project to production-ready coverage.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface Threshold {
  lines: number;
  branches: number;
}

// Production-ready tier floors. New contracts get these by default.
const LIBRARY_FLOOR: Threshold = { lines: 85, branches: 75 };
const SRC_FLOOR: Threshold = { lines: 60, branches: 35 };

/**
 * Per-contract accepted-debt floors. Captured at the end of H7-D — every
 * entry documents pre-existing coverage debt the H7-D pass did not (yet)
 * close. The CI gate is RATCHET-ONLY: it prevents any contract from going
 * BELOW its recorded debt floor, while still allowing new contracts to be
 * held to the tier floors above.
 *
 * To close an entry: raise the test coverage above the tier floor and
 * delete the row. To accept new debt: prove it's intentional, then add a
 * row here. **Never raise an entry to mask a regression** — drop the
 * floor or close the underlying gap.
 *
 * Post-audit wave: every entry here is a candidate for closure.
 */
const ACCEPTED_DEBT: Record<string, Threshold> = {
  'src/SmartAgentPaymaster.sol':                     { lines: 50, branches: 20 },
  // src/agency/DelegationManager.sol — R3.3 closed CON-DelegationManager-001.
  // Coverage: 95.77% lines / 88.24% branches / 100% functions. Above SRC tier
  // floor (60/35); debt row removed. Any regression below tier fails CI.
  'src/custody/CustodyPolicy.sol':                   { lines: 70, branches: 25 },
  'src/enforcers/CaveatEnforcerBase.sol':            { lines:  0, branches:  0 }, // abstract — exercised via concretes
  'src/identity/AgentProfileResolver.sol':           { lines: 55, branches: 45 },
  'src/libraries/MultiSendCallOnly.sol':             { lines: 65, branches: 75 }, // library debt
  'src/libraries/SignatureSlotRecovery.sol':         { lines: 70, branches: 75 }, // library debt
  'src/libraries/WebAuthnLib.sol':                   { lines: 85, branches: 60 }, // library debt
  'src/naming/AgentNameAttributeResolver.sol':       { lines: 50, branches: 35 },
  'src/ontology/AttributeStorage.sol':               { lines: 50, branches: 20 },
  'src/relationships/RelationshipTypeRegistry.sol':  { lines: 80, branches: 25 },
  // Production-ready (lower than tier floor but still acceptable for non-load-bearing):
  // src/AgentAccount.sol — R3.5 closed CON-AgentAccount-001.
  // Coverage: 91.25% lines / 90.65% statements / 84.51% branches / 100% functions.
  // Above ≥90 lines / ≥80 branches production-library target. Debt row removed;
  // contract held to standard SRC tier floor.
};

function thresholdFor(path: string): { tier: 'libraries' | 'src' | 'debt'; floor: Threshold } {
  if (ACCEPTED_DEBT[path]) return { tier: 'debt', floor: ACCEPTED_DEBT[path]! };
  if (path.startsWith('src/libraries/')) return { tier: 'libraries', floor: LIBRARY_FLOOR };
  return { tier: 'src', floor: SRC_FLOOR };
}

const CONTRACTS_DIR = join(process.cwd(), 'packages/contracts');
if (!existsSync(CONTRACTS_DIR)) {
  console.error(`[check-forge-coverage] expected ${CONTRACTS_DIR} to exist; run from repo root.`);
  process.exit(2);
}

console.log('[check-forge-coverage] running `forge coverage --ir-minimum --report summary --no-match-path test/halmos/**` …');
const result = spawnSync('forge', ['coverage', '--ir-minimum', '--report', 'summary', '--no-match-path', 'test/halmos/**'], {
  cwd: CONTRACTS_DIR,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error(`[check-forge-coverage] failed to spawn forge: ${result.error.message}`);
  process.exit(2);
}

const out = (result.stdout || '') + (result.stderr || '');

// Parse rows like:
//   | src/AgentAccount.sol | 55.62% (178/320) | 51.95% (200/385) | 36.62% (26/71) | 62.07% (36/58) |
const rowRe = /^\|\s+(src\/[\w./-]+\.sol)\s+\|\s+([0-9.]+)%\s+\([0-9]+\/[0-9]+\)\s+\|\s+[0-9.]+%\s+\([0-9]+\/[0-9]+\)\s+\|\s+([0-9.]+)%\s+\([0-9]+\/[0-9]+\)\s+\|/gm;

interface Row {
  path: string;
  lines: number;
  branches: number;
}

const rows: Row[] = [];
let m: RegExpExecArray | null;
while ((m = rowRe.exec(out)) !== null) {
  rows.push({
    path: m[1]!,
    lines: parseFloat(m[2]!),
    branches: parseFloat(m[3]!),
  });
}

if (rows.length === 0) {
  console.error('[check-forge-coverage] could not parse any coverage rows from forge output');
  console.error('--- forge output ---');
  console.error(out.slice(0, 4000));
  process.exit(2);
}

console.log(`[check-forge-coverage] parsed ${rows.length} contract row(s).`);

let failed = 0;
for (const row of rows) {
  const { tier, floor } = thresholdFor(row.path);
  const lineOk = row.lines >= floor.lines;
  const branchOk = row.branches >= floor.branches;
  if (lineOk && branchOk) {
    console.log(
      `  ✓ ${row.path.padEnd(56)} ${row.lines.toFixed(1)}% lines, ${row.branches.toFixed(1)}% branches  [${tier} floor: ${floor.lines}% / ${floor.branches}%]`,
    );
  } else {
    failed += 1;
    console.error(
      `  ✗ ${row.path.padEnd(56)} ${row.lines.toFixed(1)}% lines, ${row.branches.toFixed(1)}% branches  [${tier} floor: ${floor.lines}% / ${floor.branches}%]`,
    );
  }
}

if (failed > 0) {
  console.error(
    `\n[check-forge-coverage] FAILED: ${failed} contract(s) below floor. ` +
      `Tweak the floors in scripts/check-forge-coverage.ts after each H7-D / R1 wave to push the project to production-ready coverage.`,
  );
  process.exit(1);
}

console.log(`\n[check-forge-coverage] ✓ all ${rows.length} contracts meet their tier floor.`);
