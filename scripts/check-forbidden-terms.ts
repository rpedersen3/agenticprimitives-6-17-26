/**
 * check-forbidden-terms.ts
 *
 * For each packages/<name>/, reads capability.manifest.json:forbiddenTerms
 * and greps src/ for each term (case-insensitive, word-boundary). Fails CI
 * with file:line locations if any term appears in a file that isn't in
 * `allowInPaths`.
 *
 * Catches vocabulary drift across package boundaries — per spec 100/102
 * and the user's pain point from prior monorepo drift.
 *
 * Usage:
 *   pnpm check:forbidden-terms
 *   pnpm check:forbidden-terms --package delegation     # one package only
 *   pnpm check:forbidden-terms --quiet                  # only print failures
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

interface ForbiddenTerm {
  term: string;
  reason: string;
  owningPackage?: string;
  allowInPaths?: string[];
}

interface Manifest {
  name: string;
  forbiddenTerms?: ForbiddenTerm[];
  owns?: { source?: string[]; tests?: string[] };
}

interface Hit {
  pkg: string;
  file: string;        // relative to package root
  line: number;
  col: number;
  term: string;
  reason: string;
  owningPackage?: string;
  snippet: string;
}

const args = process.argv.slice(2);
const targetPackage = (() => {
  const i = args.indexOf('--package');
  return i >= 0 ? args[i + 1] : null;
})();
const quiet = args.includes('--quiet');
const includeDocs = args.includes('--with-docs');

function loadManifests(): Array<{ dir: string; manifest: Manifest }> {
  const result: Array<{ dir: string; manifest: Manifest }> = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    if (targetPackage && entry !== targetPackage) continue;
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'capability.manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    result.push({ dir, manifest });
  }
  return result;
}

// Default: scan source code only. Docs (CLAUDE.md, README.md, spec.md) legitimately
// discuss neighbor concepts to route agents away from them — those mentions are
// routing aids, not drift sites. Pass --with-docs to extend scanning to .md.
const SCAN_EXTS_CODE = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SCAN_EXTS_DOCS = new Set(['.md', '.mdx']);
const IGNORE_DIRS = new Set(['dist', 'node_modules', 'coverage', '.tmp', 'test', '_archive', 'docs']);
const SOURCE_DIRS = new Set(['src']);

function* walk(dir: string, root: string, atRoot = true): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    if (IGNORE_DIRS.has(entry)) continue;
    // At the package root, only descend into src/ unless --with-docs is set.
    if (atRoot && !includeDocs) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory() && !SOURCE_DIRS.has(entry)) continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full, root, false);
    } else {
      const ext = entry.includes('.') ? entry.slice(entry.lastIndexOf('.')) : '';
      const wanted = includeDocs ? new Set([...SCAN_EXTS_CODE, ...SCAN_EXTS_DOCS]) : SCAN_EXTS_CODE;
      if (wanted.has(ext)) yield relative(root, full);
    }
  }
}

function isAllowed(relPath: string, allowInPaths: string[] | undefined): boolean {
  if (!allowInPaths) return false;
  return allowInPaths.some((pattern) => {
    // Simple match: exact path or "<name>" matches any segment.
    if (pattern === relPath) return true;
    // glob-lite: '**' supported as "any depth"
    const re = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) =>
            seg === '**'
              ? '.*'
              : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'),
          )
          .join('/') +
        '$',
    );
    return re.test(relPath);
  });
}

function scanFile(absPath: string, relPath: string, pkg: string, terms: ForbiddenTerm[]): Hit[] {
  const hits: Hit[] = [];
  const text = readFileSync(absPath, 'utf8');
  const lines = text.split('\n');
  for (const { term, reason, owningPackage, allowInPaths } of terms) {
    if (isAllowed(relPath, allowInPaths)) continue;
    // Word-boundary, case-insensitive. For multi-word terms we still bound at start/end.
    const escaped = term.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gi');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        hits.push({
          pkg,
          file: relPath,
          line: i + 1,
          col: m.index + 1,
          term,
          reason,
          owningPackage,
          snippet: line.trim().slice(0, 140),
        });
      }
    }
  }
  return hits;
}

function main() {
  const manifests = loadManifests();
  if (manifests.length === 0) {
    console.error(targetPackage
      ? `No package matched --package ${targetPackage}.`
      : 'No manifests found in packages/.');
    process.exit(2);
  }

  const allHits: Hit[] = [];
  let scanned = 0;

  for (const { dir, manifest } of manifests) {
    const terms = manifest.forbiddenTerms ?? [];
    if (terms.length === 0) {
      if (!quiet) console.log(`${manifest.name}: no forbiddenTerms declared, skipping.`);
      continue;
    }
    for (const relPath of walk(dir, dir)) {
      // Skip the manifest itself — it legitimately mentions its own forbidden terms.
      if (relPath === 'capability.manifest.json') continue;
      const abs = join(dir, relPath);
      scanned += 1;
      const fileHits = scanFile(abs, relPath, manifest.name, terms);
      allHits.push(...fileHits);
    }
  }

  if (allHits.length === 0) {
    console.log(`✓ check:forbidden-terms passed (${manifests.length} packages, ${scanned} files scanned).`);
    process.exit(0);
  }

  // Group hits by package + file
  console.error(`✗ check:forbidden-terms FAILED: ${allHits.length} hit(s) across ${new Set(allHits.map((h) => h.pkg)).size} package(s).`);
  console.error('');
  let lastPkg = '';
  let lastFile = '';
  for (const h of allHits) {
    if (h.pkg !== lastPkg) {
      console.error(`\n  ${h.pkg}`);
      lastPkg = h.pkg;
      lastFile = '';
    }
    if (h.file !== lastFile) {
      console.error(`    ${h.file}`);
      lastFile = h.file;
    }
    const where = h.owningPackage ? ` (owned by ${h.owningPackage})` : '';
    console.error(`      ${h.line}:${h.col}  '${h.term}'${where}`);
    console.error(`        reason: ${h.reason}`);
    if (!quiet) console.error(`        in:     ${h.snippet}`);
  }
  console.error('');
  console.error('To fix: route the change to the owning package, or rename the local concept.');
  console.error('If the term is legitimate here (e.g., in spec.md or README.md):');
  console.error('  add the file path to that term\'s "allowInPaths" in capability.manifest.json.');
  process.exit(1);
}

main();
