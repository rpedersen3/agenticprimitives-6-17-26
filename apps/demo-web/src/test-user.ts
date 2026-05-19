// Demo-only EOA user. Generates a private key on first use and persists it
// in localStorage. NEVER ship a pattern like this to production — this is
// purely for the local demo / preview environment.

import { mnemonicToAccount, generateMnemonic, english } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';

const STORAGE_KEY = 'agenticprimitives:demo:mnemonic';

export interface DemoUser {
  mnemonic: string;
  account: ReturnType<typeof mnemonicToAccount>;
  address: Address;
}

export function loadOrCreateDemoUser(): DemoUser {
  let mnemonic = localStorage.getItem(STORAGE_KEY);
  if (!mnemonic) {
    mnemonic = generateMnemonic(english);
    localStorage.setItem(STORAGE_KEY, mnemonic);
  }
  const account = mnemonicToAccount(mnemonic);
  return {
    mnemonic,
    account,
    address: account.address as Address,
  };
}

export function resetDemoUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}
