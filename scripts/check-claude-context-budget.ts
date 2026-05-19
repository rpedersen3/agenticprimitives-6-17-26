/**
 * check-claude-context-budget.ts
 *
 * Verifies each packages/<name>/ keeps CLAUDE.md, README.md, and (optionally)
 * docs/architecture.md within the word-count limits declared in
 * capability.manifest.json:contextBudget.
 *
 * Words = whitespace-split tokens, excluding fenced code blocks. Code in
 * fenced blocks isn't counted because it's not consuming "explanation" budget.
 *
 * Per spec 102 §5.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

interface Manifest {
  name: string;
  contextBudget: {
    claudeMdMaxWords: number;
    readmeMaxWords: number;
    architectureMaxWords: number;
  };
}

function countWords(text: string): number {
  // Strip fenced code blocks (``` ... ```).
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  // Strip inline code (`...`) — also not counted.
  const cleaner = stripped.replace(/`[^`]*`/g, '');
  return cleaner.split(/\s+/).filter((t) => t.length > 0).length;
}

interface Hit {
  pkg: string;
  file: string;
  words: number;
  budget: number;
}

function main() {
  const hits: Hit[] = [];
  let scanned = 0;

  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'capability.manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

    const checks: Array<{ file: string; budget: number }> = [
      { file: 'CLAUDE.md', budget: manifest.contextBudget.claudeMdMaxWords },
      { file: 'README.md', budget: manifest.contextBudget.readmeMaxWords },
      { file: 'docs/architecture.md', budget: manifest.contextBudget.architectureMaxWords },
    ];

    for (const { file, budget } of checks) {
      const path = join(dir, file);
      if (!existsSync(path)) continue; // architecture.md is optional
      scanned += 1;
      const words = countWords(readFileSync(path, 'utf8'));
      if (words > budget) {
        hits.push({ pkg: manifest.name, file, words, budget });
      }
    }
  }

  if (hits.length === 0) {
    console.log(`✓ check:claude-context-budget passed (${scanned} doc files within budget).`);
    process.exit(0);
  }

  console.error(`✗ check:claude-context-budget FAILED: ${hits.length} file(s) over budget.`);
  for (const h of hits) {
    const over = h.words - h.budget;
    console.error(`  ${h.pkg}: ${h.file}`);
    console.error(`    words: ${h.words}  budget: ${h.budget}  over by: ${over}`);
  }
  console.error('');
  console.error('Either trim the doc or bump the budget in capability.manifest.json:contextBudget.');
  console.error('Trim first; bumping the budget is a doctrine smell.');
  process.exit(1);
}

main();
