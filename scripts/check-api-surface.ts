#!/usr/bin/env tsx
/**
 * check-api-surface.ts — H7-E.8 / EXT3-003 closure.
 *
 * Locks the PUBLIC API surface of every TS package. For each package:
 *   1. Reads `dist/index.d.ts` (must be built).
 *   2. Extracts top-level `export …` declarations, normalizing to a
 *      stable `<name>: <signature>` line.
 *   3. Compares to `api-surface.snap` in the package root.
 *   4. Fails if drift (added / removed / changed exports).
 *
 * The baseline is intentionally TEXT (not a JSON blob) so PR reviewers
 * see diffs in the natural form: a removed line is a deletion, a
 * changed signature is a one-line replace. Adding a new export is a
 * single line addition.
 *
 * To accept new public surface intentionally:
 *   pnpm check:api-surface --update
 *
 * which re-writes every `api-surface.snap`. Review the diff carefully:
 *   - Added line  → new public symbol (verify intentional + documented).
 *   - Removed line → breaking change (semver-major; verify migration plan).
 *   - Changed line → breaking change unless purely additive (e.g. new
 *                    optional field at end of signature).
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const UPDATE = process.argv.includes('--update');

/**
 * Walk a `.d.ts` source and extract top-level export declarations.
 *
 * Heuristic — we don't need the TypeScript compiler API for the
 * regression-guard use case; a focused regex sweep gives a stable
 * surface line per export and the right cadence for snapshot review.
 * Each export becomes ONE LINE in the surface.
 */
function extractSurface(dts: string): string[] {
  const lines: string[] = [];

  // 1. Re-exports: `export { foo, bar as baz, type Quux } from './…';`
  for (const m of dts.matchAll(/^export\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?$/gm)) {
    const names = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const norm = n.replace(/^\s*type\s+/, '').trim();
      lines.push(`re-export ${norm} from ${m[2]}`);
    }
  }

  // 2. Direct value exports — function / class / const / let.
  for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?function\s+(\w+)([^{;]*)[;{]/gm)) {
    lines.push(`function ${m[1]}${m[2]!.trim().replace(/\s+/g, ' ')}`);
  }
  for (const m of dts.matchAll(/^export\s+(?:abstract\s+)?class\s+(\w+)([^{]*)\{/gm)) {
    lines.push(`class ${m[1]}${m[2]!.trim().replace(/\s+/g, ' ')}`);
  }
  for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:const|let|var)\s+(\w+)\s*:([^;=]+)[;=]/gm)) {
    lines.push(`const ${m[1]}: ${m[2]!.trim().replace(/\s+/g, ' ')}`);
  }

  // 3. Type exports — type alias / interface / enum.
  for (const m of dts.matchAll(/^export\s+(?:declare\s+)?type\s+(\w+)([^=]*)=\s*([^;]+);/gm)) {
    lines.push(`type ${m[1]}${m[2]!.trim()} = ${m[3]!.trim().replace(/\s+/g, ' ')}`);
  }
  for (const m of dts.matchAll(/^export\s+(?:declare\s+)?interface\s+(\w+)([^{]*)\{/gm)) {
    lines.push(`interface ${m[1]}${m[2]!.trim().replace(/\s+/g, ' ')}`);
  }
  for (const m of dts.matchAll(/^export\s+(?:declare\s+)?enum\s+(\w+)\s*\{/gm)) {
    lines.push(`enum ${m[1]}`);
  }

  return [...new Set(lines)].sort();
}

function snapPath(pkgDir: string): string {
  return join(pkgDir, 'api-surface.snap');
}

function readDts(pkgDir: string): string | null {
  const candidates = [
    join(pkgDir, 'dist', 'index.d.ts'),
    join(pkgDir, 'dist', 'src', 'index.d.ts'),
  ];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, 'utf8');
  return null;
}

function main(): void {
  const pkgs = readdirSync(PACKAGES_DIR).filter((e) => {
    const d = join(PACKAGES_DIR, e);
    if (!statSync(d).isDirectory()) return false;
    const manifest = join(d, 'capability.manifest.json');
    if (!existsSync(manifest)) return false;
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    return m.kind !== 'contracts';
  });

  let drifted = 0;
  let updated = 0;
  let missing = 0;

  for (const name of pkgs) {
    const pkgDir = join(PACKAGES_DIR, name);
    const dts = readDts(pkgDir);
    if (dts === null) {
      console.error(`  ! ${name}: no dist/index.d.ts — run \`pnpm -r build\` first`);
      missing += 1;
      continue;
    }

    const surface = extractSurface(dts);
    const expected = surface.join('\n') + '\n';
    const sPath = snapPath(pkgDir);
    const actual = existsSync(sPath) ? readFileSync(sPath, 'utf8') : null;

    if (actual === null) {
      if (UPDATE) {
        writeFileSync(sPath, expected);
        console.log(`  + ${name}: api-surface.snap CREATED (${surface.length} exports)`);
        updated += 1;
      } else {
        console.error(
          `  ✗ ${name}: api-surface.snap is missing. Run \`pnpm check:api-surface --update\` to create it.`,
        );
        drifted += 1;
      }
      continue;
    }

    if (actual === expected) {
      console.log(`  ✓ ${name}: ${surface.length} exports`);
      continue;
    }

    if (UPDATE) {
      writeFileSync(sPath, expected);
      console.log(`  ~ ${name}: api-surface.snap UPDATED`);
      updated += 1;
      continue;
    }

    drifted += 1;
    console.error(`  ✗ ${name}: api-surface drift`);
    const actualLines = actual.split('\n').filter(Boolean);
    const newLines = surface;
    const removed = actualLines.filter((l) => !newLines.includes(l));
    const added = newLines.filter((l) => !actualLines.includes(l));
    for (const l of removed) console.error(`        - ${l}`);
    for (const l of added) console.error(`        + ${l}`);
    console.error(
      `      (run \`pnpm check:api-surface --update\` if intentional, then verify the diff in your PR.)`,
    );
  }

  if (missing > 0 || drifted > 0) {
    console.error(`\n✗ check:api-surface FAILED: ${drifted} drifted, ${missing} missing dist/.`);
    process.exit(1);
  }

  if (UPDATE) {
    console.log(`\n✓ check:api-surface ${updated} snapshot(s) updated.`);
  } else {
    console.log(`\n✓ check:api-surface passed (${pkgs.length} packages).`);
  }
}

main();
