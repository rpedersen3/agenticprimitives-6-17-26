/**
 * Demo-state — tracks the Org Smart Agent + Treasury Smart Agent
 * addresses that the demo has deployed.
 *
 * Conceptually separate from `seats.ts`: seats track CONNECTED users
 * (Alice / Bob). This module tracks deployed AGENTS that ALL users
 * see (Acme Construction, Acme Treasury). Both persist to localStorage
 * for demo continuity.
 *
 * On reset, this is wiped alongside seats so the demo starts clean.
 */

import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:demo-state';

export interface OrgRecord {
  /** AgentAccount address. */
  address: Address;
  /** Tx hash that deployed it. */
  txHash: Hex;
  /** Mode at deploy time (1 = hybrid). */
  mode: number;
  /** Custodian set at deploy time. */
  custodians: Address[];
  /** ISO timestamp. */
  createdAt: string;
}

export interface TreasuryRecord {
  address: Address;
  txHash: Hex;
  mode: number;
  custodians: Address[];
  createdAt: string;
}

interface DemoStateRecord {
  org?: OrgRecord;
  treasury?: TreasuryRecord;
}

function read(): DemoStateRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as DemoStateRecord;
  } catch {
    return {};
  }
}

function write(state: DemoStateRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event('demo-state:update'));
}

export function loadDemoState(): DemoStateRecord {
  return read();
}

export function loadOrg(): OrgRecord | null {
  return read().org ?? null;
}

export function loadTreasury(): TreasuryRecord | null {
  return read().treasury ?? null;
}

export function saveOrg(record: OrgRecord): void {
  const state = read();
  state.org = record;
  write(state);
}

export function saveTreasury(record: TreasuryRecord): void {
  const state = read();
  state.treasury = record;
  write(state);
}

export function clearDemoState(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('demo-state:update'));
}

export function clearStrandedOrg(): void {
  const state = read();
  delete state.org;
  write(state);
}

export function clearStrandedTreasury(): void {
  const state = read();
  delete state.treasury;
  write(state);
}

export function subscribeDemoState(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener('demo-state:update', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('demo-state:update', listener);
    window.removeEventListener('storage', onStorage);
  };
}
