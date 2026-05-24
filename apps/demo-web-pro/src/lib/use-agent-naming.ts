import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { config } from '../config';

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

/** Reverse-resolve an address to its primary `.agent` name (live read). */
export function useAgentName(address: `0x${string}` | undefined) {
  const client = useAgentNamingClient();
  return useQuery({
    queryKey: ['agent-name', address?.toLowerCase() ?? null],
    enabled: !!client && !!address,
    queryFn: async () => {
      if (!client || !address) return null;
      return await client.reverseResolve(address);
    },
    staleTime: 30_000,
  });
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
