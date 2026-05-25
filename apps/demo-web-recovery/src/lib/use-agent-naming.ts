import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { config } from '../config';
import { NAMING_CLAIMED_EVENT, type NamingClaimedDetail } from './claim-psa-name';

/**
 * Singleton `AgentNamingClient` from the current deployment config.
 * Returns `null` when any required address / RPC is missing. Reverse
 * resolution is a single `reverseResolveString` view call — no
 * `eth_getLogs` walk, no fallback (ADR-0013).
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
 * Reverse-resolve an address to its primary `.agent` name.
 *
 * `enabled` lets callers skip the chain read when the name is already
 * in the synchronous cache (see `NameDisplay`) — the cache is the
 * primary display source; this read is only a fallback-free top-up for
 * addresses we didn't mint locally.
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
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Invalidate cached naming reads whenever a claim propagates. Mount
 * once at the app root inside the QueryClientProvider.
 */
export function useNamingClaimListener() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onClaimed = (e: Event) => {
      const ce = e as CustomEvent<NamingClaimedDetail>;
      const addr = ce.detail?.address?.toLowerCase();
      if (addr) queryClient.invalidateQueries({ queryKey: ['agent-name', addr] });
      else queryClient.invalidateQueries({ queryKey: ['agent-name'] });
    };
    window.addEventListener(NAMING_CLAIMED_EVENT, onClaimed);
    return () => window.removeEventListener(NAMING_CLAIMED_EVENT, onClaimed);
  }, [queryClient]);
}
