/**
 * Build-time deployment config sourced from Vite env vars.
 *
 * The `deploy-cloudflare.ts` script reads `apps/contracts/deployments-<NETWORK>.json`
 * and injects the addresses below into `vite build` as `VITE_*` vars.
 * Vite inlines them into the bundle at build time — the deployed Pages app
 * carries one chain's addresses; redeploy to rotate.
 *
 * For local dev, set `apps/demo-web-pro/.env.local`:
 *
 *   VITE_CHAIN_ID=84532
 *   VITE_FACTORY_ADDRESS=0x880FE0F93a2807838BA6Ad71850ADF0983fc920E
 *   VITE_THRESHOLD_VALIDATOR=0xccfD79BBDfF7126A0B6Ba3F881edccb3998E6554
 *   ...
 *
 * All fields optional — flows surface a clear error in the UI when they're missing.
 */

export interface DeploymentConfig {
  chainId?: number;
  factoryAddress?: `0x${string}`;
  thresholdValidator?: `0x${string}`;
  delegationManager?: `0x${string}`;
  quorumEnforcer?: `0x${string}`;
  approvedHashRegistry?: `0x${string}`;
  demoA2aUrl?: string;
  demoMcpUrl?: string;
}

function parseAddr(v: string | undefined): `0x${string}` | undefined {
  if (!v) return undefined;
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : undefined;
}

function parseChainId(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const config: DeploymentConfig = {
  chainId:              parseChainId(import.meta.env.VITE_CHAIN_ID),
  factoryAddress:       parseAddr(import.meta.env.VITE_FACTORY_ADDRESS),
  thresholdValidator:   parseAddr(import.meta.env.VITE_THRESHOLD_VALIDATOR),
  delegationManager:    parseAddr(import.meta.env.VITE_DELEGATION_MANAGER),
  quorumEnforcer:       parseAddr(import.meta.env.VITE_QUORUM_ENFORCER),
  approvedHashRegistry: parseAddr(import.meta.env.VITE_APPROVED_HASH_REGISTRY),
  demoA2aUrl:           import.meta.env.VITE_DEMO_A2A_URL || undefined,
  demoMcpUrl:           import.meta.env.VITE_DEMO_MCP_URL || undefined,
};
