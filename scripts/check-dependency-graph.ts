/**
 * check-dependency-graph.ts
 *
 * The GLOBAL, cross-manifest dependency-graph check that per-manifest
 * `check:package-boundaries` cannot do (architecture audit P1-1). It builds the
 * `@agenticprimitives/*` import graph from every `capability.manifest.json` and
 * asserts:
 *
 *   1. Edge validity — every `@agenticprimitives/*` entry in a package's
 *      `imports` references an EXISTING package and is in that package's own
 *      `allowedImports` (a declared dep must be a permitted one).
 *   2. Acyclicity — the `imports` graph is a DAG (no cycles / back-edges).
 *      Spec 100 §4: "no cycles, no back-edges".
 *   3. Facet-registry firewall — the canonical denylist
 *      {agent-naming, agent-profile, agent-relationships} (ADR-0006) appears in
 *      every package's `forbiddenImports`, UNLESS the package IS that registry,
 *      is explicitly permitted to import it (`allowedImports`), or forbids all
 *      `@agenticprimitives/*` via the wildcard. This is what stops a future
 *      package (or a dropped denylist entry) from silently importing naming.
 *
 * Per spec 100 §4 + docs/audits/sso-wave-audit-findings.md (P1-1).
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const FACET_REGISTRIES = [
  '@agenticprimitives/agent-naming',
  '@agenticprimitives/agent-profile',
  '@agenticprimitives/agent-relationships',
] as const;
const WILDCARD = '@agenticprimitives/*';

interface Manifest {
  name: string;
  imports?: string[];
  allowedImports?: string[];
  forbiddenImports?: string[];
}

function loadManifests(): Manifest[] {
  const out: Manifest[] = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const mf = join(dir, 'capability.manifest.json');
    if (!existsSync(mf)) continue;
    out.push(JSON.parse(readFileSync(mf, 'utf8')) as Manifest);
  }
  return out;
}

function apOnly(list: string[] | undefined): string[] {
  return (list ?? []).filter((s) => s.startsWith('@agenticprimitives/') && s !== WILDCARD);
}

const violations: string[] = [];
function fail(msg: string): void {
  violations.push(msg);
}

function main(): void {
  const manifests = loadManifests();
  const byName = new Map(manifests.map((m) => [m.name, m]));

  // 1. Edge validity: every imported @agenticprimitives/* exists + is in allowedImports.
  for (const m of manifests) {
    const allowed = new Set(apOnly(m.allowedImports));
    for (const dep of apOnly(m.imports)) {
      if (!byName.has(dep)) fail(`${m.name}: imports "${dep}" which is not a known package`);
      if (!allowed.has(dep)) fail(`${m.name}: imports "${dep}" but it is not in allowedImports`);
    }
  }

  // 2. Acyclicity over the imports graph (DFS, gray/black).
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(manifests.map((m) => [m.name, WHITE]));
  const stack: string[] = [];
  let cycleFound = false;

  function dfs(name: string): void {
    if (cycleFound) return;
    color.set(name, GRAY);
    stack.push(name);
    for (const dep of apOnly(byName.get(name)?.imports)) {
      if (!byName.has(dep)) continue; // edge-validity already reported it
      const c = color.get(dep);
      if (c === GRAY) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep].map((n) => n.replace('@agenticprimitives/', ''));
        fail(`cycle detected: ${cycle.join(' → ')}`);
        cycleFound = true;
        return;
      }
      if (c === WHITE) dfs(dep);
      if (cycleFound) return;
    }
    stack.pop();
    color.set(name, BLACK);
  }
  for (const m of manifests) if (color.get(m.name) === WHITE) dfs(m.name);

  // 3. Facet-registry firewall.
  for (const m of manifests) {
    const allowed = new Set(apOnly(m.allowedImports));
    const forbidden = new Set(m.forbiddenImports ?? []);
    const wildcardForbidden = forbidden.has(WILDCARD);
    for (const reg of FACET_REGISTRIES) {
      if (reg === m.name) continue; // a package needn't denylist itself
      if (allowed.has(reg)) continue; // explicitly permitted (e.g. identity-directory-adapters → agent-naming)
      if (wildcardForbidden) continue; // forbids all @agenticprimitives/*
      if (!forbidden.has(reg)) {
        fail(`${m.name}: must list "${reg}" in forbiddenImports (facet-registry firewall, ADR-0006) — it neither imports it (allowedImports) nor forbids it`);
      }
    }
  }

  if (violations.length === 0) {
    console.log(`✓ check:dependency-graph passed (${manifests.length} packages: acyclic, edges valid, facet firewall intact).`);
    process.exit(0);
  }
  console.error(`✗ check:dependency-graph FAILED: ${violations.length} issue(s).\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nFix: correct the offending manifest (add the denylist entry, remove the back-edge, or declare the import in allowedImports).');
  process.exit(1);
}

main();
