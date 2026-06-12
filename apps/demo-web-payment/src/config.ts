/**
 * Deployment config for demo-web-payment.
 *
 * Unlike demo-web-pro (which injects every address via VITE_* at build time),
 * this demo PINS the live Base Sepolia addresses as defaults so it runs with
 * zero env setup — including the spec-272 x402 substrate (PaymentEnforcer +
 * MockUSDC + PaymentReceiptRegistry, deployed 2026-06-02). Any VITE_* var still
 * overrides, so the same bundle can target a re-deploy.
 *
 * Source of truth: packages/contracts/deployments-base-sepolia.json.
 */

export interface DeploymentConfig {
  chainId: number;
  factoryAddress: `0x${string}`;
  custodyPolicy: `0x${string}`;
  delegationManager: `0x${string}`;
  approvedHashRegistry: `0x${string}`;
  entryPoint: `0x${string}`;
  smartAgentPaymaster: `0x${string}`;
  deployer: `0x${string}`;
  timestampEnforcer: `0x${string}`;
  allowedTargetsEnforcer: `0x${string}`;
  allowedMethodsEnforcer: `0x${string}`;
  // spec-272 x402 pay-per-use substrate
  paymentEnforcer: `0x${string}`;
  paymentReceiptRegistry: `0x${string}`;
  mockUsdc: `0x${string}`;
  // naming (so the created persons get human names)
  agentNameRegistry: `0x${string}`;
  permissionlessSubregistry: `0x${string}`;
  rpcUrl: string;
  demoA2aUrl?: string;
}

function addr(v: string | undefined, fallback: `0x${string}`): `0x${string}` {
  if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`;
  return fallback;
}

const DEMO_A2A_URL =
  (import.meta.env.VITE_DEMO_A2A_URL as string | undefined) ||
  'https://agenticprimitives-demo-a2a.richardpedersen3.workers.dev';

export const config: DeploymentConfig = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID) || 84532,
  factoryAddress:         addr(import.meta.env.VITE_FACTORY_ADDRESS,           '0x3E68B72B45e7C9d35B210E4Ab06e5Cece85cEbE4'),
  custodyPolicy:          addr(import.meta.env.VITE_CUSTODY_POLICY,            '0xDeD6542A55476745846370562d1c75D15DDf2572'),
  delegationManager:      addr(import.meta.env.VITE_DELEGATION_MANAGER,        '0x3a8E2cE74564f699b135db6f266ccDb563979C05'),
  approvedHashRegistry:   addr(import.meta.env.VITE_APPROVED_HASH_REGISTRY,    '0x90735B5281434D1746926E2AA722Cc6DbF3EFEe6'),
  entryPoint:             addr(import.meta.env.VITE_ENTRY_POINT,              '0x9B33De9d9597de82Eb56b5B26C478Dc0a6955388'),
  smartAgentPaymaster:    addr(import.meta.env.VITE_SMART_AGENT_PAYMASTER,     '0x8eF92B9D62826052D8F7e6dcaB630dC3890bF540'),
  deployer:               addr(import.meta.env.VITE_DEPLOYER,                  '0x31ed17fb99e82E02085Ab4B3cbdaB05489098b44'),
  timestampEnforcer:      addr(import.meta.env.VITE_TIMESTAMP_ENFORCER,        '0x7c452434314A5bf2048f9263aeCd0cC20Fa07965'),
  allowedTargetsEnforcer: addr(import.meta.env.VITE_ALLOWED_TARGETS_ENFORCER,  '0xe3909FdEfD8b74B7D006E045DCd678e97D469Bfd'),
  allowedMethodsEnforcer: addr(import.meta.env.VITE_ALLOWED_METHODS_ENFORCER,  '0xf77cf06aCd8b9e2f3204fe4bE16449B3594c9633'),
  paymentEnforcer:        addr(import.meta.env.VITE_PAYMENT_ENFORCER,          '0xAF48273e11435cC2D56f4AFBfD091Abb162458E9'),
  paymentReceiptRegistry: addr(import.meta.env.VITE_PAYMENT_RECEIPT_REGISTRY,  '0x366616E265cd3cDE0F042A592C17838fe210D1d4'),
  mockUsdc:               addr(import.meta.env.VITE_MOCK_USDC,                 '0x8fb56ff3C13347DFC4E1287aE83E88deE5a7211C'),
  agentNameRegistry:      addr(import.meta.env.VITE_AGENT_NAME_REGISTRY,       '0x15F7ed064A230C011b0244A14fD9653f011d609B'),
  permissionlessSubregistry: addr(import.meta.env.VITE_PERMISSIONLESS_SUBREGISTRY, '0x1B8ED8693738e1A9DD653FEE5430d49e00202Bb7'),
  rpcUrl:
    (import.meta.env.VITE_BROWSER_RPC_URL as string | undefined) ||
    `${DEMO_A2A_URL.replace(/\/$/, '')}/rpc`,
  demoA2aUrl: DEMO_A2A_URL,
};
