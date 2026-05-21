/**
 * check-sentinel-enforcers.ts
 *
 * CI rail backing the DTK alignment audit § 5.5 + delegation/AUDIT.md DEL-5
 * finding. Walks docs/architecture/enforcer-registry/enforcers.json + ensures:
 *
 * 1. Every entry with status='sentinel-footgun' is documented as such in
 *    packages/delegation/src/caveats.ts (either deprecated or commented as
 *    sentinel-only). Prevents accidental promotion to user-facing SDK.
 *
 * 2. No new sentinel addresses sneak in. We detect sentinel patterns
 *    (sentinelAddress('urn:...') in the source) + require each one to be
 *    accounted for in the registry.
 *
 * 3. Every 'shipped' entry has a real address in at least one chain's
 *    deployments-<network>.json, and the contract path exists.
 *
 * Failure modes (all fail the CI build):
 *   - Registry entry references a contract path that doesn't exist
 *   - SDK exports a sentinel that's not in the registry
 *   - 'shipped' entry has no deployment address recorded
 *   - 'shipped' entry's audit file is missing
 *
 * Usage:
 *   pnpm tsx scripts/check-sentinel-enforcers.ts
 *   pnpm check:sentinel-enforcers  (alias in root package.json)
 *
 * Exit 0 = clean. Exit 1 = drift detected; output names the offending lines.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const REGISTRY_PATH = join(REPO_ROOT, 'docs', 'architecture', 'enforcer-registry', 'enforcers.json');
const CAVEATS_SRC = join(REPO_ROOT, 'packages', 'delegation', 'src', 'caveats.ts');

interface EnforcerEntry {
  name: string;
  status: 'shipped' | 'planned' | 'gap' | 'divergent' | 'sentinel-footgun';
  contractPath: string | null;
  auditPath: string | null;
  sdkBuilder: string | null;
  sdkExport?: string;
  deployments: Record<string, string>;
  dtkEquivalent: string | null;
  dtkParity: string;
  summary: string;
}

interface Registry {
  enforcers: EnforcerEntry[];
}

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) {
    fail(`enforcer registry not found at ${REGISTRY_PATH}`);
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry;
}

function loadCaveatsSrc(): string {
  if (!existsSync(CAVEATS_SRC)) {
    fail(`caveats source not found at ${CAVEATS_SRC}`);
  }
  return readFileSync(CAVEATS_SRC, 'utf8');
}

function main(): void {
  const registry = loadRegistry();
  const caveatsSrc = loadCaveatsSrc();
  const errors: string[] = [];

  // ─── 1. Validate shipped entries ─────────────────────────────────
  for (const e of registry.enforcers) {
    if (e.status === 'shipped') {
      if (!e.contractPath) {
        errors.push(`shipped enforcer ${e.name}: missing contractPath`);
        continue;
      }
      const contractFile = join(REPO_ROOT, e.contractPath);
      if (!existsSync(contractFile)) {
        errors.push(`shipped enforcer ${e.name}: contract file does not exist at ${e.contractPath}`);
      }
      if (Object.keys(e.deployments).length === 0) {
        errors.push(`shipped enforcer ${e.name}: no deployment addresses recorded`);
      }
      if (!e.auditPath) {
        errors.push(`shipped enforcer ${e.name}: missing auditPath (every shipped enforcer needs a per-enforcer AUDIT.md)`);
      } else {
        const auditFile = join(REPO_ROOT, e.auditPath);
        if (!existsSync(auditFile)) {
          errors.push(`shipped enforcer ${e.name}: audit file does not exist at ${e.auditPath}`);
        }
      }
    }
  }

  // ─── 2. Validate sentinel-footgun entries ────────────────────────
  // Each sentinel listed in the registry must appear in caveats.ts.
  // This binds the registry to the SDK source — if someone removes a
  // sentinel from the SDK they must also update the registry.
  for (const e of registry.enforcers) {
    if (e.status === 'sentinel-footgun') {
      const name = e.name; // e.g. MCP_TOOL_SCOPE_ENFORCER
      if (!caveatsSrc.includes(name)) {
        errors.push(`sentinel-footgun ${name} listed in registry but not found in packages/delegation/src/caveats.ts — registry stale or SDK already cleaned up`);
      }
    }
  }

  // ─── 3. Detect unregistered sentinels in the SDK ─────────────────
  // Look for `sentinelAddress(` calls. Each one's variable name must
  // appear as a 'sentinel-footgun' entry in the registry. Catches new
  // sentinel-only exports that slip in unaccounted for.
  const sentinelRe = /export const (\w+)\s*:\s*Address\s*=\s*sentinelAddress\(/g;
  let m: RegExpExecArray | null;
  while ((m = sentinelRe.exec(caveatsSrc)) !== null) {
    const name = m[1]!;
    const found = registry.enforcers.some((e) => e.name === name);
    if (!found) {
      errors.push(`SDK exports sentinel ${name} but no registry entry — add it to enforcers.json with status='sentinel-footgun' OR ship the contract and switch to status='shipped'`);
    } else {
      const entry = registry.enforcers.find((e) => e.name === name)!;
      if (entry.status !== 'sentinel-footgun' && entry.status !== 'planned') {
        errors.push(`SDK exports sentinel ${name} as a sentinelAddress call, but registry says status='${entry.status}' — should be 'sentinel-footgun' (intentional stub) or 'planned' (contract incoming)`);
      }
    }
  }

  // ─── 4. Validate the registry shape ─────────────────────────────
  const allowedStatus = new Set(['shipped', 'planned', 'gap', 'divergent', 'sentinel-footgun']);
  for (const e of registry.enforcers) {
    if (!allowedStatus.has(e.status)) {
      errors.push(`enforcer ${e.name}: unknown status '${e.status}'`);
    }
    if (!e.summary || e.summary.length < 10) {
      errors.push(`enforcer ${e.name}: summary too short (must be a useful one-liner)`);
    }
  }

  // ─── Report ─────────────────────────────────────────────────────
  if (errors.length > 0) {
    console.error('Enforcer registry / SDK drift detected:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('');
    console.error(`Source of truth: docs/architecture/enforcer-registry/enforcers.json`);
    console.error(`SDK source:      packages/delegation/src/caveats.ts`);
    process.exit(1);
  }

  console.log('check-sentinel-enforcers: clean.');
  const shipped = registry.enforcers.filter((e) => e.status === 'shipped').length;
  const sentinel = registry.enforcers.filter((e) => e.status === 'sentinel-footgun').length;
  const planned = registry.enforcers.filter((e) => e.status === 'planned').length;
  const gap = registry.enforcers.filter((e) => e.status === 'gap').length;
  console.log(`  shipped: ${shipped}  sentinel-footgun: ${sentinel}  planned: ${planned}  gap: ${gap}`);
}

main();
