import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import type { Address } from 'viem';
import { readEthBalance, seedGas as seedGasReq, type PaymentWallet } from './lib/wallet';
import { fundWithUsdc, readUsdcBalance, toUsdc } from './lib/x402-pay';
import { deployPersona, providerEoa } from './lib/personas';
import type { PayCtx } from './lib/flows';

export interface AppState {
  address?: Address;
  isConnected: boolean;
  wallet?: PaymentWallet;
  connectors: ReturnType<typeof useConnect>['connectors'];
  connect: ReturnType<typeof useConnect>['connect'];
  disconnect: ReturnType<typeof useDisconnect>['disconnect'];
  ethBal: bigint;
  // the person's agents (custodied by the wallet) + the provider's treasury
  personalSa: Address | null;
  treasurySa: Address | null;
  providerTreasury: Address | null;
  treasuryUsdc: bigint;
  busy: string | null;
  status: string;
  error: string;
  setStatus: (s: string) => void;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  seedGas: () => Promise<void>;
  setupAccounts: () => Promise<void>;
  fundTreasury: (humanUsdc: number) => Promise<void>;
  refresh: () => Promise<void>;
  payCtx: () => PayCtx | null;
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
  const [personalSa, setPersonalSa] = useState<Address | null>(null);
  const [treasurySa, setTreasurySa] = useState<Address | null>(null);
  const [providerTreasury, setProviderTreasury] = useState<Address | null>(null);
  const [treasuryUsdc, setTreasuryUsdc] = useState(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (address) setEthBal(await readEthBalance(address));
    if (treasurySa) setTreasuryUsdc(await readUsdcBalance(treasurySa));
  }, [address, treasurySa]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }, []);

  const seedGas = useCallback(() => run('seed', async () => {
    if (!address) throw new Error('connect a wallet first');
    setStatus('Requesting gas from the deployer faucet…');
    const r = await seedGasReq(address);
    if (!r.ok) throw new Error(`faucet — ${r.error}${r.detail ? `: ${r.detail}` : ''}`);
    setStatus(r.skipped ? `Wallet already has gas (${r.balance} ETH).` : `Seeded ${r.amount} ETH.`);
    await new Promise((res) => setTimeout(res, r.skipped ? 0 : 3000));
    await refresh();
  }), [address, run, refresh]);

  const setupAccounts = useCallback(() => run('setup', async () => {
    if (!address) throw new Error('connect a wallet first');
    let personal = personalSa, treasury = treasurySa, provider = providerTreasury;
    if (!personal) { setStatus('Deploying your Personal Smart Agent (gasless)…'); const r = await deployPersona(address, { saltSeed: 'personal' }); if (!r.ok) throw new Error(`personal — ${r.error}`); personal = r.address; setPersonalSa(r.address); }
    if (!treasury) { setStatus('Deploying your Service Treasury SA (gasless, same custodian)…'); const r = await deployPersona(address, { saltSeed: 'treasury' }); if (!r.ok) throw new Error(`treasury — ${r.error}`); treasury = r.address; setTreasurySa(r.address); }
    if (!provider) { setStatus('Deploying the Provider Treasury SA (gasless)…'); const r = await deployPersona(providerEoa(), { saltSeed: 'provider' }); if (!r.ok) throw new Error(`provider — ${r.error}`); provider = r.address; setProviderTreasury(r.address); }
    setStatus('Accounts ready — fund the treasury, then run any flow.');
    setTreasuryUsdc(await readUsdcBalance(treasury));
  }), [address, personalSa, treasurySa, providerTreasury, run]);

  const fundTreasury = useCallback((humanUsdc: number) => run('fund', async () => {
    if (!wallet || !treasurySa) throw new Error('set up accounts first');
    setStatus(`Minting ${humanUsdc} demo USDC into your Treasury SA…`);
    await fundWithUsdc(wallet, treasurySa, toUsdc(humanUsdc));
    await new Promise((res) => setTimeout(res, 2500));
    await refresh();
    setStatus('Treasury funded.');
  }), [wallet, treasurySa, run, refresh]);

  const payCtx = useCallback((): PayCtx | null => {
    if (!wallet || !treasurySa || !providerTreasury) return null;
    return { wallet, treasurySa, providerTreasury };
  }, [wallet, treasurySa, providerTreasury]);

  const value: AppState = {
    address, isConnected, wallet, connectors, connect, disconnect, ethBal,
    personalSa, treasurySa, providerTreasury, treasuryUsdc,
    busy, status, error, setStatus, run, seedGas, setupAccounts, fundTreasury, refresh, payCtx,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
