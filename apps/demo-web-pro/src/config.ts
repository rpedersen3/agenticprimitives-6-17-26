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
 *   VITE_CUSTODY_POLICY=0xccfD79BBDfF7126A0B6Ba3F881edccb3998E6554
 *   ...
 *
 * All fields optional — flows surface a clear error in the UI when they're missing.
 */

export interface DeploymentConfig {
  chainId?: number;
  factoryAddress?: `0x${string}`;
  custodyPolicy?: `0x${string}`;
  delegationManager?: `0x${string}`;
  quorumEnforcer?: `0x${string}`;
  approvedHashRegistry?: `0x${string}`;
  entryPoint?: `0x${string}`;
  smartAgentPaymaster?: `0x${string}`;
  deployer?: `0x${string}`;
  /**
   * Optional explicit RPC URL — when set, the front-end uses it for ALL
   * chain reads instead of viem's default public node. Critical for
   * staying in sync with the worker (demo-a2a) which submits via this
   * same RPC: if the two ends use different nodes, read-after-write
   * propagation lag silently returns stale state (e.g. `getScheduledChange`
   * returns the all-zero default record for a just-scheduled change,
   * which Acts 3/4 then mis-sign as eta=0).
   */
  rpcUrl?: string;
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
  custodyPolicy:   parseAddr(import.meta.env.VITE_CUSTODY_POLICY),
  delegationManager:    parseAddr(import.meta.env.VITE_DELEGATION_MANAGER),
  quorumEnforcer:       parseAddr(import.meta.env.VITE_QUORUM_ENFORCER),
  approvedHashRegistry: parseAddr(import.meta.env.VITE_APPROVED_HASH_REGISTRY),
  entryPoint:           parseAddr(import.meta.env.VITE_ENTRY_POINT),
  smartAgentPaymaster:  parseAddr(import.meta.env.VITE_SMART_AGENT_PAYMASTER),
  deployer:             parseAddr(import.meta.env.VITE_DEPLOYER),
  rpcUrl:               import.meta.env.VITE_RPC_URL || undefined,
  demoA2aUrl:           import.meta.env.VITE_DEMO_A2A_URL || undefined,
  demoMcpUrl:           import.meta.env.VITE_DEMO_MCP_URL || undefined,
};
