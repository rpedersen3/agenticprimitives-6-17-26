// ConnectButton — shared shape with demo-web. Same EIP-6963 multi-
// injected discovery, same disconnect affordance. demo-web-pro
// shows this at the top of every flow so users can pick which
// wallet (MetaMask / Rainbow / Coinbase / etc.) is the primary
// signer for the account they're about to deploy.

import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi';
import type { Connector } from 'wagmi';

interface ConnectButtonProps {
  disabled?: boolean;
}

export function ConnectButton({ disabled }: ConnectButtonProps) {
  const { address, isConnected, connector: activeConnector } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const connectors = useConnectors();

  if (isConnected && address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code data-testid="connected-address">{address}</code>
        <span className="muted">{activeConnector?.name ? `via ${activeConnector.name}` : ''}</span>
        <button onClick={() => disconnect()} disabled={disabled} data-testid="disconnect">
          Disconnect
        </button>
      </div>
    );
  }

  const sorted = [...connectors].sort((a: Connector, b: Connector) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {sorted.map((c) => (
        <button
          key={c.uid}
          disabled={disabled || isPending}
          onClick={() => connect({ connector: c })}
          data-testid={`connect-${c.id}`}
        >
          Connect {c.name}
        </button>
      ))}
      {sorted.length === 0 && (
        <span className="muted">
          No browser wallet detected — install MetaMask / Rainbow / Coinbase Wallet to connect.
        </span>
      )}
    </div>
  );
}
