import { useEffect, useState } from 'react';
import { getCachedName, NAME_CACHE_EVENT } from '../../lib/name-cache';

/**
 * Display the `.agent` primary name for an address if known locally,
 * falling back to a truncated address.
 *
 * Per ADR-0012 + the Alchemy free-tier 429s we ran into, NameDisplay
 * does NOT walk `eth_getLogs` from the browser. It reads synchronously
 * from `lib/name-cache`, which is populated by every flow that
 * already knows the (address, name) pair — `claim-psa-name` on
 * success, passkey enrolment, seat-claim, etc. Re-renders on
 * `naming:cache:update` events.
 *
 * Pass `bold` when this is the headline label of a card; the rendered
 * markup stays inline-compatible either way.
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
  const [name, setName] = useState<string | undefined>(() => getCachedName(address));

  useEffect(() => {
    setName(getCachedName(address));
    if (typeof window === 'undefined') return;
    const refresh = () => setName(getCachedName(address));
    window.addEventListener(NAME_CACHE_EVENT, refresh);
    return () => window.removeEventListener(NAME_CACHE_EVENT, refresh);
  }, [address]);

  const text = name ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—');
  const Tag = bold ? 'strong' : 'span';
  return (
    <Tag className={className} title={address ?? undefined}>
      {text}
    </Tag>
  );
}
