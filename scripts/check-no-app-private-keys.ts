/**
 * check-no-app-private-keys
 *
 * Doctrine rail: agent code (everything under `apps/`) MUST source signing
 * via @agenticprimitives/key-custody — i.e., a KMS-backed signer. Apps
 * MUST NOT:
 *
 *   - declare or reference a `*_PRIVATE_KEY` env var
 *   - call `privateKeyToAccount(...)` from viem
 *   - call `generatePrivateKey(...)` from viem
 *
 * These patterns indicate the agent is being asked to hold or mint key
 * material directly, which is exactly what KMS removes. Catches the LLM
 * mistake of reaching for `process.env.X_PRIVATE_KEY` when the right move
 * is `createKmsViemAccount(buildSignerBackend({backend:'gcp-kms'}))`.
 *
 * Allowlist captures the one legitimate path: `apps/demo-a2a/src/config.ts`
 * conditionally requires `A2A_MASTER_PRIVATE_KEY` ONLY when
 * `A2A_KMS_BACKEND === 'local-aes'` (dev/local backend). Production
 * deploys use `A2A_KMS_BACKEND=gcp-kms` and don't read this var.
 *
 * Run via `pnpm check:no-app-private-keys` (chained into `check:all`).
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');

interface Rule {
  pattern: RegExp;
  description: string;
}

const RULES: Rule[] = [
  {
    pattern: /\b[A-Z][A-Z0-9_]*_PRIVATE_KEY\b/g,
    description:
      'env-var name containing _PRIVATE_KEY — apps should source signing via KMS (see packages/key-custody), not raw keys',
  },
  {
    pattern: /privateKeyToAccount\s*\(/g,
    description:
      'privateKeyToAccount(...) call — converts a raw private key to a viem Account; key-handling smell in app code',
  },
  {
    pattern: /\bgeneratePrivateKey\s*\(/g,
    description:
      'generatePrivateKey() call — apps should derive identity via KMS, not mint local keys',
  },
];

// Paths (relative to repo root) where a banned pattern is intentional.
// Keep this list extremely narrow + comment WHY each entry is allowed.
const ALLOWED_IN: ReadonlySet<string> = new Set([
  // The local-aes dev backend requires A2A_MASTER_PRIVATE_KEY ONLY when
  // A2A_KMS_BACKEND=local-aes (default for local Anvil + wrangler dev).
  // Production deploys with A2A_KMS_BACKEND=gcp-kms never read this var.
  'apps/demo-a2a/src/config.ts',
  // demo-jp Pete + Jill personas (IA §1 D-1 / demo-jp memory note):
  // for the demo, Pete (custodies Global Church SA) and Jill (custodies JP SA)
  // hold raw EOA private keys in localStorage — DEMO ONLY, intentionally
  // surfaced in the UI per D-1. Production deployments custody org agents
  // via KMS-backed signers (spec 235 google-kms-custody pattern); the
  // personas.ts helper is the testnet-only equivalent. Lives only in the
  // demo-jp app; never imported by packages.
  'apps/demo-jp/src/lib/personas.ts',
  // chain.ts `personaSignHash` converts a Pete/Jill persona's raw EOA key into a
  // viem signer (privateKeyToAccount) to sign as the org/person SA custodian —
  // the SAME testnet-only demo custody path as personas.ts (D-1). Production
  // custodies via KMS-backed signers (spec 235); never imported by packages.
  'apps/demo-jp/src/lib/chain.ts',
  // demo-gs (Global Switchboard) — sibling of demo-jp, SAME accepted testnet
  // demo-key pattern: Pete (Global Church) + Jane (Switchboard) operators and
  // the KC expert personas hold raw EOA keys for the demo; `chain.ts`
  // (personaSignHash) and the substrate seed script convert them to viem signers
  // (privateKeyToAccount). DEMO/TESTNET ONLY — production custodies org/person
  // agents via KMS-backed signers (spec 235). App-local; never imported by packages.
  'apps/demo-gs/src/lib/personas.ts',
  'apps/demo-gs/src/lib/chain.ts',
  'apps/demo-gs/scripts/seed-substrate.ts',
]);

// Env-var names that are tolerated EVERYWHERE in apps/. Reserved for the
// one well-understood dev-only secret name. Adding to this list is the
// architectural decision: "this name is OK to reference in app code."
// Defaults to ZERO additions beyond the legacy local-aes dev path.
const TOLERATED_ENV_NAMES: ReadonlySet<string> = new Set([
  // A2A_MASTER_PRIVATE_KEY: the local-aes dev backend's signing key.
  // Read by packages/key-custody/src/providers/local.ts via process.env.
  // Apps (demo-a2a) declare it in their Env interface + mirror it from
  // wrangler env into process.env. NOT used when A2A_KMS_BACKEND=gcp-kms.
  // Production code paths MUST NOT add new names here.
  'A2A_MASTER_PRIVATE_KEY',
]);

function listAppTsFiles(): string[] {
  const out = execSync('git ls-files apps', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out
    .trim()
    .split('\n')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => !f.includes('/test/') && !f.includes('.test.') && !f.includes('/dist/'));
}

interface Violation {
  file: string;
  line: number;
  match: string;
  reason: string;
}

function scan(files: string[]): Violation[] {
  const out: Violation[] = [];
  for (const file of files) {
    if (ALLOWED_IN.has(file)) continue;
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    const lines = text.split('\n');
    for (const rule of RULES) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment-only or doc-only matches if the whole line is a
        // comment — discussing private keys in a comment is fine.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        rule.pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.pattern.exec(line)) !== null) {
          // Tolerate a small set of dev-only env-var names by exact match.
          // Other patterns (privateKeyToAccount, generatePrivateKey) are
          // never tolerated.
          if (TOLERATED_ENV_NAMES.has(m[0])) continue;
          out.push({ file, line: i + 1, match: m[0], reason: rule.description });
        }
      }
    }
  }
  return out;
}

const files = listAppTsFiles();
const violations = scan(files);

if (violations.length > 0) {
  console.error('✘ check:no-app-private-keys — found banned patterns in apps/:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: "${v.match}"`);
    console.error(`    → ${v.reason}\n`);
  }
  console.error('Fix paths:');
  console.error('  1. Route signing through @agenticprimitives/key-custody:');
  console.error('       const backend = buildSignerBackend({ backend: "gcp-kms" });');
  console.error('       const account = await createKmsViemAccount(backend);');
  console.error('       // pass account to viem.writeContract / sendTransaction.');
  console.error('  2. If this is a legitimate dev-only backend path, add the file');
  console.error('     to ALLOWED_IN in scripts/check-no-app-private-keys.ts WITH');
  console.error('     a comment explaining the conditional gating.');
  process.exit(1);
}

console.log(
  `✓ check:no-app-private-keys passed (${files.length} app source files scanned, no private-key smells).`,
);
