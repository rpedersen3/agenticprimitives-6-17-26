// Confirm which AgentAccountSpec derives the already-deployed SA for the EOA from
// the AA25 error, so /connect/siwe can resolve EOA -> existing SA (reconnect).
//   pnpm exec tsx apps/demo-sso/scripts/verify-derive.mjs
import { AgentAccountClient } from '@agenticprimitives/agent-account';

const RPC = process.env.RPC_URL || 'https://sepolia.base.org';
const c = new AgentAccountClient({
  rpcUrl: RPC,
  chainId: 84532,
  entryPoint: '0x094700EB9F743F462b0E59a68084d6be56F3Ed96',
  factory: '0x7Aac638824014210349497440D3CE631A95b466c',
});

const eoa = '0x9a8c424b34d0105603d2aaa00ce088afadb025a2';
const expected = '0xc0Cc1Bbe7FEA94Cb01e09445fC24e78d0A48517a';
console.log(`EOA ${eoa}\nexpected SA ${expected}\n`);

for (const mode of [0, 1, 2, 3]) {
  try {
    const sa = await c.getAddressForAgentAccount({ mode, custodians: [eoa], salt: 0n });
    const match = sa.toLowerCase() === expected.toLowerCase() ? '  <<< MATCH' : '';
    const deployed = await c.isDeployed(sa);
    const cust = deployed ? await c.isCustodian(sa, eoa) : false;
    console.log(`mode ${mode}: ${sa} deployed=${deployed} isCustodian=${cust}${match}`);
  } catch (e) {
    console.log(`mode ${mode}: derive failed — ${e instanceof Error ? e.message.slice(0, 80) : e}`);
  }
}
