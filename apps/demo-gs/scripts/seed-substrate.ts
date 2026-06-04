// Seed the live skill + geo DEFINITION registries (spec 251) with the demo-gs taxonomy, so
// demo-gs's skillDefinitionExists / geoFeatureExists return TRUE end-to-end.
//
// Reuses the SAME taxonomy + SDK helpers the app uses, so each on-chain skillId/featureId is
// EXACTLY computeSkillId(gcUri) / computeFeatureId(uri). The deployer EOA is the steward
// (msg.sender == stewardAccount). Geo metadata is NEUTRAL (the app's sensitivity flags are
// app-local, never published).
//
// Run: tsx apps/demo-gs/scripts/seed-substrate.ts   (with PRIVATE_KEY + BASE_SEPOLIA_RPC env)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { SKILL_KIND, conceptHash } from '@agenticprimitives/agent-skills';
import { GEO_KIND, geometryHash } from '@agenticprimitives/geo-features';
import { SKILLS, REGIONS } from '../src/data/taxonomy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ZERO32 = `0x${'00'.repeat(32)}` as const;

const deployments = JSON.parse(
  readFileSync(join(HERE, '../../../packages/contracts/deployments-base-sepolia.json'), 'utf8'),
) as Record<string, string>;
const SKILL_REGISTRY = deployments.skillDefinitionRegistry as `0x${string}`;
const GEO_REGISTRY = deployments.geoFeatureRegistry as `0x${string}`;

const RPC = process.env.BASE_SEPOLIA_RPC;
const PK = (process.env.PRIVATE_KEY?.startsWith('0x') ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`) as Hex;
if (!RPC || !process.env.PRIVATE_KEY) throw new Error('set BASE_SEPOLIA_RPC + PRIVATE_KEY');

const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

const SKILL_PUBLISH_ABI = [{
  type: 'function', name: 'publish', stateMutability: 'nonpayable',
  inputs: [{ type: 'tuple', name: 'p', components: [
    { name: 'skillId', type: 'bytes32' }, { name: 'skillKind', type: 'bytes32' }, { name: 'stewardAccount', type: 'address' },
    { name: 'conceptHash', type: 'bytes32' }, { name: 'ontologyMerkleRoot', type: 'bytes32' }, { name: 'metadataURI', type: 'string' },
    { name: 'validAfter', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
  ] }], outputs: [{ type: 'uint64' }],
}, { type: 'function', name: 'exists', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'uint64' }], outputs: [{ type: 'bool' }] }] as const;

const GEO_PUBLISH_ABI = [{
  type: 'function', name: 'publish', stateMutability: 'nonpayable',
  inputs: [{ type: 'tuple', name: 'p', components: [
    { name: 'featureId', type: 'bytes32' }, { name: 'featureKind', type: 'bytes32' }, { name: 'stewardAccount', type: 'address' },
    { name: 'geometryHash', type: 'bytes32' }, { name: 'coverageRoot', type: 'bytes32' }, { name: 'sourceSetRoot', type: 'bytes32' },
    { name: 'metadataURI', type: 'string' }, { name: 'centroidLat', type: 'int256' }, { name: 'centroidLon', type: 'int256' },
    { name: 'bboxMinLat', type: 'int256' }, { name: 'bboxMinLon', type: 'int256' }, { name: 'bboxMaxLat', type: 'int256' }, { name: 'bboxMaxLon', type: 'int256' },
    { name: 'validAfter', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
  ] }], outputs: [{ type: 'uint64' }],
}, { type: 'function', name: 'exists', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'uint64' }], outputs: [{ type: 'bool' }] }] as const;

async function main() {
  const steward = account.address;
  console.log(`steward (deployer): ${steward}`);
  console.log(`skill registry: ${SKILL_REGISTRY} · geo registry: ${GEO_REGISTRY}`);
  let nonce = await pub.getTransactionCount({ address: steward, blockTag: 'pending' });
  const hashes: Hex[] = [];

  // ── Skills (publish only ones not already on chain) ──
  for (const s of SKILLS) {
    if (await pub.readContract({ address: SKILL_REGISTRY, abi: SKILL_PUBLISH_ABI, functionName: 'exists', args: [s.skillId, 1n] })) {
      console.log(`skip skill (exists): ${s.label}`);
      continue;
    }
    const h = await wallet.writeContract({
      address: SKILL_REGISTRY, abi: SKILL_PUBLISH_ABI, functionName: 'publish', nonce: nonce++,
      args: [{ skillId: s.skillId, skillKind: SKILL_KIND.Leaf, stewardAccount: steward, conceptHash: conceptHash(s.label), ontologyMerkleRoot: ZERO32, metadataURI: s.gcUri, validAfter: 0n, validUntil: 0n }],
    });
    hashes.push(h);
    console.log(`publish skill ${s.label} → ${h}`);
  }

  // ── Geo features (NEUTRAL metadata only; sensitivity is app-local, never published) ──
  for (const r of REGIONS) {
    if (await pub.readContract({ address: GEO_REGISTRY, abi: GEO_PUBLISH_ABI, functionName: 'exists', args: [r.featureId, 1n] })) {
      console.log(`skip feature (exists): ${r.label}`);
      continue;
    }
    const kind = r.level === 'global' ? GEO_KIND.Planet : GEO_KIND.Region;
    const h = await wallet.writeContract({
      address: GEO_REGISTRY, abi: GEO_PUBLISH_ABI, functionName: 'publish', nonce: nonce++,
      args: [{ featureId: r.featureId, featureKind: kind, stewardAccount: steward, geometryHash: geometryHash(r.uri), coverageRoot: ZERO32, sourceSetRoot: ZERO32, metadataURI: r.uri, centroidLat: 0n, centroidLon: 0n, bboxMinLat: 0n, bboxMinLon: 0n, bboxMaxLat: 0n, bboxMaxLon: 0n, validAfter: 0n, validUntil: 0n }],
    });
    hashes.push(h);
    console.log(`publish feature ${r.label} → ${h}`);
  }

  console.log(`\nsubmitted ${hashes.length} publish tx(s); waiting for the last receipt…`);
  if (hashes.length) await pub.waitForTransactionReceipt({ hash: hashes[hashes.length - 1]! });

  // verify a sample
  const sample = SKILLS[0]!;
  const ok = await pub.readContract({ address: SKILL_REGISTRY, abi: SKILL_PUBLISH_ABI, functionName: 'exists', args: [sample.skillId, 1n] });
  console.log(`\nverify exists(${sample.label}, 1): ${ok}`);
  console.log('done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
