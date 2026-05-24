import { useAgentName } from '../../lib/use-agent-naming';

/**
 * Display the `.agent` primary name for an address if registered,
 * falling back to a truncated address. Loading + no-name states show
 * the address (no flicker, no badge clutter).
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
  const { data: name } = useAgentName(address);
  const text = name ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—');
  const Tag = bold ? 'strong' : 'span';
  return (
    <Tag className={className} title={address ?? undefined}>
      {text}
    </Tag>
  );
}
