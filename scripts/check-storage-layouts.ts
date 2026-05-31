#!/usr/bin/env tsx
/**
 * check-storage-layouts.ts — R1.3 / C6 storage-layout snapshot gate.
 *
 * For each contract in `LOCKED_CONTRACTS` we run
 *
 *   forge inspect <C> storageLayout --json
 *
 * from `packages/contracts/`, normalize the type strings (struct / enum
 * AST IDs are stripped — they drift when files are touched; the slot +
 * offset + label + base type IS the layout invariant) and diff against
 * a locked snapshot under
 *
 *   packages/contracts/test/storage-layouts/<C>.snap.json
 *
 * Any diff fails CI. The snapshots are the canonical record of each
 * contract's storage layout at the post-R1 baseline. Adding a storage
 * slot is a breaking layout change (esp. for ERC-7579 modular accounts
 * and the AgentAccount which deploys behind ERC-1967 proxies); this gate
 * forces the change to be intentional + reviewed.
 *
 * To rotate snapshots after an intentional layout change:
 *   pnpm check:storage-layouts --update
 *
 * See specs/213 (custody-layer carve-out) + spec 209 (ERC-7579 module
 * architecture) for the rationale.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const CONTRACTS_DIR = join(REPO_ROOT, 'packages/contracts');
const SNAPSHOT_DIR = join(CONTRACTS_DIR, 'test/storage-layouts');

// Locked contracts: the upgradeable / proxy-deployed surfaces where a
// storage-layout reordering would corrupt deployed state. Add a new
// entry here ONLY after creating its initial snapshot and reviewing the
// implications of locking the layout.
const LOCKED_CONTRACTS = [
  'AgentAccount',
  'CustodyPolicy',
  'DelegationManager',
  'SmartAgentPaymaster',
];

interface StorageEntry {
  label: string;
  slot: string;
  offset: number;
  type: string;
  contract: string;
}

interface Snapshot {
  name: string;
  storage: StorageEntry[];
}

/** Strip AST IDs from struct/enum type names (they drift on edits). */
function normalizeType(t: string): string {
  return t
    .replace(/t_struct\(([^)]+)\)\d+_storage/g, 't_struct($1)_storage')
    .replace(/t_enum\(([^)]+)\)\d+/g, 't_enum($1)');
}

function inspectStorage(contract: string): Snapshot {
  const r = spawnSync('forge', ['inspect', contract, 'storageLayout', '--json'], {
    cwd: CONTRACTS_DIR,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`forge inspect ${contract} storageLayout failed:`);
    console.error(r.stderr || r.stdout);
    process.exit(2);
  }
  // forge inspect may emit pre-amble lines before the JSON when the
  // workspace needs a rebuild; find the first '{'.
  const stdout = r.stdout ?? '';
  const start = stdout.indexOf('{');
  if (start < 0) {
    console.error(`forge inspect ${contract} produced no JSON output.`);
    console.error(stdout);
    process.exit(2);
  }
  const raw = JSON.parse(stdout.slice(start)) as { storage: StorageEntry[] };
  return {
    name: contract,
    storage: raw.storage.map((e) => ({
      label: e.label,
      slot: e.slot,
      offset: e.offset,
      type: normalizeType(e.type),
      contract: e.contract,
    })),
  };
}

function snapshotPath(contract: string): string {
  return join(SNAPSHOT_DIR, `${contract}.snap.json`);
}

function readSnapshot(contract: string): Snapshot {
  const p = snapshotPath(contract);
  if (!existsSync(p)) {
    console.error(`Missing locked snapshot: ${p}`);
    console.error(`Run \`pnpm check:storage-layouts --update\` to create it.`);
    process.exit(3);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as Snapshot;
}

function diff(expected: Snapshot, actual: Snapshot): string[] {
  const lines: string[] = [];
  const byKey = (s: Snapshot) =>
    new Map(s.storage.map((e) => [`${e.contract}#${e.label}`, e]));
  const exp = byKey(expected);
  const act = byKey(actual);
  for (const [k, e] of exp) {
    const a = act.get(k);
    if (!a) {
      lines.push(`  - REMOVED  ${k}  (was slot=${e.slot} offset=${e.offset} type=${e.type})`);
      continue;
    }
    if (e.slot !== a.slot) lines.push(`  ! SLOT     ${k}: ${e.slot} → ${a.slot}`);
    if (e.offset !== a.offset) lines.push(`  ! OFFSET   ${k}: ${e.offset} → ${a.offset}`);
    if (e.type !== a.type) lines.push(`  ! TYPE     ${k}: ${e.type} → ${a.type}`);
  }
  for (const [k, a] of act) {
    if (!exp.has(k)) {
      lines.push(`  + ADDED    ${k}  (slot=${a.slot} offset=${a.offset} type=${a.type})`);
    }
  }
  return lines;
}

function main() {
  const update = process.argv.includes('--update');
  let failures = 0;

  for (const contract of LOCKED_CONTRACTS) {
    const fresh = inspectStorage(contract);
    if (update) {
      writeFileSync(snapshotPath(contract), `${JSON.stringify(fresh, null, 2)}\n`);
      console.log(`  ✓ rotated ${contract}.snap.json (${fresh.storage.length} slots)`);
      continue;
    }
    const locked = readSnapshot(contract);
    const drift = diff(locked, fresh);
    if (drift.length === 0) {
      console.log(`  ✓ ${contract} layout matches snapshot (${fresh.storage.length} slots)`);
    } else {
      failures += 1;
      console.error(`  ✗ ${contract} layout DRIFTED:`);
      for (const line of drift) console.error(line);
    }
  }

  if (update) {
    console.log('\nSnapshots rotated. Commit the .snap.json changes deliberately.');
    return;
  }
  if (failures > 0) {
    console.error('');
    console.error(
      `${failures} contract(s) drifted from the locked storage layout. ` +
        `If the change is intentional, run \`pnpm check:storage-layouts --update\` ` +
        `and review the diff carefully — a storage reorder is a breaking ` +
        `change for any deployed proxy. See ADR-0010 + spec 213.`,
    );
    process.exit(1);
  }
  console.log(`✓ check:storage-layouts passed (${LOCKED_CONTRACTS.length} contracts).`);
}

main();
