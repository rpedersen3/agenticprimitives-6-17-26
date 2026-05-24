import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgentIdentityClient } from '@agenticprimitives/agent-identity';
import { config } from '../config';

/**
 * Build a singleton `AgentIdentityClient` from the current deployment
 * config. Returns `null` when any required address / RPC is missing.
 */
export function useAgentIdentityClient(): AgentIdentityClient | null {
  return useMemo(() => {
    if (!config.rpcUrl || !config.chainId) return null;
    if (!config.agentProfileResolver) return null;
    return new AgentIdentityClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      profileResolver: config.agentProfileResolver,
    });
  }, []);
}

/** Fetch + verify the on-chain-anchored AgentCard for `agent`. */
export function useAgentProfile(agent: `0x${string}` | undefined) {
  const client = useAgentIdentityClient();
  return useQuery({
    queryKey: ['agent-profile', agent?.toLowerCase() ?? null],
    enabled: !!client && !!agent,
    queryFn: async () => {
      if (!client || !agent) return null;
      try {
        return await client.fetchProfile(agent);
      } catch (err) {
        // Hash mismatches throw — surface to the caller as null with
        // an error toast at the consumer.
        throw err;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}
