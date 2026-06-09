#!/usr/bin/env node
// Merge the incremental DeployRegistries sidecar (SC-1/SC-2) into the network's deployments file.
// Reads deployments-registries-<network>.json and overwrites ONLY the agreementRegistry +
// attestationRegistry keys in deployments-<network>.json — every other address is preserved (no full
// reset). Then run `pnpm build:deployments` to regenerate the subpath export the apps import.
//
// Usage: DEPLOY_NETWORK=base-sepolia node scripts/merge-registry-deploy.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const network = process.env.DEPLOY_NETWORK ?? 'base-sepolia';
const sidecarPath = join(root, `deployments-registries-${network}.json`);
const mainPath = join(root, `deployments-${network}.json`);

if (!existsSync(sidecarPath)) {
  console.error(`✗ sidecar not found: ${sidecarPath} — run deploy:registries:${network} first`);
  process.exit(1);
}
if (!existsSync(mainPath)) {
  console.error(`✗ deployments file not found: ${mainPath}`);
  process.exit(1);
}

const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
const main = JSON.parse(readFileSync(mainPath, 'utf8'));

for (const key of ['agreementRegistry', 'attestationRegistry']) {
  const addr = sidecar[key];
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr ?? '')) {
    console.error(`✗ sidecar missing a valid ${key}: ${addr}`);
    process.exit(1);
  }
  console.log(`  ${key}: ${main[key]} -> ${addr}`);
  main[key] = addr;
}

writeFileSync(mainPath, JSON.stringify(main, null, 2) + '\n');
console.log(`✓ updated ${mainPath} (2 keys). Next: pnpm --filter @agenticprimitives/contracts build:deployments`);
