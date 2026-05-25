import { useEffect, useState } from 'react';
import { useAgentName } from './use-agent-naming';
import { getCachedName, NAME_CACHE_EVENT, setCachedName } from './name-cache';

/**
 * Display the `.agent` primary name for an address (cache-first; one
 * `reverseResolveString`, no log walk / no fallback). Falls back to the
 * truncated address when the SA has no primary name set.
 */
export function NameDisplay({
  address,
  className = '',
}: {
  address?: `0x${string}`;
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

  const { data: onChain } = useAgentName(address, { enabled: !cached });

  useEffect(() => {
    if (address && onChain && getCachedName(address) !== onChain) {
      setCachedName(address, onChain);
    }
  }, [address, onChain]);

  const name = cached ?? onChain ?? undefined;
  const text = name ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—');
  return (
    <span className={className} title={address ?? undefined}>
      {text}
    </span>
  );
}
