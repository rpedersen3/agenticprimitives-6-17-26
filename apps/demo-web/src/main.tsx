import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { wagmiConfig } from './wagmi-config';

// wagmi v2 requires @tanstack/react-query for connector/account/etc.
// hooks; one shared QueryClient per app is the recommended pattern.
const queryClient = new QueryClient();

const root = createRoot(document.getElementById('root')!);
root.render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>,
);
