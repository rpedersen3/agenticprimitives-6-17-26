import { useEffect, useState } from 'react';
import { useAgentName } from '../lib/use-agent-naming';
import { getCachedName, NAME_CACHE_EVENT, setCachedName } from '../lib/name-cache';

/**
 * Display the `.agent` primary name for an address.
 *
 * Cache-first (name-cache.ts is the primary source): the synchronous
 * cache renders instantly; a single `reverseResolveString` (no log
 * walk, ADR-0013) only fires when the cache is empty, then primes it.
 * Shows the truncated address when the SA has no primary name — that's
 * the answer, not a trigger to escalate to a second read path.
 */
export function NameDisplay({
  address,
  bold = false,
  className = '',
}: {
  address?: `0x${string}`;
  bold?: boolean;
  className?: string;
}) {
  const [cached, setCachedState] = useState<string | undefined>(() => getCachedName(address));
  useEffect(() => {
    setCachedState(getCachedName(address));
    if (typeof window === 'undefined') return;
    const refresh = () => setCachedState(getCachedName(address));
    window.addEventListener(NAME_CACHE_EVENT, refresh);
    return () => window.removeEventListener(NAME_CACHE_EVENT, refresh);
  }, [address]);

  // Single-call reverse — only when not cached (the four-ish demo
  // agents are cached after claim / boot prime, so they render with
  // zero RPC).
  const { data: onChain } = useAgentName(address, { enabled: !cached });

  useEffect(() => {
    if (address && onChain && getCachedName(address) !== onChain) {
      setCachedName(address, onChain);
    }
  }, [address, onChain]);

  const name = cached ?? onChain ?? undefined;
  const text = name ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—');
  const Tag = bold ? 'strong' : 'span';
  return (
    <Tag className={className} title={address ?? undefined}>
      {text}
    </Tag>
  );
}
