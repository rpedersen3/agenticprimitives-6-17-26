// Base Sepolia (chain 84532) config for the REAL Connect directory (spec 227).
// Addresses are the deployed contracts in apps/contracts/deployments-base-sepolia.json
// (public on-chain addresses — safe to inline; that file remains the source of truth).
// Spec 227 F2/P1-D: the real experience runs on 84532, NOT the old broker-core CHAIN=8453.

import type { Address } from '@agenticprimitives/types';

export const CHAIN_ID = 84532;

/** Public Base Sepolia RPC. Override with RPC_URL (server) / VITE_RPC_URL (browser). */
export const DEFAULT_RPC_URL = 'https://sepolia.base.org';

/** Deployed Base Sepolia contracts (from deployments-base-sepolia.json). */
export const CONTRACTS = {
  entryPoint: '0x094700EB9F743F462b0E59a68084d6be56F3Ed96',
  agentAccountFactory: '0x7Aac638824014210349497440D3CE631A95b466c',
  agentAccountImplementation: '0x235FD455040874B224A671456DA06221868a9CA1',
  agentNameRegistry: '0xE9Bf4f67701Ba6eD7843b9848c3fe0C6e0212427',
  agentNameUniversalResolver: '0xb66a4829606C4E1C5eB424314b681343c747b4B2',
  custodyPolicy: '0xfdbCB192182712C996a1Ed2FB74D0FE6e7d9db26',
  permissionlessSubregistry: '0xAF6cA36De55296C12F2f7462645c3282f7bc1eeD',
  agentRelationship: '0xB85BA211d6528BE2561a41b629537e5054B648DF',
} as const satisfies Record<string, Address>;
