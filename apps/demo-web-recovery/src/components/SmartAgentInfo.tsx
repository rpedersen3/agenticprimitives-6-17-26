import { NameDisplay } from './NameDisplay';

/**
 * Compact canonical-identity card for a seat's Smart Agent: the `.agent`
 * name (cache-first NameDisplay), the canonical address, and the control
 * credential. Per ADR-0010 the address IS the identity; the name + the
 * credential are facets pointing at it.
 */
export function SmartAgentInfo({
  address,
  credLabel,
}: {
  address: `0x${string}`;
  credLabel?: string;
}) {
  return (
    <div className="sa-info" style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5 }}>
      <div>
        <span style={{ opacity: 0.65 }}>Smart Agent:</span>{' '}
        <strong><NameDisplay address={address} /></strong>
      </div>
      <div><code style={{ fontSize: 11 }}>{address}</code></div>
      {credLabel && <div style={{ opacity: 0.7 }}>control credential: {credLabel}</div>}
    </div>
  );
}
