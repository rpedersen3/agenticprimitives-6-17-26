import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { config } from '../config';
import { NAMING_CLAIMED_EVENT, type NamingClaimedDetail } from './claim-psa-name';

/**
 * Build a singleton `AgentNamingClient` from the current deployment
 * config. Returns `null` when any required address / RPC is missing
 * (the naming stack is optional from the demo's perspective —
 * callers MUST handle `null` and render a "naming not configured"
 * hint instead of crashing).
 */
export function useAgentNamingClient(): AgentNamingClient | null {
  return useMemo(() => {
    if (!config.rpcUrl || !config.chainId) return null;
    if (!config.agentNameRegistry || !config.agentNameUniversalResolver) return null;
    return new AgentNamingClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      registry: config.agentNameRegistry,
      universalResolver: config.agentNameUniversalResolver,
    });
  }, []);
}

/**
 * Reverse-resolve an address to its primary `.agent` name (live read).
 *
 * `enabled` lets callers skip the chain read when they already have the
 * name from the synchronous name cache (see `NameDisplay`). Per
 * name-cache.ts the cache is the primary render source; the chain read
 * is only a fallback for addresses we didn't mint locally.
 */
export function useAgentName(
  address: `0x${string}` | undefined,
  opts?: { enabled?: boolean },
) {
  const client = useAgentNamingClient();
  return useQuery({
    queryKey: ['agent-name', address?.toLowerCase() ?? null],
    enabled: !!client && !!address && (opts?.enabled ?? true),
    queryFn: async () => {
      if (!client || !address) return null;
      return await client.reverseResolve(address);
    },
    // Short staleTime + refetchOnWindowFocus so a freshly-claimed
    // name surfaces quickly. The `naming:claimed` event listener
    // (see `useNamingClaimListener`) covers the in-tab case too.
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Global listener that invalidates cached naming reads whenever
 * `claim-psa-name.ts` (or any other claim helper) dispatches the
 * `naming:claimed` event. Mount once at the app root inside the
 * QueryClientProvider — every NameDisplay then refreshes the moment
 * the on-chain claim has propagated.
 */
export function useNamingClaimListener() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onClaimed = (e: Event) => {
      const ce = e as CustomEvent<NamingClaimedDetail>;
      const addr = ce.detail?.address?.toLowerCase();
      // Refresh the per-address reverse lookup AND any panel /
      // record reads that may have cached "not yet registered" state.
      if (addr) {
        queryClient.invalidateQueries({ queryKey: ['agent-name', addr] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['agent-name'] });
      }
      queryClient.invalidateQueries({ queryKey: ['naming-status'] });
      queryClient.invalidateQueries({ queryKey: ['agent-records'] });
      queryClient.invalidateQueries({ queryKey: ['resolve-name'] });
    };
    window.addEventListener(NAMING_CLAIMED_EVENT, onClaimed);
    return () => window.removeEventListener(NAMING_CLAIMED_EVENT, onClaimed);
  }, [queryClient]);
}

/** Forward-resolve a name to its on-chain Smart Agent address. */
export function useResolveAgentName(name: string | undefined) {
  const client = useAgentNamingClient();
  return useQuery({
    queryKey: ['resolve-name', name ?? null],
    enabled: !!client && !!name,
    queryFn: async () => {
      if (!client || !name) return null;
      return await client.resolveName(name);
    },
    staleTime: 30_000,
  });
}

/** Read the typed records bundle for a name. */
export function useAgentRecords(name: string | undefined) {
  const client = useAgentNamingClient();
  return useQuery({
    queryKey: ['agent-records', name ?? null],
    enabled: !!client && !!name,
    queryFn: async () => {
      if (!client || !name) return null;
      return await client.getRecords(name);
    },
    staleTime: 30_000,
  });
}
