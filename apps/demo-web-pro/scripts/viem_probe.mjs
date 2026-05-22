import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const abi = [{
  type: 'function',
  name: 'getScheduledChange',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }, { name: 'changeId', type: 'uint256' }],
  outputs: [
    { name: 'action', type: 'uint8' },
    { name: 'args', type: 'bytes' },
    { name: 'proposedAt', type: 'uint64' },
    { name: 'eta', type: 'uint64' },
    { name: 'proposer', type: 'address' },
    { name: 'executed', type: 'bool' },
    { name: 'cancelled', type: 'bool' },
  ],
}];
const c = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC) });
const r = await c.readContract({
  address: '0x6110b548282e72d038014647E226429b2A6a29f1',
  abi,
  functionName: 'getScheduledChange',
  args: ['0x02a57f9bb19d09d8d824a7bb6f56a711320524ae', 1n],
});
console.log('typeof:', typeof r, 'Array.isArray:', Array.isArray(r));
console.log('keys:', Object.keys(r));
console.log('r[0]:', r[0]);
console.log('r[3]:', r[3]);
console.log('r.eta:', r.eta);
console.log('r.action:', r.action);
