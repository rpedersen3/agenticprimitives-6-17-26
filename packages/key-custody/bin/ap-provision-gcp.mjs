#!/usr/bin/env node
// ap-provision-gcp — provision GCP Cloud KMS secp256k1 signing keys for a set of
// signing identities, grant the runtime service account roles/cloudkms.signer
// per key, and print the identity → key-version map + derived EVM addresses
// (spec 276 KCS-D3). Thin Node wrapper over @agenticprimitives/key-custody/provision-gcp.
//
//   ap-provision-gcp \
//     --project my-proj --location us-east1 --keyring my-ring \
//     --service-account runtime@my-proj.iam.gserviceaccount.com \
//     --identities signer-a,signer-b [--protection HSM] [--dry-run]
//
// --dry-run prints the gcloud steps without executing. Requires `gcloud` on PATH
// (authenticated) for a real run.
import { execFileSync } from 'node:child_process';
import { planGcpProvision, executeGcpProvision } from '../dist/kms/provision-gcp.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'dry-run') { out['dry-run'] = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

function gcloud(argv) {
  return execFileSync('gcloud', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const args = parseArgs(process.argv.slice(2));
const required = ['project', 'location', 'keyring', 'service-account', 'identities'];
const missing = required.filter((k) => !args[k]);
if (missing.length) {
  console.error(`ap-provision-gcp: missing required flag(s): ${missing.map((m) => '--' + m).join(', ')}`);
  console.error('Usage: ap-provision-gcp --project <p> --location <l> --keyring <r> --service-account <email> --identities a,b[,c] [--protection HSM|SOFTWARE] [--dry-run]');
  process.exit(2);
}

const plan = {
  project: args.project,
  location: args.location,
  keyRing: args.keyring,
  identities: String(args.identities).split(',').map((s) => s.trim()).filter(Boolean),
  runtimeServiceAccount: args['service-account'],
  protectionLevel: args.protection ?? 'HSM',
};

if (args['dry-run']) {
  console.error(`# Dry run — ${plan.identities.length} identity/identities. The following gcloud commands would run:\n`);
  for (const step of planGcpProvision(plan)) {
    console.log(`# ${step.description}`);
    console.log(`gcloud ${step.argv.join(' ')}`);
  }
  process.exit(0);
}

const executor = {
  async run(step) {
    try {
      const stdout = gcloud(step.argv);
      return { stdout };
    } catch (e) {
      const stderr = String(e?.stderr ?? e?.message ?? '');
      if (/ALREADY_EXISTS|already exists/i.test(stderr)) return { stdout: '', alreadyExists: true };
      throw new Error(`gcloud ${step.argv.join(' ')} failed:\n${stderr}`);
    }
  },
  async getPublicKeyPem(cryptoKeyVersionName) {
    // .../cryptoKeys/<key>/cryptoKeyVersions/<n>
    const m = /cryptoKeys\/([^/]+)\/cryptoKeyVersions\/(\d+)$/.exec(cryptoKeyVersionName);
    if (!m) throw new Error(`unexpected key version name: ${cryptoKeyVersionName}`);
    return gcloud([
      'kms', 'keys', 'versions', 'get-public-key', m[2],
      '--key', m[1], '--keyring', plan.keyRing, '--location', plan.location, '--project', plan.project,
    ]);
  },
};

executeGcpProvision(plan, executor)
  .then((result) => {
    console.error(`\n# Provisioned. ${result.alreadyExisted.length ? `Skipped (already existed): ${result.alreadyExisted.join(', ')}` : 'All resources created.'}`);
    console.error('# Verify these addresses match expectations BEFORE wiring env:\n');
    console.log(JSON.stringify({ keyMap: result.keyMap, addresses: result.addresses, granted: result.granted }, null, 2));
  })
  .catch((e) => {
    console.error(`ap-provision-gcp failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
