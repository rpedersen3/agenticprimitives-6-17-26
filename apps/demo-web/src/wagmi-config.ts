// wagmi configuration for demo-web. Pass 6a.2.
//
// This commit ships **injected-only**: EIP-6963 multi-provider
// discovery picks up MetaMask, Rainbow extension, Coinbase Wallet
// extension, Frame, Trust, and any other browser wallet that
// announces itself per EIP-6963. WalletConnect (mobile QR) lands in
// 6a.3 once a Reown project id is wired — without it the WC
// connector throws at runtime, and bundling it always would add
// ~150kB before any user actually used it.
//
// Chain support: Base Sepolia (the demo's deploy target) + mainnet for
// any wallets that auto-resolve external name systems. We don't talk to RPC from the
// browser (the demo-a2a Worker relays via /a2a/account/derive-address);
// the transports are just for wagmi's internal balance reads + chain
// switching prompts.
//
// Storage: createStorage({ storage: localStorage }) so the chosen
// connector persists across reloads.

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

export const SUPPORTED_CHAIN_IDS = [baseSepolia.id, mainnet.id] as const;
