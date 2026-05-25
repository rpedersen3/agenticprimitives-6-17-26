/**
 * Build-time config for demo-web. Vite inlines `VITE_*` at build.
 *
 * demo-web talks to the demo-a2a Worker via same-origin relative paths
 * (`/a2a/*`, proxied by the Pages function). The naming service follows
 * the same shape: browser reads route through `/a2a/rpc` → worker /rpc,
 * so the upstream RPC key never ships in the bundle. Reverse resolution
 * is a single `reverseResolveString` view call — no log walk, no
 * fallback (ADR-0013).
 */

function parseAddr(v: string | undefined): `0x${string}` | undefined {
  if (!v) return undefined;
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : undefined;
}

function parseChainId(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const config = {
  chainId: parseChainId(import.meta.env.VITE_CHAIN_ID),
  agentNameRegistry: parseAddr(import.meta.env.VITE_AGENT_NAME_REGISTRY),
  agentNameUniversalResolver: parseAddr(import.meta.env.VITE_AGENT_NAME_UNIVERSAL_RESOLVER),
  // Same-origin Pages proxy → demo-a2a /rpc. Relative URL resolves
  // against the page origin in the browser fetch the viem transport uses.
  rpcUrl: (import.meta.env.VITE_BROWSER_RPC_URL as string | undefined) || '/a2a/rpc',
};
