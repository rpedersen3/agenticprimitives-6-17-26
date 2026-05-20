/**
 * audit-supply-chain.ts
 *
 * Local-dev mirror of the CI security workflow (audit M7). Run before
 * pushing to surface issues the workflow would catch.
 *
 * Each check is a separate concern; failures are reported individually
 * and the script exits non-zero if ANY scanner flagged. Use --warn-only
 * to see findings without failing (useful when triaging known issues).
 *
 * Usage:
 *   pnpm check:supply-chain               # run all scanners, fail on any finding
 *   pnpm check:supply-chain --warn-only   # report only; always exit 0
 *
 * What this covers:
 *   - pnpm audit (high/critical CVEs in deps)
 *   - gitleaks (committed secrets) — optional; skipped if `gitleaks`
 *     isn't installed locally
 *
 * What this does NOT cover (CI-only, requires GitHub auth):
 *   - CodeQL SAST (heavyweight; runs in cloud)
 *   - SBOM generation (informational)
 */

import { execSync } from 'node:child_process';

const ARGS = new Set(process.argv.slice(2));
const WARN_ONLY = ARGS.has('--warn-only');

interface Finding {
  scanner: string;
  message: string;
}

const findings: Finding[] = [];

function which(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function run(label: string, cmd: string): void {
  console.log(`\n[supply-chain] ${label}: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`[supply-chain] ✓ ${label} clean`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    findings.push({ scanner: label, message: msg });
    console.error(`[supply-chain] ✗ ${label} flagged`);
  }
}

console.log('[supply-chain] local mirror of the CI security workflow');
console.log(`[supply-chain] mode: ${WARN_ONLY ? 'WARN-ONLY (always exits 0)' : 'STRICT (fails on findings)'}`);

// 1. pnpm audit — high/critical CVEs in deps.
run('pnpm audit', 'pnpm audit --audit-level=high');

// 2. gitleaks — committed secrets. Optional; many devs won't have it
//    installed. CI is the load-bearing check.
if (which('gitleaks')) {
  run('gitleaks', 'gitleaks detect --no-banner --redact');
} else {
  console.log(
    '\n[supply-chain] gitleaks not installed locally — skipping. ' +
      'Install via `brew install gitleaks` or `go install github.com/gitleaks/gitleaks/v8@latest`. ' +
      'CI runs it on every PR regardless.',
  );
}

console.log('');
if (findings.length === 0) {
  console.log('[supply-chain] ✓ all scanners clean');
  process.exit(0);
}

console.error(`[supply-chain] ✗ FAILED: ${findings.length} scanner(s) flagged`);
for (const f of findings) {
  console.error(`  - ${f.scanner}: see output above`);
}
console.error(
  '\nTriage:\n' +
    '  - Dep CVEs: bump the affected package or document an accepted-risk override in docs/audits/supply-chain.md\n' +
    '  - Secrets:  rotate the leaked secret + scrub from git history with git-filter-repo\n' +
    '  - Skip the gate (rare): rerun with --warn-only and open a finding-tracking issue',
);
process.exit(WARN_ONLY ? 0 : 1);
