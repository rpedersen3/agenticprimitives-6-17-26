#!/usr/bin/env tsx
/**
 * check-abi-sync.ts — R7.2 ABI sync doctrine.
 *
 * Catches the exact failure mode that ate hours of debugging on 2026-06-01:
 * the TS hand-maintained ABI mirror in `packages/agent-account/src/abis.ts`
 * silently drifted from the on-chain Solidity struct (the
 * `initialPasskeyRpIdHash` field had been added to
 * `AgentAccountInitParams` in Solidity but never propagated to the TS
 * tuple), so every `getAddressForAgentAccount` call hit
 * `execution reverted` and `buildDeployUserOp failed` cascaded all the
 * way to the user-visible PII flow.
 *
 * The check:
 *   1. Load the canonical ABI for AgentAccount + AgentAccountFactory from
 *      `packages/contracts/dist/abi/*.json` (the Foundry-built ABI is the
 *      single source of truth).
 *   2. Load the hand-maintained TS ABI from
 *      `packages/agent-account/src/abis.ts` (loaded via tsx).
 *   3. For each function we care about (the ones agent-account's client
 *      actually calls), compare the input/output tuple shapes (types +
 *      field names + tuple components) field by field.
 *   4. On drift, print a precise diff + exit non-zero.
 *
 * The contracts must be built first (`pnpm --filter contracts build`)
 * so the JSON ABIs exist. CI runs `forge build` ahead of this check.
 *
 * Exit codes:
 *   0 — TS ABI matches the Foundry ABI
 *   1 — drift found OR ABIs missing
 *   2 — script error (couldn't load one side)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const FOUNDRY_ABI_DIR = join(REPO_ROOT, 'packages', 'contracts', 'dist', 'abi');
const TS_ABI_PATH = join(REPO_ROOT, 'packages', 'agent-account', 'src', 'abis.ts');

// Functions whose signatures the TS client load-bearingly relies on.
// Add an entry here when agent-account starts calling a new function.
const WATCHED_FUNCTIONS: Array<{
  contract: 'AgentAccount' | 'AgentAccountFactory';
  fn: string;
}> = [
  { contract: 'AgentAccountFactory', fn: 'createAgentAccount' },
  { contract: 'AgentAccountFactory', fn: 'getAddressForAgentAccount' },
  { contract: 'AgentAccount', fn: 'isValidSignature' },
];

interface AbiEntry {
  type: string;
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
}

interface AbiParam {
  name: string;
  type: string;
  components?: AbiParam[];
}

function loadFoundryAbi(contract: string): AbiEntry[] {
  const p = join(FOUNDRY_ABI_DIR, `${contract}.json`);
  if (!existsSync(p)) {
    console.error(
      `[abi-sync] FAIL: ${p} not found. Run \`pnpm --filter @agenticprimitives/contracts build\` first.`,
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as AbiEntry[];
}

function findFn(abi: AbiEntry[], name: string): AbiEntry | undefined {
  return abi.find((e) => e.type === 'function' && e.name === name);
}

// Compare two ABI param trees (functions' inputs/outputs). Returns null on
// match, a diff-description string on drift.
function diffParams(
  path: string,
  expected: AbiParam[] | undefined,
  actual: AbiParam[] | undefined,
): string | null {
  const a = expected ?? [];
  const b = actual ?? [];
  if (a.length !== b.length) {
    return `${path}: param count ${b.length} (TS) ≠ ${a.length} (Solidity)\n  expected: [${a.map((p) => `${p.name}:${p.type}`).join(', ')}]\n  got     : [${b.map((p) => `${p.name}:${p.type}`).join(', ')}]`;
  }
  for (let i = 0; i < a.length; i++) {
    const ea = a[i];
    const ba = b[i];
    if (ea.type !== ba.type) {
      return `${path}[${i}].type: TS '${ba.type}' ≠ Solidity '${ea.type}'`;
    }
    if (ea.name !== ba.name) {
      return `${path}[${i}].name: TS '${ba.name}' ≠ Solidity '${ea.name}'`;
    }
    if (ea.type === 'tuple' || ea.type.endsWith(']')) {
      const inner = diffParams(`${path}[${i}].components`, ea.components, ba.components);
      if (inner) return inner;
    }
  }
  return null;
}

async function loadTsAbi(): Promise<{
  agentAccountFactoryAbi: AbiEntry[];
  agentAccountAbi: AbiEntry[];
}> {
  // tsx is the runner; this script itself runs via tsx so dynamic import
  // of a .ts file Just Works.
  const mod = (await import(TS_ABI_PATH)) as {
    agentAccountFactoryAbi: AbiEntry[];
    agentAccountAbi: AbiEntry[];
  };
  if (!mod.agentAccountFactoryAbi || !mod.agentAccountAbi) {
    console.error(
      `[abi-sync] FAIL: ${TS_ABI_PATH} must export agentAccountFactoryAbi + agentAccountAbi.`,
    );
    process.exit(1);
  }
  return mod;
}

async function main() {
  const ts = await loadTsAbi();
  const findings: string[] = [];

  for (const w of WATCHED_FUNCTIONS) {
    const foundry = loadFoundryAbi(w.contract);
    const tsAbi = w.contract === 'AgentAccountFactory' ? ts.agentAccountFactoryAbi : ts.agentAccountAbi;

    const expected = findFn(foundry, w.fn);
    if (!expected) {
      findings.push(`${w.contract}.${w.fn}: function not found in Foundry ABI`);
      continue;
    }
    const actual = findFn(tsAbi, w.fn);
    if (!actual) {
      findings.push(`${w.contract}.${w.fn}: function not declared in TS ABI`);
      continue;
    }
    const inputDiff = diffParams(`${w.contract}.${w.fn}.inputs`, expected.inputs, actual.inputs);
    if (inputDiff) findings.push(inputDiff);
    const outputDiff = diffParams(
      `${w.contract}.${w.fn}.outputs`,
      expected.outputs,
      actual.outputs,
    );
    if (outputDiff) findings.push(outputDiff);
  }

  if (findings.length === 0) {
    const watchList = WATCHED_FUNCTIONS.map((w) => `${w.contract}.${w.fn}`).join(', ');
    console.log(`[abi-sync] ✓ TS ABI in agent-account matches Foundry-built ABI`);
    console.log(`[abi-sync]   watched: ${watchList}`);
    process.exit(0);
  }

  console.error(`[abi-sync] ✗ FAILED: ${findings.length} drift finding(s)`);
  console.error('');
  for (const f of findings) {
    console.error(`  ${f}`);
    console.error('');
  }
  console.error(
    'Fix: update packages/agent-account/src/abis.ts to match the on-chain Solidity struct.',
  );
  console.error(
    'The Foundry ABI is the single source of truth (packages/contracts/dist/abi/).',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('[abi-sync] script error:', e);
  process.exit(2);
});
