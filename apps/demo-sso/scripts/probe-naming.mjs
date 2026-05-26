// Probe the naming state to understand the duplicate-name report.
//   pnpm exec tsx apps/demo-sso/scripts/probe-naming.mjs
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { AgentAccountClient } from '@agenticprimitives/agent-account';

const RPC = process.env.RPC_URL || 'https://sepolia.base.org';
const naming = new AgentNamingClient({
  rpcUrl: RPC,
  chainId: 84532,
  registry: '0xE9Bf4f67701Ba6eD7843b9848c3fe0C6e0212427',
  universalResolver: '0xb66a4829606C4E1C5eB424314b681343c747b4B2',
});
const accounts = new AgentAccountClient({
  rpcUrl: RPC,
  chainId: 84532,
  entryPoint: '0x094700EB9F743F462b0E59a68084d6be56F3Ed96',
  factory: '0x7Aac638824014210349497440D3CE631A95b466c',
});

const walletSa = '0xc0Cc1Bbe7FEA94Cb01e09445fC24e78d0A48517a';
for (const name of ['bob.demo.agent', 'bob2.demo.agent', 'bob3.demo.agent']) {
  console.log(`resolveName(${name}) = ${(await naming.resolveName(name)) ?? 'null'}`);
}
console.log(`reverseResolve(${walletSa}) = ${(await naming.reverseResolve(walletSa)) ?? 'null'}`);
console.log(`isDeployed(${walletSa}) = ${await accounts.isDeployed(walletSa)}`);
