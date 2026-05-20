// ConnectButton — Step 0 wallet connect UI for EOA SIWE.
// Pass 6a.2.
//
// Renders inside the existing "EOA (SIWE / mnemonic)" panel in App.tsx.
// When no wallet is connected, shows discovered EIP-6963 providers
// (MetaMask, Rainbow, Coinbase Wallet extension, etc.) as separate
// buttons. When connected, shows the address + a Disconnect.
//
// "Use the demo test wallet instead" stays as a secondary link so the
// flow still works for visitors without any browser wallet installed.

import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi';
import type { Connector } from 'wagmi';

interface ConnectButtonProps {
  /** Optional: callback after a successful connect so App.tsx can sync state. */
  onConnect?: (address: string) => void;
  /** Disabled when the user already has a session — switching wallets mid-session is footgun-y. */
  disabled?: boolean;
}

export function ConnectButton({ onConnect, disabled }: ConnectButtonProps) {
  const { address, isConnected, connector: activeConnector } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const connectors = useConnectors();

  if (isConnected && address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code>{address}</code>
        <span className="muted">
          {activeConnector?.name ? `via ${activeConnector.name}` : ''}
        </span>
        <button onClick={() => disconnect()} disabled={disabled}>
          Disconnect
        </button>
      </div>
    );
  }

  // Show one button per EIP-6963 provider. Sort by name for stability.
  const sorted = [...connectors].sort((a: Connector, b: Connector) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {sorted.map((c) => (
        <button
          key={c.uid}
          disabled={disabled || isPending}
          onClick={() =>
            connect(
              { connector: c },
              {
                onSuccess: (data) => {
                  if (data.accounts[0]) onConnect?.(data.accounts[0]);
                },
              },
            )
          }
        >
          Connect {c.name}
        </button>
      ))}
      {sorted.length === 0 && (
        <span className="muted">
          No browser wallet detected — install MetaMask / Rainbow / Coinbase
          Wallet, or fall back to the demo test wallet below.
        </span>
      )}
    </div>
  );
}
