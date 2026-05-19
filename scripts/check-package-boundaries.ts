/**
 * check-package-boundaries.ts
 *
 * For each packages/<name>/src/**\/*.ts, extracts import paths and verifies:
 *   1. No imports from apps/*.
 *   2. No imports matching manifest.forbiddenImports.
 *   3. No deep imports across @agenticprimitives/* packages
 *      (e.g. '@agenticprimitives/delegation/internal/foo' is forbidden;
 *       only top-level and declared subpaths are permitted).
 *   4. Non-relative npm imports must be in manifest.allowedImports OR be
 *      a node: built-in.
 *
 * Per spec 102 §5.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

interface Manifest {
  name: string;
  allowedImports: string[];
  forbiddenImports: string[];
}

interface ImportHit {
  pkg: string;
  file: string;
  line: number;
  spec: string;
  rule: string;
}

const IGNORE_DIRS = new Set(['dist', 'node_modules', 'coverage', '.tmp']);

function* walkTs(dir: string, root: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walkTs(full, root);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      yield relative(root, full);
    }
  }
}

function extractImports(text: string): Array<{ spec: string; line: number }> {
  const out: Array<{ spec: string; line: number }> = [];
  const lines = text.split('\n');
  // Match `import ... from 'x'` and `export ... from 'x'`, also dynamic `import('x')`.
  const re = /(?:^|\s)(?:import|export)\b[^'"`;]*?from\s+['"`]([^'"`]+)['"`]|import\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(lines[i] ?? '')) !== null) {
      const spec = m[1] ?? m[2];
      if (spec) out.push({ spec, line: i + 1 });
    }
  }
  return out;
}

function isAllowedNpm(spec: string, allowed: string[]): boolean {
  // node: built-ins always allowed
  if (spec.startsWith('node:')) return true;
  // Relative imports always allowed (we handle deep cross-package separately)
  if (spec.startsWith('.') || spec.startsWith('/')) return true;
  // Match exact or scope-prefix:
  for (const a of allowed) {
    if (spec === a) return true;
    if (spec.startsWith(`${a}/`)) return true;
  }
  return false;
}

function isForbidden(spec: string, forbidden: string[]): string | null {
  for (const f of forbidden) {
    // Handle wildcards in forbiddenImports (e.g., "apps/*")
    if (f.endsWith('/*')) {
      const prefix = f.slice(0, -2);
      if (spec === prefix || spec.startsWith(`${prefix}/`)) return f;
    } else if (spec === f || spec.startsWith(`${f}/`)) {
      return f;
    }
  }
  return null;
}

function isDeepApImport(spec: string, allowedImports: string[]): boolean {
  // @agenticprimitives/X/Y/Z — verify Y is a top-level declared subpath
  if (!spec.startsWith('@agenticprimitives/')) return false;
  const parts = spec.split('/');
  if (parts.length <= 2) return false; // just '@agenticprimitives/X' is fine
  // The base + first subpath segment must be in allowedImports
  const baseWithSubpath = parts.slice(0, 3).join('/');
  // If exactly that prefix is in allowed, accept (e.g., '@agenticprimitives/key-custody/mac').
  if (allowedImports.includes(baseWithSubpath)) return false;
  // Otherwise, allowedImports must declare the base only ('@agenticprimitives/key-custody')
  // and we need to check whether ./mac is a documented subpath.
  // For v0, if not explicitly listed, treat as deep import.
  return !allowedImports.some((a) => a === baseWithSubpath || a.startsWith(`${baseWithSubpath}/`));
}

function main() {
  const hits: ImportHit[] = [];
  let pkgCount = 0;
  let fileCount = 0;

  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'capability.manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    pkgCount += 1;

    const srcDir = join(dir, 'src');
    if (!existsSync(srcDir)) continue;

    for (const relFile of walkTs(srcDir, dir)) {
      fileCount += 1;
      const text = readFileSync(join(dir, relFile), 'utf8');
      const imports = extractImports(text);
      for (const { spec, line } of imports) {
        const push = (rule: string) =>
          hits.push({ pkg: manifest.name, file: relFile, line, spec, rule });

        // Rule 1: no apps/* imports
        if (spec === 'apps' || spec.startsWith('apps/')) {
          push('forbidden: apps/* imports not allowed');
          continue;
        }

        // Rule 2: forbiddenImports list
        const forbiddenMatch = isForbidden(spec, manifest.forbiddenImports ?? []);
        if (forbiddenMatch) {
          push(`forbidden by manifest.forbiddenImports (rule "${forbiddenMatch}")`);
          continue;
        }

        // Rule 3: no deep imports across @agenticprimitives/*
        if (isDeepApImport(spec, manifest.allowedImports ?? [])) {
          push(`deep import across @agenticprimitives/* not permitted (use only declared subpaths)`);
          continue;
        }

        // Rule 4: must be in allowedImports (or node: / relative)
        if (!isAllowedNpm(spec, manifest.allowedImports ?? [])) {
          push(`import "${spec}" is not in manifest.allowedImports`);
          continue;
        }
      }
    }
  }

  if (hits.length === 0) {
    console.log(`✓ check:package-boundaries passed (${pkgCount} packages, ${fileCount} files scanned).`);
    process.exit(0);
  }

  console.error(`✗ check:package-boundaries FAILED: ${hits.length} violation(s).`);
  let lastPkg = '';
  let lastFile = '';
  for (const h of hits) {
    if (h.pkg !== lastPkg) {
      console.error(`\n  ${h.pkg}`);
      lastPkg = h.pkg;
      lastFile = '';
    }
    if (h.file !== lastFile) {
      console.error(`    ${h.file}`);
      lastFile = h.file;
    }
    console.error(`      ${h.line}  '${h.spec}'`);
    console.error(`        ${h.rule}`);
  }
  process.exit(1);
}

main();
