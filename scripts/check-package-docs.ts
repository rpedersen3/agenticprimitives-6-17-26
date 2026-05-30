/**
 * check-package-docs.ts
 *
 * Verifies every packages/<name>/ has the required files:
 *   - package.json
 *   - capability.manifest.json
 *   - CLAUDE.md
 *   - README.md
 *   - AUDIT.md          ← required per spec 100 §8 + H7-A.4 closure
 *   - spec.md
 *   - tsconfig.json
 *   - src/index.ts
 *
 * Per spec 102 §1 + spec 100 §8.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const REQUIRED_FILES = [
  'package.json',
  'capability.manifest.json',
  'CLAUDE.md',
  'README.md',
  'AUDIT.md',
  'spec.md',
  'tsconfig.json',
  'src/index.ts',
];

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
    for (const file of REQUIRED_FILES) {
      if (!existsSync(join(dir, file))) missing.push({ pkg: name, file });
    }
  }

  if (missing.length === 0) {
    console.log(`✓ check:package-docs passed (${dirs.length} packages, ${REQUIRED_FILES.length} files each).`);
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
