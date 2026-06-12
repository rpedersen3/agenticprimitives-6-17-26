// wagmi configuration for demo-web-pro. Matches demo-web's shape so
// users can use the same browser wallets across both apps. See
// apps/demo-web/src/wagmi-config.ts for the rationale.

import { createConfig, createStorage, http } from 'wagmi';
import { baseSepolia, mainnet } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [baseSepolia, mainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [baseSepolia.id]: http(),
    [mainnet.id]: http(),
  },
  storage: createStorage({
    storage: typeof window !== 'undefined' ? window.localStorage : (undefined as never),
  }),
  multiInjectedProviderDiscovery: true,
});
