/**
 * Generates docs/architecture/capability-index.md — the Claude routing index
 * referenced by root CLAUDE.md.
 *
 * Reads every packages/<name>/capability.manifest.json and produces a single
 * routing table. Per spec 102 §5.
 *
 * Usage:
 *   pnpm generate:capability-index
 *   pnpm generate:capability-index --check    # exit 1 if out of date
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const OUTPUT_PATH = join(REPO_ROOT, 'docs', 'architecture', 'capability-index.md');

interface Manifest {
  name: string;
  kind: 'capability' | 'shared' | 'adapter';
  stability: 'experimental' | 'beta' | 'stable';
  summary: string;
  specEntry: string;
  publicEntry: string;
  imports: string[];
  publicExports: string[];
}

function loadManifests(): Array<{ dir: string; manifest: Manifest }> {
  const entries = readdirSync(PACKAGES_DIR);
  const results: Array<{ dir: string; manifest: Manifest }> = [];
  for (const entry of entries) {
    const dir = join(PACKAGES_DIR, entry);
    const manifestPath = join(dir, 'capability.manifest.json');
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    results.push({ dir, manifest });
  }
  // Sort: shared first, then capability, then adapter; within each kind alphabetical
  const kindOrder = { shared: 0, capability: 1, adapter: 2 };
  results.sort((a, b) => {
    const k = kindOrder[a.manifest.kind] - kindOrder[b.manifest.kind];
    if (k !== 0) return k;
    return a.manifest.name.localeCompare(b.manifest.name);
  });
  return results;
}

function renderIndex(items: Array<{ dir: string; manifest: Manifest }>): string {
  const lines: string[] = [];
  lines.push('# Capability Index');
  lines.push('');
  lines.push('**Generated** by `scripts/generate-capability-index.ts`. Do not edit by hand — re-run the script after manifest changes.');
  lines.push('');
  lines.push('This is the routing index for Claude (and other agents) starting work in this repo. For each package, the table lists the canonical spec, public entry, and immediate `@agenticprimitives/*` dependencies.');
  lines.push('');
  lines.push('## Packages');
  lines.push('');
  lines.push('| Package | Kind | Stability | Spec | Depends on |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const { dir, manifest } of items) {
    const pkgDir = relative(REPO_ROOT, dir);
    const specPath = manifest.specEntry.startsWith('../../')
      ? manifest.specEntry.replace('../../', '../../')
      : manifest.specEntry;
    // Resolve specEntry (relative to manifest dir) into a path from docs/architecture/
    const specFromManifestDir = join(dir, manifest.specEntry);
    const specFromIndex = relative(join(REPO_ROOT, 'docs', 'architecture'), specFromManifestDir);
    const apDeps = manifest.imports
      .filter((d) => d.startsWith('@agenticprimitives/'))
      .map((d) => `\`${d.replace('@agenticprimitives/', '')}\``);
    const depsStr = apDeps.length > 0 ? apDeps.join(', ') : '_none_';
    lines.push(
      `| \`${manifest.name}\` | ${manifest.kind} | ${manifest.stability} | [${manifest.specEntry.split('/').pop()}](${specFromIndex}) | ${depsStr} |`,
    );
  }
  lines.push('');
  lines.push('## Per-package summaries');
  lines.push('');
  for (const { dir, manifest } of items) {
    lines.push(`### \`${manifest.name}\``);
    lines.push('');
    lines.push(manifest.summary);
    lines.push('');
    lines.push('**Public exports** (' + manifest.publicExports.length + '): ' +
      manifest.publicExports.map((e) => `\`${e}\``).join(', '));
    lines.push('');
    const claudeMd = relative(join(REPO_ROOT, 'docs', 'architecture'), join(dir, 'CLAUDE.md'));
    const pkgDir = relative(join(REPO_ROOT, 'docs', 'architecture'), dir);
    lines.push(`**Read first:** [\`CLAUDE.md\`](${claudeMd}) · [\`capability.manifest.json\`](${pkgDir}/capability.manifest.json) · [\`src/index.ts\`](${pkgDir}/src/index.ts)`);
    lines.push('');
  }
  lines.push('## Dependency graph');
  lines.push('');
  lines.push('```');
  for (const { manifest } of items) {
    const apDeps = manifest.imports.filter((d) => d.startsWith('@agenticprimitives/'));
    if (apDeps.length === 0) {
      lines.push(`${manifest.name.replace('@agenticprimitives/', '').padEnd(20)} (leaf)`);
    } else {
      const deps = apDeps.map((d) => d.replace('@agenticprimitives/', '')).join(', ');
      lines.push(`${manifest.name.replace('@agenticprimitives/', '').padEnd(20)} → ${deps}`);
    }
  }
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const checkMode = process.argv.includes('--check');
  const items = loadManifests();
  const next = renderIndex(items);

  mkdirSync(join(REPO_ROOT, 'docs', 'architecture'), { recursive: true });

  if (checkMode) {
    if (!existsSync(OUTPUT_PATH)) {
      console.error('capability-index.md does not exist; run `pnpm generate:capability-index`');
      process.exit(1);
    }
    const current = readFileSync(OUTPUT_PATH, 'utf8');
    if (current !== next) {
      console.error('capability-index.md is stale; run `pnpm generate:capability-index`');
      process.exit(1);
    }
    console.log('capability-index.md is up to date.');
    return;
  }

  writeFileSync(OUTPUT_PATH, next, 'utf8');
  console.log(`wrote ${relative(REPO_ROOT, OUTPUT_PATH)} (${items.length} packages)`);
}

main();
