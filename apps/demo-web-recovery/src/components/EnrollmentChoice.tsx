import { useAccount, useConnect, useConnectors } from 'wagmi';
import type { Address } from 'viem';
import type { EnrollChoice } from '../lib/enroll';

/**
 * Shared passkey/wallet enrolment picker used by Act 0 (trustees),
 * Act 1 (Sam) and Act 3 (replacement credential). Renders a radio
 * choice + (for the SIWE path) a wallet-connect row with a "use a
 * different account" button — the same multi-account dance pro uses,
 * since Alice and Bob must bind DIFFERENT EOAs.
 */
export function promptSwitchWalletAccount(
  connectors: ReturnType<typeof useConnectors>,
): Promise<Address | undefined> {
  return (async () => {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    if (!injected) return undefined;
    try {
      const provider = (await injected.getProvider()) as
        | { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined;
      if (!provider?.request) return undefined;
      try {
        await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      } catch {
        return undefined;
      }
      const accts = (await provider.request({ method: 'eth_accounts' })) as string[] | undefined;
      return (accts?.[0] as Address | undefined) ?? undefined;
    } catch {
      return undefined;
    }
  })();
}

export function EnrollmentChoice({
  choice,
  onChoice,
  idPrefix,
}: {
  choice: EnrollChoice;
  onChoice: (c: EnrollChoice) => void;
  idPrefix: string;
}) {
  const { address, isConnected, connector } = useAccount();
  const { connect, isPending } = useConnect();
  const connectors = useConnectors();

  return (
    <div className="auth-picker" style={{ margin: '8px 0', fontSize: 14 }}>
      <label style={{ display: 'block', marginBottom: 4 }}>
        <input
          type="radio"
          name={`auth-${idPrefix}`}
          checked={choice === 'passkey'}
          onChange={() => onChoice('passkey')}
        />{' '}
        <strong>Passkey</strong> <span style={{ opacity: 0.7 }}>(TouchID / FaceID — gasless)</span>
      </label>
      <label style={{ display: 'block', marginBottom: 4 }}>
        <input
          type="radio"
          name={`auth-${idPrefix}`}
          checked={choice === 'siwe'}
          onChange={() => onChoice('siwe')}
        />{' '}
        <strong>Wallet (SIWE/EOA)</strong> <span style={{ opacity: 0.7 }}>(connect MetaMask)</span>
      </label>
      {choice === 'siwe' && (
        <div style={{ marginTop: 6 }}>
          {isConnected && address ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ opacity: 0.7 }}>Connected:</span>
              <code style={{ fontSize: 12 }}>{address}</code>
              <span style={{ opacity: 0.6, fontSize: 12 }}>{connector?.name ? `via ${connector.name}` : ''}</span>
              <button
                type="button"
                style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => void promptSwitchWalletAccount(connectors)}
              >
                Use different account
              </button>
            </div>
          ) : connectors.length === 0 ? (
            <span style={{ opacity: 0.7 }}>No injected wallet detected — install MetaMask.</span>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {connectors.map((c) => (
                <button key={c.uid} type="button" disabled={isPending} onClick={() => connect({ connector: c })}>
                  Connect {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
