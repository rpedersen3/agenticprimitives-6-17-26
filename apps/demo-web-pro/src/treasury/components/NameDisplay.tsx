import { useEffect, useState } from 'react';
import { useAgentName } from '../../lib/use-agent-naming';
import { getCachedName, NAME_CACHE_EVENT, setCachedName } from '../../lib/name-cache';

/**
 * Display the `.agent` primary name for an address.
 *
 * Per spec/222 the universal resolver now returns the full dotted
 * name in a SINGLE readContract — no `eth_getLogs`, no chunked
 * scans, no log walks. NameDisplay is back on the chain read path
 * (via React Query) with the local name cache acting as instant-
 * render seed:
 *
 *   1. Synchronous cache read → instant first paint (no flash).
 *   2. React Query reverseResolve in the background → primes cache
 *      + re-renders with chain truth.
 *   3. Updates from claim-psa-name (`naming:cache:update`) refresh
 *      the cache in-place.
 *
 * Pass `bold` when this is the headline label of a card.
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

  // Single-call reverse (spec/222). Returns null when the SA has no
  // primary, the round-trip fails (squat protection), or any ancestor
  // label is un-backfilled.
  const { data: onChain } = useAgentName(address);

  // Prime the cache the first time chain returns a name — speeds up
  // future renders + lets the modal's "Primary name (cache)" row
  // show the same value without another chain call.
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
