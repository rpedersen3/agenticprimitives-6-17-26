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
