import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AgentRelationshipsClient } from '@agenticprimitives/agent-relationships';
import { config } from '../config';

/**
 * Build a singleton `AgentRelationshipsClient` from the deployment
 * config. Returns `null` when any required address / RPC is missing.
 */
export function useAgentRelationshipsClient(): AgentRelationshipsClient | null {
  return useMemo(() => {
    if (!config.rpcUrl || !config.chainId) return null;
    if (!config.agentRelationship) return null;
    return new AgentRelationshipsClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      relationships: config.agentRelationship,
    });
  }, []);
}

/** List all edges where `subject` appears on the subject side. */
export function useEdgesFor(subject: `0x${string}` | undefined) {
  const client = useAgentRelationshipsClient();
  return useQuery({
    queryKey: ['agent-edges-subject', subject?.toLowerCase() ?? null],
    enabled: !!client && !!subject,
    queryFn: async () => {
      if (!client || !subject) return [];
      return await client.listEdgesFor(subject);
    },
    staleTime: 30_000,
  });
}
