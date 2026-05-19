/**
 * check-capability-manifests.ts
 *
 * Validates every packages/<name>/capability.manifest.json against:
 *   1. Required fields per scripts/schemas/capability.manifest.schema.json
 *   2. name matches package.json:name
 *   3. imports matches package.json (peerDependencies + dependencies) when both reference @agenticprimitives/*
 *   4. publicEntry file exists
 *   5. specEntry file exists
 *
 * Per spec 102 §5.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

interface Manifest {
  name: string;
  kind: 'capability' | 'shared' | 'adapter';
  stability: 'experimental' | 'beta' | 'stable';
  agentEntry: string;
  publicEntry: string;
  specEntry: string;
  summary: string;
  owns: { source?: string[]; tests?: string[] };
  imports: string[];
  allowedImports: string[];
  forbiddenImports: string[];
  publicExports: string[];
  forbiddenTerms?: Array<{ term: string; reason: string }>;
  ignoreForAgentContext: string[];
  contextBudget: {
    claudeMdMaxWords: number;
    readmeMaxWords: number;
    architectureMaxWords: number;
  };
}

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Failure {
  pkg: string;
  field: string;
  message: string;
}

const REQUIRED_TOP_FIELDS: Array<keyof Manifest> = [
  'name', 'kind', 'stability', 'agentEntry', 'publicEntry', 'specEntry', 'summary',
  'owns', 'imports', 'allowedImports', 'forbiddenImports', 'publicExports',
  'ignoreForAgentContext', 'contextBudget',
];

const REQUIRED_CONTEXT_BUDGET_FIELDS = ['claudeMdMaxWords', 'readmeMaxWords', 'architectureMaxWords'] as const;

const KIND_VALUES = new Set(['capability', 'shared', 'adapter']);
const STABILITY_VALUES = new Set(['experimental', 'beta', 'stable']);

function loadPackages(): Array<{ dir: string; manifest: Manifest; pkgJson: PackageJson }> {
  const out: Array<{ dir: string; manifest: Manifest; pkgJson: PackageJson }> = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const mPath = join(dir, 'capability.manifest.json');
    const pPath = join(dir, 'package.json');
    if (!existsSync(mPath) || !existsSync(pPath)) continue;
    out.push({
      dir,
      manifest: JSON.parse(readFileSync(mPath, 'utf8')) as Manifest,
      pkgJson: JSON.parse(readFileSync(pPath, 'utf8')) as PackageJson,
    });
  }
  return out;
}

function validate(dir: string, manifest: Manifest, pkgJson: PackageJson): Failure[] {
  const fails: Failure[] = [];
  const push = (field: string, message: string) =>
    fails.push({ pkg: manifest?.name ?? dir, field, message });

  // 1. Required fields
  for (const field of REQUIRED_TOP_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      push(field, 'missing required field');
    }
  }

  // Type-specific checks
  if (manifest.name && !/^@agenticprimitives\/[a-z][a-z0-9-]*$/.test(manifest.name)) {
    push('name', `must match @agenticprimitives/<kebab-name>; got "${manifest.name}"`);
  }
  if (manifest.kind && !KIND_VALUES.has(manifest.kind)) {
    push('kind', `must be one of capability|shared|adapter; got "${manifest.kind}"`);
  }
  if (manifest.stability && !STABILITY_VALUES.has(manifest.stability)) {
    push('stability', `must be one of experimental|beta|stable; got "${manifest.stability}"`);
  }
  if (manifest.agentEntry && manifest.agentEntry !== 'CLAUDE.md') {
    push('agentEntry', `must be "CLAUDE.md"; got "${manifest.agentEntry}"`);
  }
  if (manifest.summary && manifest.summary.length > 200) {
    push('summary', `must be ≤ 200 chars; got ${manifest.summary.length}`);
  }
  if (manifest.contextBudget) {
    for (const f of REQUIRED_CONTEXT_BUDGET_FIELDS) {
      if (typeof manifest.contextBudget[f] !== 'number') {
        push(`contextBudget.${f}`, 'must be a number');
      }
    }
  }

  // 2. name matches package.json
  if (manifest.name && pkgJson.name && manifest.name !== pkgJson.name) {
    push('name', `package.json:name is "${pkgJson.name}" but manifest:name is "${manifest.name}"`);
  }

  // 3. imports cross-check: every @agenticprimitives/* dep in package.json should be in manifest.imports
  const allDeps = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
  ]);
  const apDeps = [...allDeps].filter((d) => d.startsWith('@agenticprimitives/'));
  for (const dep of apDeps) {
    if (!(manifest.imports ?? []).includes(dep)) {
      push('imports', `package.json declares "${dep}" but manifest.imports does not list it`);
    }
  }
  for (const imp of manifest.imports ?? []) {
    if (imp.startsWith('@agenticprimitives/') && !allDeps.has(imp)) {
      push('imports', `manifest.imports lists "${imp}" but package.json has no dep on it`);
    }
  }

  // 4. publicEntry file exists
  if (manifest.publicEntry) {
    const p = resolve(dir, manifest.publicEntry);
    if (!existsSync(p)) push('publicEntry', `file does not exist: ${manifest.publicEntry}`);
  }

  // 5. specEntry file exists (relative to manifest's dir)
  if (manifest.specEntry) {
    const p = resolve(dir, manifest.specEntry);
    if (!existsSync(p)) push('specEntry', `file does not exist: ${manifest.specEntry}`);
  }

  return fails;
}

function main() {
  const pkgs = loadPackages();
  if (pkgs.length === 0) {
    console.error('No manifests found in packages/.');
    process.exit(2);
  }

  const allFails: Failure[] = [];
  for (const { dir, manifest, pkgJson } of pkgs) {
    allFails.push(...validate(dir, manifest, pkgJson));
  }

  if (allFails.length === 0) {
    console.log(`✓ check:capability-manifests passed (${pkgs.length} packages).`);
    process.exit(0);
  }

  console.error(`✗ check:capability-manifests FAILED: ${allFails.length} issue(s).`);
  let lastPkg = '';
  for (const f of allFails) {
    if (f.pkg !== lastPkg) {
      console.error(`\n  ${f.pkg}`);
      lastPkg = f.pkg;
    }
    console.error(`    ${f.field}: ${f.message}`);
  }
  process.exit(1);
}

main();
