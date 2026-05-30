/**
 * check-public-exports.ts
 *
 * For each packages/<name>/, verifies that every symbol declared in
 * manifest.publicExports is actually exported from src/index.ts (top level),
 * and reports any top-level exports NOT in publicExports.
 *
 * This catches:
 *   - Symbol renamed in source but not in manifest (or vice versa)
 *   - Accidentally-exported internal symbols
 *   - Deleted exports still listed in the manifest
 *
 * Per spec 102 §5.
 *
 * NOTE: Uses regex-based extraction (good-enough for our hand-authored
 * src/index.ts files, all of which use a small set of declarative forms).
 * Edge cases (re-export aggregation, namespace exports) are documented and
 * tolerated.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

interface Manifest {
  name: string;
  kind?: 'capability' | 'shared' | 'adapter' | 'contracts';
  publicEntry: string;
  publicExports: string[];
}

interface MismatchPair {
  pkg: string;
  missing: string[];   // in manifest but not in src
  extra: string[];     // in src but not in manifest
}

/** Extract top-level export identifiers from a TypeScript source file. */
function extractExports(src: string): Set<string> {
  const out = new Set<string>();

  // Strip block + line comments to avoid false positives.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  // 1. export (declare)? (const|let|var|function|class|interface|type|enum) Name
  const decl =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(stripped)) !== null) {
    out.add(m[1]!);
  }

  // 2. export { A, B as C } [from '...']
  const namedRe = /export\s*(?:type\s*)?\{([^}]+)\}/g;
  while ((m = namedRe.exec(stripped)) !== null) {
    const list = m[1] ?? '';
    for (const part of list.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // "Name as Alias" → Alias; "Name" → Name; "type Name" → Name
      const asMatch = trimmed.match(/^(?:type\s+)?[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (asMatch) {
        out.add(asMatch[1]!);
        continue;
      }
      const plain = trimmed.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)/);
      if (plain) out.add(plain[1]!);
    }
  }

  // 3. export default — special; we treat "default" as the name and recommend not using
  if (/export\s+default\s+/.test(stripped)) {
    out.add('default');
  }

  // 4. export * as Name from '...'  (namespace re-export)
  const nsRe = /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g;
  while ((m = nsRe.exec(stripped)) !== null) {
    out.add(m[1]!);
  }

  // (Note: bare `export * from '...'` aggregates everything; we cannot resolve
  // those without following the path. We tolerate them as "intentional aggregator"
  // — the manifest's publicExports is still the contract.)

  return out;
}

function main() {
  const mismatches: MismatchPair[] = [];
  let pkgCount = 0;

  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'capability.manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    // Solidity-only packages (kind: "contracts") publish JSON ABIs, not TS
    // symbols. No `src/index.ts` to scan; the publicExports list is the
    // ABI manifest itself, and `check:capability-manifests` validates it.
    if (manifest.kind === 'contracts') continue;
    const indexPath = join(dir, manifest.publicEntry);
    if (!existsSync(indexPath)) continue;
    pkgCount += 1;

    const declared = new Set(manifest.publicExports ?? []);
    const actual = extractExports(readFileSync(indexPath, 'utf8'));

    const missing = [...declared].filter((s) => !actual.has(s));
    const extra = [...actual].filter((s) => !declared.has(s));

    if (missing.length > 0 || extra.length > 0) {
      mismatches.push({ pkg: manifest.name, missing, extra });
    }
  }

  if (mismatches.length === 0) {
    console.log(`✓ check:public-exports passed (${pkgCount} packages).`);
    process.exit(0);
  }

  console.error(`✗ check:public-exports FAILED: ${mismatches.length} package(s) with drift.`);
  for (const { pkg, missing, extra } of mismatches) {
    console.error(`\n  ${pkg}`);
    if (missing.length > 0) {
      console.error(`    missing from src/index.ts (declared in manifest):`);
      for (const s of missing) console.error(`      - ${s}`);
    }
    if (extra.length > 0) {
      console.error(`    exported by src/index.ts but NOT in manifest.publicExports:`);
      for (const s of extra) console.error(`      + ${s}`);
    }
  }
  console.error('');
  console.error('Either:');
  console.error('  - update manifest.publicExports to match src/index.ts, OR');
  console.error('  - remove the accidental export from src/index.ts (likely safer).');
  process.exit(1);
}

main();
