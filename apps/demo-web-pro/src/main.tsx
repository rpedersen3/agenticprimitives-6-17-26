import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { wagmiConfig } from './wagmi-config';

// wagmi v2 needs @tanstack/react-query for connector + account hooks.
// One shared QueryClient per app (standard pattern).
const queryClient = new QueryClient();

const root = createRoot(document.getElementById('root')!);
root.render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>,
);
