import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAgentNamingClient } from '../../lib/use-agent-naming';
import { config } from '../../config';
import { RegisterNameForm } from './RegisterNameForm';
import { NameDisplay } from './NameDisplay';

/**
 * Status panel for the Agent Naming Service. Shows:
 *   - Whether the naming contracts are wired in this deployment.
 *   - The `.agent` root namehash.
 *   - The bootstrap names registered by `pnpm bootstrap:demo-names`
 *     (acme.agent, treasury.acme.agent, demo.agent) and their
 *     resolved Smart Agent addresses.
 *
 * Phase 5 v0 — read-only surface. Per-user name registration ships in
 * Phase 4 (writes via the actor's CustodyPolicy quorum + ERC-1271).
 */
export function NamingStatusPanel() {
  const client = useAgentNamingClient();
  const queryClient = useQueryClient();

  // Strip `getRecords` from the steady-state read path — it fans out
  // to ~10 readContract calls per name (one per typed predicate) which
  // hammers the browser RPC. Just resolve the addresses; records
  // bundle is available via the AgentDetailModal on demand.
  const { data: demos, isLoading, error } = useQuery({
    queryKey: ['naming-status', config.agentNameRegistry ?? null],
    enabled: !!client,
    queryFn: async () => {
      if (!client) return null;
      const names = ['demo.agent', 'acme.agent', 'treasury.acme.agent'];
      const entries = await Promise.all(
        names.map(async (name) => {
          const addr = await client.resolveName(name);
          return { name, addr, displayName: undefined as string | undefined, kind: undefined as string | undefined };
        }),
      );
      return entries;
    },
    // Bootstrap names don't change minute-to-minute — keep fresh for an
    // hour so this panel doesn't re-fire on every dashboard re-render.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (!client) {
    return (
      <div
        style={{
          padding: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#f9fafb',
          color: '#6b7280',
          fontSize: 13,
        }}
      >
        <strong>Agent Naming Service</strong>
        <div style={{ marginTop: 4 }}>
          Not wired — set <code>VITE_AGENT_NAME_REGISTRY</code> +{' '}
          <code>VITE_AGENT_NAME_UNIVERSAL_RESOLVER</code> in <code>.env.local</code>{' '}
          (regenerate via <code>pnpm gen-dev-vars</code> after a deploy).
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        border: '1px solid #d1d5db',
        borderRadius: 8,
        background: '#ffffff',
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 14 }}>Agent Naming Service</strong>
        <code style={{ fontSize: 11, color: '#6b7280' }}>
          {config.agentNameRegistry?.slice(0, 8)}…
        </code>
      </div>
      <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
        Live on Base Sepolia. Bootstrap names (registered by{' '}
        <code>pnpm bootstrap:demo-names</code>):
      </div>
      <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
        {isLoading ? <span style={{ color: '#9ca3af' }}>resolving…</span> : null}
        {error ? <span style={{ color: '#dc2626' }}>error: {String(error)}</span> : null}
        {demos?.map((d) => (
          <div
            key={d.name}
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr 60px',
              gap: 8,
              alignItems: 'center',
              padding: '4px 0',
              borderTop: '1px solid #f3f4f6',
            }}
          >
            <code style={{ fontWeight: 600 }}>{d.name}</code>
            <span title={d.addr ?? 'unresolved'}>
              {d.addr
                ? <NameDisplay address={d.addr} />
                : '(unresolved)'}
              {d.displayName ? (
                <span style={{ marginLeft: 8, color: '#6b7280', fontStyle: 'italic' }}>
                  {d.displayName}
                </span>
              ) : null}
            </span>
            <span
              style={{
                fontSize: 11,
                color: '#6b7280',
                textAlign: 'right',
              }}
            >
              {d.kind ?? '—'}
            </span>
          </div>
        ))}
      </div>
      <RegisterNameForm
        onRegistered={() => {
          // Force a re-fetch so the new name shows up in the list.
          queryClient.invalidateQueries({ queryKey: ['naming-status'] });
        }}
      />
    </div>
  );
}
