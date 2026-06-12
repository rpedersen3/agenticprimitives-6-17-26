import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import type { Address } from 'viem';
import { readEthBalance, seedGas as seedGasReq, type PaymentWallet } from './lib/wallet';
import { fundWithUsdc, readUsdcBalance, toUsdc } from './lib/x402-pay';
import { providerEoa } from './lib/personas';

export interface AppState {
  address?: Address;
  isConnected: boolean;
  wallet?: PaymentWallet;
  connectors: ReturnType<typeof useConnect>['connectors'];
  connect: ReturnType<typeof useConnect>['connect'];
  disconnect: ReturnType<typeof useDisconnect>['disconnect'];
  ethBal: bigint;
  walletUsdc: bigint;
  /** a stable demo provider/treasury address (receives USDC in the EOA-payer flows) */
  treasury: Address;
  busy: string | null;
  status: string;
  error: string;
  setStatus: (s: string) => void;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  seedGas: () => Promise<void>;
  fundWallet: (humanUsdc: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const wallet = walletClient as unknown as PaymentWallet | undefined;

  const [ethBal, setEthBal] = useState(0n);
  const [walletUsdc, setWalletUsdc] = useState(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const treasury = providerEoa();

  const refresh = useCallback(async () => {
    if (!address) return;
    setEthBal(await readEthBalance(address));
    setWalletUsdc(await readUsdcBalance(address));
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const seedGas = useCallback(
    () =>
      run('seed', async () => {
        if (!address) throw new Error('connect a wallet first');
        setStatus('Requesting gas from the deployer faucet…');
        const r = await seedGasReq(address);
        if (!r.ok) throw new Error(`faucet — ${r.error}${r.detail ? `: ${r.detail}` : ''}`);
        setStatus(r.skipped ? `Wallet already has gas (${r.balance} ETH).` : `Seeded ${r.amount} ETH.`);
        await new Promise((res) => setTimeout(res, r.skipped ? 0 : 3000));
        await refresh();
      }),
    [address, run, refresh],
  );

  const fundWallet = useCallback(
    (humanUsdc: number) =>
      run('fund', async () => {
        if (!wallet || !address) throw new Error('connect a wallet first');
        setStatus(`Minting ${humanUsdc} demo USDC into your wallet…`);
        await fundWithUsdc(wallet, address, toUsdc(humanUsdc));
        await new Promise((res) => setTimeout(res, 2500));
        await refresh();
        setStatus('Wallet funded with USDC.');
      }),
    [wallet, address, run, refresh],
  );

  const value: AppState = {
    address, isConnected, wallet, connectors, connect, disconnect,
    ethBal, walletUsdc, treasury, busy, status, error, setStatus,
    run, seedGas, fundWallet, refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
