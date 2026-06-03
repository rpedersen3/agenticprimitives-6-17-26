/**
 * check:no-stub-publish  (RW1-5 / ADR-0028 enforcement)
 *
 * A package whose version is a `-stub` prerelease (`0.0.0-stub.0`, …) exists for the
 * dependency graph + type surface only — its runtime authority surfaces are not implemented
 * yet (payments rails, resolver engine, fulfillment persistence, full VC verification, …). It
 * MUST NOT be publishable until it graduates past `foundational` (see ADR-0028 + the W1
 * product-readiness review RW1-5).
 *
 * Enforcement: a stub-versioned package MUST be `"private": true` so npm / the OIDC publish
 * workflow skips it. To graduate, drop the `-stub` version AND flip `private` to false in the
 * SAME change that lands the package's invariant test suite.
 *
 * This runs in `check:all-publish` so a stub can never accidentally ship.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = join(ROOT, 'packages');

const violations: string[] = [];
let stubsFound = 0;

for (const name of readdirSync(PKGS)) {
  const pj = join(PKGS, name, 'package.json');
  if (!existsSync(pj)) continue;
  const m = JSON.parse(readFileSync(pj, 'utf8')) as { name?: string; version?: string; private?: boolean };
  if (!m.version || !/-stub(\.|$)/.test(m.version)) continue;
  stubsFound++;
  if (m.private !== true) {
    violations.push(
      `  ${m.name ?? name} @ ${m.version} is publishable (private != true). ` +
        `A stub-versioned package must be "private": true until it graduates (ADR-0028 / RW1-5).`,
    );
  }
}

if (violations.length > 0) {
  console.error('✗ check:no-stub-publish FAILED — stub package(s) are publishable:\n');
  console.error(violations.join('\n'));
  console.error(
    '\nFix: set "private": true on each, OR graduate it (drop the -stub version + add its invariant\n' +
      'suite in the same change). See docs/architecture/decisions/0028-accepted-testnet-posture.md.',
  );
  process.exit(1);
}

console.log(`✓ check:no-stub-publish passed (${stubsFound} stub package(s); all are private / non-publishable).`);
