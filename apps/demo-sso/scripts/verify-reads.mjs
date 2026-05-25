// One-off: verify the REAL directory ports read Base Sepolia (spec 227 M2).
// Read-only (public RPC) — resolves the bootstrapped namespaces + checks deploy state.
//   node apps/demo-sso/scripts/verify-reads.mjs
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { AgentAccountClient } from '@agenticprimitives/agent-account';

const RPC = process.env.RPC_URL || 'https://sepolia.base.org';
const CHAIN_ID = 84532;
const naming = new AgentNamingClient({
  rpcUrl: RPC,
  chainId: CHAIN_ID,
  registry: '0xE9Bf4f67701Ba6eD7843b9848c3fe0C6e0212427',
  universalResolver: '0xb66a4829606C4E1C5eB424314b681343c747b4B2',
});
const accounts = new AgentAccountClient({
  rpcUrl: RPC,
  chainId: CHAIN_ID,
  entryPoint: '0x094700EB9F743F462b0E59a68084d6be56F3Ed96',
  factory: '0x7Aac638824014210349497440D3CE631A95b466c',
});

console.log(`RPC ${RPC} (chain ${CHAIN_ID})`);
for (const name of ['demo.agent', 'acme.agent', 'nonexistent-xyz.demo.agent']) {
  const addr = await naming.resolveName(name);
  console.log(`resolveName(${name}) = ${addr ?? 'null'}`);
  if (addr) {
    console.log(`  isDeployed = ${await accounts.isDeployed(addr)}`);
    console.log(`  reverseResolve = ${(await naming.reverseResolve(addr)) ?? 'null'}`);
  }
}
console.log('OK — live read path works (no throw).');
