import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { config } from './config';

/**
 * Singleton `AgentNamingClient`. Returns null when naming addresses /
 * RPC aren't configured. Reverse resolution is a single
 * `reverseResolveString` view call — no log walk, no fallback (ADR-0013).
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
 * Reverse-resolve an address to its primary `.agent` name. `enabled`
 * lets the caller skip the read when the name is already cached.
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
