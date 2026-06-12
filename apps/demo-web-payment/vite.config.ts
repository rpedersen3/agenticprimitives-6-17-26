import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createWalletClient, createPublicClient, http, parseEther, isAddress, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

/**
 * DEV-ONLY gas faucet. Reads the deployer key from the process env (sourced
 * from .env.deploy.local when you start the dev server) and drips a little
 * Base Sepolia ETH to the connected wallet so it can pay for the mint +
 * redemption gas. The key lives ONLY in the dev-server process — it is never
 * imported by app code and never reaches the browser bundle. Not present in a
 * production build (configureServer only runs under `vite dev`).
 */
function devGasFaucet(): Plugin {
  const TARGET = parseEther('0.0002'); // top recipients up to ~0.0002 ETH — plenty for a few L2 txs
  const FLOOR = parseEther('0.00008'); // …only if they're below this
  const lastSend = new Map<string, number>();

  return {
    name: 'dev-gas-faucet',
    configureServer(server) {
      server.middlewares.use('/api/dev-gas', (req, res) => {
        const pk = process.env.PRIVATE_KEY;
        const rpc = process.env.BASE_SEPOLIA_RPC;
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only' });
        if (!pk || !rpc) {
          return send(503, { ok: false, error: 'faucet_unconfigured', detail: 'start dev with PRIVATE_KEY + BASE_SEPOLIA_RPC in env (source .env.deploy.local)' });
        }
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          try {
            const { to } = JSON.parse(raw || '{}') as { to?: string };
            if (!to || !isAddress(to)) return send(400, { ok: false, error: 'bad_address' });
            const now = Date.now();
            const prev = lastSend.get(to.toLowerCase()) ?? 0;
            if (now - prev < 15_000) return send(429, { ok: false, error: 'rate_limited', detail: 'wait ~15s' });

            const account = privateKeyToAccount(pk.startsWith('0x') ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));
            const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
            const bal = await pub.getBalance({ address: to as `0x${string}` });
            if (bal >= FLOOR) {
              return send(200, { ok: true, skipped: true, balance: formatEther(bal), detail: 'already funded' });
            }
            const amount = TARGET - bal;
            const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
            lastSend.set(to.toLowerCase(), now);
            const hash = await wallet.sendTransaction({ to: to as `0x${string}`, value: amount });
            return send(200, { ok: true, hash, amount: formatEther(amount), from: account.address });
          } catch (e) {
            return send(500, { ok: false, error: 'faucet_failed', detail: e instanceof Error ? e.message : String(e) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devGasFaucet()],
  resolve: {
    alias: {
      '@agenticprimitives/agent-account': new URL(
        '../../packages/agent-account/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
  server: {
    // Different port from demo-web (5173) so both apps can run side-by-side
    // in dev without conflict.
    port: 5273,
    proxy: {
      '/a2a': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
