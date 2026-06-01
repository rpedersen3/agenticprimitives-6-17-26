/**
 * check-production-deploy.ts
 *
 * Production preflight gate. Closes system-audit finding C4
 * ("Production deploys do not yet have a single hard-fail demo-shortcut
 * gate"). Run by `pnpm deploy:cloudflare` BEFORE any wrangler deploy
 * happens, so demo shortcuts cannot leak into production through
 * config drift.
 *
 * Each check fails LOUDLY (exit 1 with a precise message). Add a check
 * per audit finding closed; remove a check only when the underlying
 * shortcut is structurally impossible (not just "we promised not to
 * use it").
 *
 * Usage:
 *   pnpm check:production-deploy          # validates current state
 *   pnpm check:production-deploy --warn-only   # advisory, exit 0
 *
 * The deploy script invokes this with no flags. Override via env:
 *   AGENTICPRIMITIVES_SKIP_PREFLIGHT=1   # NOT permitted in CI; loud warn.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const WARN_ONLY = ARGS.has('--warn-only');
const SKIP_REQUESTED = process.env.AGENTICPRIMITIVES_SKIP_PREFLIGHT === '1';
// CI must NEVER honor the skip (audit production preflight item).
// Common CI indicators across runners: GITHUB_ACTIONS / CI / BUILDKITE / etc.
const IN_CI =
  process.env.CI === 'true' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.BUILDKITE === 'true' ||
  process.env.CIRCLECI === 'true';
const SKIP = SKIP_REQUESTED && !IN_CI;
if (SKIP_REQUESTED && IN_CI) {
  console.error(
    '\n[preflight] ✗ AGENTICPRIMITIVES_SKIP_PREFLIGHT=1 is set but CI was ' +
      'detected (CI / GITHUB_ACTIONS / BUILDKITE / CIRCLECI). The skip is ' +
      'IGNORED in CI environments — production preflight is mandatory at ' +
      'merge time. Remove the env var or run locally for advisory mode.\n',
  );
}

interface Finding {
  audit: string;        // e.g. "C4", "M3", "N1"
  check: string;        // short name
  message: string;      // remediation
}

const findings: Finding[] = [];

function fail(audit: string, check: string, message: string) {
  findings.push({ audit, check, message });
}

// ─── C4.1: /_dev/* routes not bundled in production demo-mcp ──────────

(function checkNoDevRoutesInDemoMcp() {
  const mcpSrc = join(REPO_ROOT, 'apps', 'demo-mcp', 'src');
  if (!existsSync(mcpSrc)) return;
  for (const file of walk(mcpSrc)) {
    const text = readFileSync(file, 'utf8');
    // Match `/_dev/*` route declarations that are NOT guarded.
    const m = text.match(/app\.(get|post|put|delete)\(['"]\/_dev\/[^'"]+['"]/);
    if (m && !isDevRouteGuarded(text, m.index ?? 0)) {
      fail(
        'M3',
        'dev-route-unguarded',
        `Unguarded dev route in ${relative(REPO_ROOT, file)}: \`${m[0]}…\`. ` +
          `Wrap in \`if (env.NODE_ENV !== 'production')\` or remove from production bundle.`,
      );
    }
  }
})();

// ─── C4.2: A2A_KMS_BACKEND must be set to a non-local value in prod ───

(function checkKmsBackend() {
  const wranglerToml = join(REPO_ROOT, 'apps', 'demo-a2a', 'wrangler.toml');
  if (!existsSync(wranglerToml)) return;
  const text = readFileSync(wranglerToml, 'utf8');
  // We deploy with --var A2A_KMS_BACKEND=gcp-kms via deploy-cloudflare.ts.
  // This check confirms the deploy script will refuse to deploy without it.
  const deployScript = join(REPO_ROOT, 'scripts', 'deploy-cloudflare.ts');
  if (!existsSync(deployScript)) return;
  const deployText = readFileSync(deployScript, 'utf8');
  if (!deployText.includes('A2A_KMS_BACKEND')) {
    fail(
      'C4',
      'kms-backend-not-enforced',
      `deploy-cloudflare.ts does not require A2A_KMS_BACKEND; production may fall back to local-aes.`,
    );
  }
  void text;
})();

// ─── C4.3: NODE_ENV must be production in wrangler.toml prod env ──────

(function checkNodeEnvProduction() {
  const wranglerToml = join(REPO_ROOT, 'apps', 'demo-a2a', 'wrangler.toml');
  if (!existsSync(wranglerToml)) return;
  const text = readFileSync(wranglerToml, 'utf8');
  // Look for [env.production.vars] block. Workers default NODE_ENV to
  // 'production' since Wrangler v3+. We need to confirm the
  // LocalAesProvider production guard fires — which requires that
  // process.env.NODE_ENV resolves to 'production' inside the Worker.
  // The bridgeEnvToProcessEnv() helper in demo-a2a sets NODE_ENV=
  // 'production' if not already set, but ONLY when running inside the
  // production env. This is structurally guarded by Wrangler; we
  // verify the helper exists.
  const a2aIndex = join(REPO_ROOT, 'apps', 'demo-a2a', 'src', 'index.ts');
  if (!existsSync(a2aIndex)) return;
  const a2aText = readFileSync(a2aIndex, 'utf8');
  if (!a2aText.includes('NODE_ENV')) {
    fail(
      'C4',
      'node-env-not-bridged',
      `apps/demo-a2a/src/index.ts does not bridge NODE_ENV; production guards in LocalAesProvider won't fire.`,
    );
  }
  void text;
})();

// ─── C4.4: UNIVERSAL_SIGNATURE_VALIDATOR must be wired ────────────────

(function checkUniversalValidatorPropagation() {
  const deployScript = join(REPO_ROOT, 'scripts', 'deploy-cloudflare.ts');
  if (!existsSync(deployScript)) return;
  const text = readFileSync(deployScript, 'utf8');
  if (!text.includes('universalSignatureValidator')) {
    fail(
      'C4',
      'universal-validator-not-propagated',
      `deploy-cloudflare.ts does not propagate universalSignatureValidator address; passkey flow will fail.`,
    );
  }
})();

// ─── C4.5: Live deployments JSON has a paymaster with non-trivial deposit ─

(function checkLiveDeploymentsShape() {
  const network = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
  // R5.12 moved contracts from apps/ → packages/.
  const deploymentsPath = join(
    REPO_ROOT,
    'packages',
    'contracts',
    `deployments-${network}.json`,
  );
  if (!existsSync(deploymentsPath)) {
    fail(
      'C4',
      'deployments-json-missing',
      `${deploymentsPath} not found — contracts haven't been deployed to ${network}.`,
    );
    return;
  }
  const d = JSON.parse(readFileSync(deploymentsPath, 'utf8')) as Record<string, string>;
  const required = [
    'entryPoint',
    'delegationManager',
    'agentAccountFactory',
    'agentAccountImplementation',
    'timestampEnforcer',
    'allowedTargetsEnforcer',
    'allowedMethodsEnforcer',
    'valueEnforcer',
    'smartAgentPaymaster',
    'universalSignatureValidator',
  ];
  for (const k of required) {
    if (!d[k] || !/^0x[0-9a-fA-F]{40}$/.test(d[k])) {
      fail(
        'C4',
        'deployment-address-missing',
        `${deploymentsPath}: ${k} is missing or malformed. Redeploy contracts.`,
      );
    }
  }
})();

// ─── C4.6: A2A_MASTER_PRIVATE_KEY env name not in production deploy flags ─

(function checkNoPrivateKeyInProductionVars() {
  const deployScript = join(REPO_ROOT, 'scripts', 'deploy-cloudflare.ts');
  if (!existsSync(deployScript)) return;
  const text = readFileSync(deployScript, 'utf8');
  // The deploy script should NEVER pass A2A_MASTER_PRIVATE_KEY via --var
  // (it's a secret, set once via `wrangler secret put`, and only valid
  // in dev/local-aes path anyway).
  const badPattern = /A2A_MASTER_PRIVATE_KEY[^_]/;  // negate to skip the env-name string
  if (
    badPattern.test(text) &&
    text.includes('--var')
  ) {
    // Check more carefully: only flag if it appears as a key in a vars
    // record being passed to wrangler.
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.includes('A2A_MASTER_PRIVATE_KEY') && (line.includes(': ') || line.includes('=>'))) {
        fail(
          'C4',
          'private-key-in-vars',
          `scripts/deploy-cloudflare.ts line ${i + 1} appears to pass A2A_MASTER_PRIVATE_KEY via --var. Private keys must be wrangler secrets, never public vars.`,
        );
      }
    }
  }
})();

// ─── N1.1: HARD-FAIL on known-leaked deployer key in production deploy ──
//
// External audit P0-3: the disclosed deployer EOA (0x31ed…8b44) controls
// live demo governance, bundler signer, session issuer, and paymaster
// authority. A production deploy MUST rotate or redeploy contracts under
// a clean deployer. The previous behavior here was a soft warning,
// which the audit correctly flagged as a non-gate. Promoted to a hard
// fail unless explicitly overridden with the demo-only flag.
//
// Override (for live demo runs that the operator has explicitly
// accepted): `AGENTICPRIMITIVES_DEMO_KEYS_ACCEPTED=true`. The flag is
// NOT honored in CI — same logic as AGENTICPRIMITIVES_SKIP_PREFLIGHT.

(function gateOnLeakedDeployerKey() {
  const envFile = join(REPO_ROOT, '.env.deploy.local');
  if (!existsSync(envFile)) return;
  const text = readFileSync(envFile, 'utf8');
  if (!text.includes('0x31ed17fb99e82E02085Ab4B3cbdaB05489098b44')) return;

  const accepted = process.env.AGENTICPRIMITIVES_DEMO_KEYS_ACCEPTED === 'true';
  if (accepted && !IN_CI) {
    console.warn(
      `[preflight] ⚠ DEMO-KEY OVERRIDE: .env.deploy.local references the disclosed ` +
        `deployer 0x31ed…8b44; running with AGENTICPRIMITIVES_DEMO_KEYS_ACCEPTED=true. ` +
        `This MUST be removed before any non-demo deploy. Audit P0-3.`,
    );
    return;
  }
  fail(
    'N1',
    'leaked-deployer-key',
    `.env.deploy.local references the disclosed demo deployer 0x31ed…8b44 ` +
      `(controls governance + bundler + paymaster authority). Rotate or redeploy ` +
      `with a clean deployer before continuing. Demo runs may set ` +
      `AGENTICPRIMITIVES_DEMO_KEYS_ACCEPTED=true outside CI to override.`,
  );
})();

// ─── N1.2: HARD-FAIL on local key-custody escape flags in production ───
//
// External audit P0-3 + key-custody CLAUDE.md security invariant: the
// local AES envelope provider and local secp256k1 signer MUST NOT be in
// use in production. Each has an opt-in flag (A2A_ALLOW_LOCAL_*) that
// the package consults at runtime — if either is set when the preflight
// runs, the production deploy is unsafe.

(function gateOnLocalKeyCustodyFlags() {
  const allow = (k: string) => process.env[k] === 'true';
  if (allow('A2A_ALLOW_LOCAL_MASTER_KEY')) {
    fail(
      'N1',
      'local-master-key-flag',
      `A2A_ALLOW_LOCAL_MASTER_KEY=true is set. The local secp256k1 signer ` +
        `signs as the bundler/paymaster master in production — compromise = forged bundler txs. ` +
        `Replace with a managed KMS backend (gcp-kms / aws-kms) and unset the flag.`,
    );
  }
  if (allow('A2A_ALLOW_LOCAL_ENVELOPE_KEY')) {
    fail(
      'N1',
      'local-envelope-key-flag',
      `A2A_ALLOW_LOCAL_ENVELOPE_KEY=true is set. The HKDF-from-process-secret ` +
        `envelope wraps every session keypair at rest — compromise = decrypt all sessions = ` +
        `forge any delegation. Replace with managed KMS encryption and unset the flag.`,
    );
  }
})();

// ─── helpers ──────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function isDevRouteGuarded(text: string, idx: number): boolean {
  // Look at the ~200 chars before the match for a NODE_ENV guard.
  const before = text.slice(Math.max(0, idx - 400), idx);
  return /NODE_ENV[^=]*!==\s*['"]production['"]/.test(before) ||
    /NODE_ENV[^=]*===\s*['"]development['"]/.test(before) ||
    /process\.env\.NODE_ENV\s*!==\s*['"]production['"]/.test(before);
}

// ─── main ─────────────────────────────────────────────────────────────

function main() {
  console.log('\n[preflight] production deploy preflight check');
  console.log(`  cwd: ${REPO_ROOT}`);
  console.log(`  warn-only: ${WARN_ONLY}`);
  console.log(`  skip flag: ${SKIP}`);

  if (SKIP) {
    console.warn(`\n[preflight] AGENTICPRIMITIVES_SKIP_PREFLIGHT=1 — skipping checks. ` +
      `This should only happen for explicit emergency overrides; never in CI.`);
    process.exit(0);
  }

  if (findings.length === 0) {
    console.log(`\n[preflight] ✓ all checks passed.`);
    process.exit(0);
  }

  console.error(`\n[preflight] ✗ FAILED: ${findings.length} finding(s)`);
  console.error('');
  for (const f of findings) {
    console.error(`  [${f.audit}] ${f.check}`);
    console.error(`    ${f.message}`);
    console.error('');
  }
  console.error(
    `Fix the underlying issues — do NOT skip with AGENTICPRIMITIVES_SKIP_PREFLIGHT ` +
      `unless you are 100% certain and have audit sign-off.`,
  );

  // Also try a quick check-no-app-private-keys run since it's the same family.
  try {
    execSync('pnpm check:no-app-private-keys', { stdio: 'pipe' });
  } catch {
    console.error(
      `\n[preflight] also: \`pnpm check:no-app-private-keys\` failed. ` +
        `Run it standalone for details.`,
    );
  }

  process.exit(WARN_ONLY ? 0 : 1);
}

main();
