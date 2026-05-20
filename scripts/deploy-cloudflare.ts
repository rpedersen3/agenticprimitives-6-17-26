/**
 * deploy-cloudflare.ts
 *
 * One-shot deploy of the demo to Cloudflare. Run after:
 *   1. `wrangler login` (one-time)
 *   2. Contracts deployed (e.g. `pnpm --filter @agenticprimitives-demo/contracts deploy:base-sepolia`)
 *      → writes apps/contracts/deployments-base-sepolia.json
 *   3. Production D1 created + database_id pasted into demo-mcp/wrangler.toml
 *   4. Secrets set with `--env production` (see specs/120-deploy.md §4)
 *
 * Then:
 *   pnpm deploy:cloudflare
 *
 * Order of operations:
 *   1. Pre-flight checks (wrangler login, deployments file, etc.)
 *   2. Apply D1 migrations to remote production DB
 *   3. Deploy demo-mcp Worker — capture URL
 *   4. Deploy demo-a2a Worker — inject MCP_URL + ALLOWED_ORIGINS, capture URL
 *   5. Write cloudflare-urls.json (gitignored deploy state)
 *   6. Build demo-web → inject demo-a2a URL into dist/_redirects
 *   7. Deploy demo-web (Pages)
 *
 * Override via env:
 *   DEPLOY_NETWORK=base-sepolia    (must match deployments-<NETWORK>.json)
 *   PAGES_PROJECT=agenticprimitives-demo
 *   DEMO_WEB_URL=https://<custom>.pages.dev  (override predicted URL)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..');
const NETWORK = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
const PAGES_PROJECT = process.env.PAGES_PROJECT ?? 'agenticprimitives-demo';
const DEMO_WEB_URL = process.env.DEMO_WEB_URL ?? `https://${PAGES_PROJECT}.pages.dev`;

const DEPLOYMENTS_PATH = join(REPO_ROOT, 'apps', 'contracts', `deployments-${NETWORK}.json`);
const STATE_PATH = join(REPO_ROOT, 'cloudflare-urls.json');

const TOTAL = 7;
function step(n: number, msg: string): void {
  console.log(`\n[${n}/${TOTAL}] ${msg}`);
}
function fail(msg: string): never {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

interface Deployments {
  chainId: number;
  entryPoint: string;
  delegationManager: string;
  agentAccountFactory: string;
  timestampEnforcer: string;
  allowedTargetsEnforcer: string;
  allowedMethodsEnforcer: string;
  valueEnforcer: string;
  /** Optional — present after running deploy:paymaster:<network> + merge. */
  smartAgentPaymaster?: string;
  /** Optional — signer-agnostic verifier (ECDSA / ERC-1271 / ERC-6492).
   *  When propagated, demo-a2a's /auth/siwe-verify uses the on-chain
   *  validator instead of legacy ECDSA recovery. Required for the
   *  passkey path (spec 130). */
  universalSignatureValidator?: string;
}

function run(cmd: string, opts: { cwd?: string } = {}): void {
  execSync(cmd, { cwd: opts.cwd ?? REPO_ROOT, stdio: 'inherit' });
}

function runCapture(cmd: string, opts: { cwd?: string } = {}): string {
  // Inherit stderr so wrangler progress/errors stream to the terminal;
  // capture stdout to extract the deployed URL.
  return execSync(cmd, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
}

function buildVarFlags(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `--var ${k}:${v}`)
    .join(' ');
}

function extractWorkerUrl(out: string): string | null {
  const matches = out.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.workers\.dev/g);
  return matches?.[0] ?? null;
}

// 1. Pre-flight
step(1, 'Pre-flight checks…');

// Production preflight (audit finding C4) — hard-fails on demo
// shortcuts: unguarded /_dev/* routes, missing UNIVERSAL_SIGNATURE_VALIDATOR
// propagation, private keys in vars, missing deployments JSON fields.
try {
  execSync('pnpm check:production-deploy', { stdio: 'inherit' });
} catch {
  fail(
    'production preflight failed. Fix the findings above. ' +
      'Do NOT bypass with AGENTICPRIMITIVES_SKIP_PREFLIGHT=1 unless you have audit sign-off.',
  );
}

try {
  execSync('wrangler whoami', { stdio: 'pipe' });
} catch {
  fail('not logged into Cloudflare. Run: wrangler login');
}
if (!existsSync(DEPLOYMENTS_PATH)) {
  fail(
    `${DEPLOYMENTS_PATH} not found.\n` +
      `  Deploy contracts first (see specs/120-deploy.md §3):\n` +
      `    BASE_SEPOLIA_RPC=... PRIVATE_KEY=... pnpm --filter @agenticprimitives-demo/contracts deploy:base-sepolia`,
  );
}
const d = JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8')) as Deployments;
console.log(`  network: ${NETWORK}`);
console.log(`  factory: ${d.agentAccountFactory}`);
console.log(`  delegationManager: ${d.delegationManager}`);
console.log(`  predicted Pages URL: ${DEMO_WEB_URL}`);

// 1.5 Build all packages so the Workers pick up the latest dist/.
//    Without this, wrangler bundles each Worker against whatever stale
//    JS is in packages/*/dist/ — a silent footgun.
step(1, 'Building @agenticprimitives/* packages so Workers see latest code…');
run("pnpm -r --filter './packages/*' build");

// 2. D1 migrations
step(2, 'Applying D1 migrations to remote production DB…');
process.env.CI = '1';
try {
  run('wrangler d1 migrations apply demo-mcp --remote --env production', {
    cwd: join(REPO_ROOT, 'apps', 'demo-mcp'),
  });
} catch {
  fail(
    'D1 migrations failed.\n' +
      '  Likely cause: production D1 database not created, or database_id in\n' +
      '  apps/demo-mcp/wrangler.toml [[env.production.d1_databases]] is still\n' +
      '  the REPLACE_WITH_PROD_D1_ID placeholder. Run:\n' +
      '    wrangler d1 create demo-mcp\n' +
      '  then paste the database_id into wrangler.toml.',
  );
}

// Contract address vars shared by both Workers
const contractVars: Record<string, string> = {
  ENTRY_POINT: d.entryPoint,
  DELEGATION_MANAGER: d.delegationManager,
  AGENT_ACCOUNT_FACTORY: d.agentAccountFactory,
  TIMESTAMP_ENFORCER: d.timestampEnforcer,
  ALLOWED_TARGETS_ENFORCER: d.allowedTargetsEnforcer,
  ALLOWED_METHODS_ENFORCER: d.allowedMethodsEnforcer,
  VALUE_ENFORCER: d.valueEnforcer,
};

// 3. Deploy demo-mcp Worker (no external deps — deploy first so we can pass
//    its URL into demo-a2a as MCP_URL)
step(3, 'Deploying demo-mcp Worker…');
const mcpOut = runCapture(`wrangler deploy --env production ${buildVarFlags(contractVars)}`, {
  cwd: join(REPO_ROOT, 'apps', 'demo-mcp'),
});
process.stdout.write(mcpOut);
const demoMcpUrl = extractWorkerUrl(mcpOut);
if (!demoMcpUrl) fail('failed to extract demo-mcp Worker URL from wrangler deploy output.');
console.log(`  → ${demoMcpUrl}`);

// 4. Deploy demo-a2a Worker with MCP_URL + ALLOWED_ORIGINS injected.
//    When A2A_KMS_BACKEND=gcp-kms is set in the deploy env, also propagate
//    A2A_KMS_BACKEND + GCP_KMS_KEY_NAME to the Worker via --var.
//    (GCP_SERVICE_ACCOUNT_JSON is set separately via wrangler secret put —
//    see scripts/set-cloudflare-secrets.sh.)
step(4, 'Deploying demo-a2a Worker…');
const a2aVars: Record<string, string> = {
  ...contractVars,
  MCP_URL: demoMcpUrl,
  ALLOWED_ORIGINS: DEMO_WEB_URL,
};
const a2aBackend = process.env.A2A_KMS_BACKEND;
if (a2aBackend === 'gcp-kms') {
  const keyName = process.env.GCP_KMS_KEY_NAME;
  if (!keyName) {
    fail(
      'A2A_KMS_BACKEND=gcp-kms but GCP_KMS_KEY_NAME is not set.\n' +
        '  Format: projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>/cryptoKeyVersions/<V>',
    );
  }
  a2aVars.A2A_KMS_BACKEND = 'gcp-kms';
  a2aVars.GCP_KMS_KEY_NAME = keyName;
  console.log(`  using A2A_KMS_BACKEND=gcp-kms with signing key ${keyName}`);

  // Optional: symmetric encrypt-decrypt key for envelope encryption.
  // When set, demo-a2a's SessionManager uses GcpKmsProvider instead of
  // LocalAesProvider (which fails at NODE_ENV=production).
  const encryptKeyName = process.env.GCP_KMS_ENCRYPT_KEY_NAME;
  if (encryptKeyName) {
    a2aVars.GCP_KMS_ENCRYPT_KEY_NAME = encryptKeyName;
    console.log(`  using GCP_KMS_ENCRYPT_KEY_NAME=${encryptKeyName}`);
  }
}
// If a paymaster address is present in the deployments file, propagate
// it so demo-a2a's /session/deploy endpoints become available. Without
// this var, the endpoints return 409 and demo-web falls back to
// counterfactual mode.
if (d.smartAgentPaymaster) {
  a2aVars.PAYMASTER = d.smartAgentPaymaster;
  console.log(`  using PAYMASTER ${d.smartAgentPaymaster}`);
}
// Propagate the universal validator address so /auth/siwe-verify
// switches to the signer-agnostic path (passkey + ERC-6492 support).
if (d.universalSignatureValidator) {
  a2aVars.UNIVERSAL_SIGNATURE_VALIDATOR = d.universalSignatureValidator;
  console.log(`  using UNIVERSAL_SIGNATURE_VALIDATOR ${d.universalSignatureValidator}`);
}
const a2aOut = runCapture(
  `wrangler deploy --env production ${buildVarFlags(a2aVars)}`,
  { cwd: join(REPO_ROOT, 'apps', 'demo-a2a') },
);
process.stdout.write(a2aOut);
const demoA2aUrl = extractWorkerUrl(a2aOut);
if (!demoA2aUrl) fail('failed to extract demo-a2a Worker URL from wrangler deploy output.');
console.log(`  → ${demoA2aUrl}`);

// 5. Write deploy-state file (gitignored)
step(5, 'Recording deploy state in cloudflare-urls.json…');
const state = {
  network: NETWORK,
  deployedAt: new Date().toISOString(),
  pagesProject: PAGES_PROJECT,
  demoMcpUrl,
  demoA2aUrl,
  demoWebUrl: DEMO_WEB_URL,
  contracts: d,
};
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log(`  → ${STATE_PATH}`);

// 6. Build demo-web + ensure Pages project + bind DEMO_A2A_URL secret
step(6, 'Building demo-web + provisioning Pages project…');
run('pnpm --filter @agenticprimitives-demo/web build');

// Ensure the Pages project exists. `wrangler pages project create` errors
// loudly if it already exists; we treat that as success.
try {
  execSync(
    `wrangler pages project create ${PAGES_PROJECT} --production-branch=master`,
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
  console.log(`  ✓ created Pages project ${PAGES_PROJECT}`);
} catch (err: unknown) {
  const msg = (err as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString() ?? '';
  if (msg.includes('already') || msg.includes('exists')) {
    console.log(`  ✓ Pages project ${PAGES_PROJECT} already exists`);
  } else {
    process.stderr.write(msg);
    fail(`wrangler pages project create failed (see error above).`);
  }
}

// Bind DEMO_A2A_URL on the Pages project so functions/a2a/[[path]].ts can
// proxy correctly. Piped via stdin so the URL never appears in command args.
const secretChild = execSync(
  `wrangler pages secret put DEMO_A2A_URL --project-name=${PAGES_PROJECT}`,
  { cwd: REPO_ROOT, input: demoA2aUrl, stdio: ['pipe', 'inherit', 'inherit'] },
);
void secretChild;
console.log(`  ✓ Pages secret DEMO_A2A_URL = ${demoA2aUrl}`);

// 7. Deploy demo-web to Pages (uploads dist/ + functions/)
step(7, 'Deploying demo-web to Pages…');
run(
  `wrangler pages deploy dist --project-name=${PAGES_PROJECT} --branch=master --commit-dirty=true`,
  { cwd: join(REPO_ROOT, 'apps', 'demo-web') },
);

console.log('\n────────────────────────────────────────────────────────────');
console.log(`demo-web    ${DEMO_WEB_URL}`);
console.log(`demo-a2a    ${demoA2aUrl}`);
console.log(`demo-mcp    ${demoMcpUrl}`);
console.log('────────────────────────────────────────────────────────────\n');
console.log('Deploy state: cloudflare-urls.json (gitignored)');
console.log('Rollback:     wrangler deployments list --env production');
