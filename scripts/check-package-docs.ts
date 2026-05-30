/**
 * check-package-docs.ts
 *
 * Verifies every packages/<name>/ has the required files.
 *
 * Two profiles, discriminated by `capability.manifest.json:kind`:
 *
 *   kind: "capability"  (default — TypeScript package)
 *     - package.json
 *     - capability.manifest.json
 *     - CLAUDE.md
 *     - README.md
 *     - AUDIT.md
 *     - spec.md
 *     - tsconfig.json
 *     - src/index.ts
 *
 *   kind: "contracts"   (Solidity-only package — no TS)
 *     - package.json
 *     - capability.manifest.json
 *     - CLAUDE.md
 *     - README.md
 *     - AUDIT.md
 *     - spec.md
 *     - foundry.toml
 *     - remappings.txt
 *
 * Per spec 102 §1 + spec 100 §8 + H7-A.4 closure.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const REQUIRED_TS = [
  'package.json',
  'capability.manifest.json',
  'CLAUDE.md',
  'README.md',
  'AUDIT.md',
  'spec.md',
  'tsconfig.json',
  'src/index.ts',
];

const REQUIRED_CONTRACTS = [
  'package.json',
  'capability.manifest.json',
  'CLAUDE.md',
  'README.md',
  'AUDIT.md',
  'spec.md',
  'foundry.toml',
  'remappings.txt',
];

function requiredFilesFor(pkgDir: string): string[] {
  const manifestPath = join(pkgDir, 'capability.manifest.json');
  if (!existsSync(manifestPath)) return REQUIRED_TS; // default; missing manifest will be caught
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.kind === 'contracts') return REQUIRED_CONTRACTS;
  } catch {
    /* fall through */
  }
  return REQUIRED_TS;
}

function main() {
  const dirs = readdirSync(PACKAGES_DIR).filter((e) => {
    const full = join(PACKAGES_DIR, e);
    return statSync(full).isDirectory();
  });

  if (dirs.length === 0) {
    console.error('No packages found.');
    process.exit(2);
  }

  const missing: Array<{ pkg: string; file: string }> = [];
  for (const name of dirs) {
    const dir = join(PACKAGES_DIR, name);
    const required = requiredFilesFor(dir);
    for (const file of required) {
      if (!existsSync(join(dir, file))) missing.push({ pkg: name, file });
    }
  }

  if (missing.length === 0) {
    console.log(`✓ check:package-docs passed (${dirs.length} packages).`);
    process.exit(0);
  }

  console.error(`✗ check:package-docs FAILED: ${missing.length} missing file(s).`);
  let lastPkg = '';
  for (const m of missing) {
    if (m.pkg !== lastPkg) {
      console.error(`\n  packages/${m.pkg}`);
      lastPkg = m.pkg;
    }
    console.error(`    missing: ${m.file}`);
  }
  process.exit(1);
}

main();
