/**
 * verifyDelegationToken — requireDeployed branch tests.
 *
 * Asserts the security invariant that an undeployed delegator smart account
 * is REJECTED by default (no ERC-1271 ⇒ no security guarantees). The lenient
 * branch (`requireDeployed: false`) exists only for explicit counterfactual-
 * demo opt-ins and must stay opt-in.
 *
 * RPC calls are mocked at the viem boundary so the test runs offline.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { mintDelegationToken, verifyDelegationToken } from '../../src/token';
import { ROOT_AUTHORITY } from '../../src/types';
import { buildCaveat, encodeTimestampTerms } from '../../src/caveats';
import type { Delegation, JtiStore } from '../../src/types';
import type { Address } from '@agenticprimitives/types';

const SMART_ACCOUNT = '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' as Address;
const DM = '0x000000000000000000000000000000000000beef' as Address;
const TIMESTAMP_ENFORCER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address;
const SESSION_PRIV_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SESSION_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address;

function priv(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(SESSION_PRIV_HEX.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function eip191Sign(msg: string): `0x${string}` {
  const bytes = new TextEncoder().encode(msg);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix, 0);
  combined.set(bytes, prefix.length);
  const digest = keccak_256(combined);
  const s = secp256k1.Signature.fromBytes(
    secp256k1.sign(digest, priv(), { prehash: false, format: "recovered" }),
    "recovered",
  );
  const r = s.r.toString(16).padStart(64, '0');
  const ss = s.s.toString(16).padStart(64, '0');
  const v = (s.recovery ?? 0) + 27;
  return ('0x' + r + ss + v.toString(16).padStart(2, '0')) as `0x${string}`;
}

const fixtureDelegation: Delegation = {
  delegator: SMART_ACCOUNT,
  delegate: SESSION_ADDR,
  authority: ROOT_AUTHORITY,
  caveats: [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(1, 9_999_999_999))],
  salt: 42n,
  signature: '0xdeadbeef',
};

// In-memory JTI store (test-only).
function memoryJti(): JtiStore {
  const used = new Set<string>();
  return {
    trackUsage: async (jti) => {
      if (used.has(jti)) return { allowed: false, count: 1 };
      used.add(jti);
      return { allowed: true, count: 1 };
    },
  };
}

// Mock viem so getCode + readContract are controllable per test.
type MockPublicClient = {
  getCode: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
};
let publicClient: MockPublicClient;

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: () => publicClient as unknown as ReturnType<typeof actual.createPublicClient>,
    http: actual.http,
  };
});

async function mintFixtureToken(): Promise<string> {
  const { token } = await mintDelegationToken(
    {
      iss: 'demo-a2a',
      aud: 'urn:mcp:server:person',
      sub: SMART_ACCOUNT,
      delegation: fixtureDelegation,
      sessionKeyAddress: SESSION_ADDR,
      ttlSeconds: 300,
    },
    eip191Sign,
  );
  return token;
}

const baseOpts = {
  audience: 'urn:mcp:server:person',
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  delegationManager: DM,
  enforcerMap: {
    delegationManager: DM,
    timestamp: TIMESTAMP_ENFORCER,
    value: '0x0000000000000000000000000000000000000001' as Address,
    allowedTargets: '0x0000000000000000000000000000000000000002' as Address,
    allowedMethods: '0x0000000000000000000000000000000000000003' as Address,
  },
  toolName: 'get_profile',
  // DEL-001 (ADR-0036): binding is enforced by default now; these legacy fixtures have no
  // sessionDelegation leaf, so this suite (which exercises the requireDeployed branch) opts out.
  allowUnboundSessionToken: true as boolean,
};

describe('verifyDelegationToken — requireDeployed branch', () => {
  beforeEach(() => {
    publicClient = {
      getCode: vi.fn(),
      readContract: vi.fn(),
    };
    // Default: not revoked.
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      return undefined;
    });
  });

  it('rejects undeployed delegator by default (requireDeployed=true implicit)', async () => {
    publicClient.getCode.mockResolvedValue('0x'); // not deployed
    const token = await mintFixtureToken();
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
    });
    expect(result).toMatchObject({ error: expect.stringContaining('not deployed') });
  });

  it('rejects undeployed delegator when requireDeployed=true explicit', async () => {
    publicClient.getCode.mockResolvedValue('0x');
    const token = await mintFixtureToken();
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      requireDeployed: true,
    });
    expect(result).toMatchObject({ error: expect.stringContaining('not deployed') });
  });

  // DEL-001 (ADR-0036): binding is enforced by DEFAULT; the canonical "rejects when no leaf" case lives
  // in verify-universal-validator.test.ts. Here we just prove the explicit legacy opt-out path works.
  it('SKIPS the binding check when allowUnboundSessionToken=true (explicit legacy opt-out)', async () => {
    publicClient.getCode.mockResolvedValue('0x1234');
    const token = await mintFixtureToken();
    // baseOpts already sets allowUnboundSessionToken: true → verification proceeds past binding
    // (it may still reject later for other fixture reasons, but NOT on the missing leaf).
    const result = await verifyDelegationToken(token, { ...baseOpts, jtiStore: memoryJti() });
    const err = (result as { error?: string }).error;
    expect(err === undefined || !/session-delegation/i.test(err)).toBe(true);
  });

  it('tolerates undeployed delegator when requireDeployed=false (explicit opt-in)', async () => {
    publicClient.getCode.mockResolvedValue('0x'); // not deployed
    const token = await mintFixtureToken();
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      requireDeployed: false,
    });
    // Should not error on the deployment check. The rest of the chain runs.
    // readContract for isValidSignature is NOT called when account is undeployed.
    expect(result).not.toMatchObject({ error: expect.stringContaining('not deployed') });
    expect(result).toMatchObject({ principal: SMART_ACCOUNT });
  });

  it('does not call isValidSignature on an undeployed account even with opt-in', async () => {
    publicClient.getCode.mockResolvedValue('0x');
    const token = await mintFixtureToken();
    await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      requireDeployed: false,
    });
    const isValidSignatureCalls = publicClient.readContract.mock.calls.filter(
      (call) => (call[0] as { functionName?: string })?.functionName === 'isValidSignature',
    );
    expect(isValidSignatureCalls.length).toBe(0);
  });

  it('calls isValidSignature when the account IS deployed (default opts)', async () => {
    publicClient.getCode.mockResolvedValue('0x60606040'); // deployed
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSignature') return '0x1626ba7e'; // ERC-1271 magic
      return undefined;
    });
    const token = await mintFixtureToken();
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
    });
    expect(result).toMatchObject({ principal: SMART_ACCOUNT });
    const isValidSignatureCalls = publicClient.readContract.mock.calls.filter(
      (call) => (call[0] as { functionName?: string })?.functionName === 'isValidSignature',
    );
    expect(isValidSignatureCalls.length).toBe(1);
  });
});
