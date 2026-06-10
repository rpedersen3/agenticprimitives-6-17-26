/**
 * verifyDelegationToken — spec 270 v4 connection-agnostic paths.
 *
 * Covers the UniversalSignatureValidator branch (one `isValidSig` surface for ERC-1271 /
 * ERC-6492 / ECDSA, so the verifier never branches on how the user connected) and the
 * DEL-001 session-delegate binding when it is enforced (`requireSessionDelegateBinding`).
 * The leaf binds to the DELEGATOR (v4): `leaf.delegator === delegation.delegator` and
 * `leaf.delegate === sessionKeyAddress`, validated through the USV.
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
const USV = '0x7A282fFf06E6DC73613A31F55345535e24CB6832' as Address;
const TIMESTAMP_ENFORCER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address;
const SESSION_PRIV_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SESSION_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as Address;
const ATTACKER_KEY = '0x000000000000000000000000000000000000dEaD' as Address;

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
    secp256k1.sign(digest, priv(), { prehash: false, format: 'recovered' }),
    'recovered',
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

// v4 leaf: delegator === delegation.delegator (the principal SA), delegate === the session key.
const fixtureLeaf: Delegation = {
  delegator: SMART_ACCOUNT,
  delegate: SESSION_ADDR,
  authority: ROOT_AUTHORITY,
  caveats: [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(1, 9_999_999_999))],
  salt: 7n,
  signature: '0xfeed',
};

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

async function mintToken(sessionDelegation?: Delegation): Promise<string> {
  const { token } = await mintDelegationToken(
    {
      iss: 'demo-a2a',
      aud: 'urn:mcp:server:person',
      sub: SMART_ACCOUNT,
      delegation: fixtureDelegation,
      sessionKeyAddress: SESSION_ADDR,
      sessionDelegation,
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
};

describe('verifyDelegationToken — spec 270 v4 UniversalSignatureValidator', () => {
  beforeEach(() => {
    publicClient = { getCode: vi.fn(), readContract: vi.fn() };
  });

  it('validates the delegation via isValidSig (no getCode/isValidSignature) when a USV is configured', async () => {
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return true;
      return undefined;
    });
    const token = await mintToken();
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      universalSignatureValidator: USV,
    });
    expect(result).toMatchObject({ principal: SMART_ACCOUNT });
    // The connection-agnostic surface is used; the legacy deployed-ERC-1271 path is NOT.
    expect(publicClient.getCode).not.toHaveBeenCalled();
    const usvCalls = publicClient.readContract.mock.calls.filter(
      (c) => (c[0] as { functionName?: string })?.functionName === 'isValidSig',
    );
    expect(usvCalls.length).toBe(1);
  });

  it('rejects when the USV reports the delegation signature invalid', async () => {
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return false;
      return undefined;
    });
    const token = await mintToken();
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      universalSignatureValidator: USV,
    });
    expect(result).toMatchObject({ error: expect.stringContaining('signature validation failed') });
  });

  it('accepts a valid v4 leaf via the USV when binding is enforced', async () => {
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return true; // both delegation + leaf pass
      return undefined;
    });
    const token = await mintToken(fixtureLeaf);
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      universalSignatureValidator: USV,
      requireSessionDelegateBinding: true,
    });
    expect(result).toMatchObject({ principal: SMART_ACCOUNT });
    const usvCalls = publicClient.readContract.mock.calls.filter(
      (c) => (c[0] as { functionName?: string })?.functionName === 'isValidSig',
    );
    expect(usvCalls.length).toBe(2); // delegation + leaf
  });

  it('rejects the binding when no leaf is present', async () => {
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return true;
      return undefined;
    });
    const token = await mintToken(); // no sessionDelegation
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      universalSignatureValidator: USV,
      requireSessionDelegateBinding: true,
    });
    expect(result).toMatchObject({ error: expect.stringContaining('session-delegation required') });
  });

  it("rejects the binding when the leaf's delegate is not the presenting session key", async () => {
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return true;
      return undefined;
    });
    const wrongLeaf: Delegation = { ...fixtureLeaf, delegate: ATTACKER_KEY };
    const token = await mintToken(wrongLeaf);
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      universalSignatureValidator: USV,
      requireSessionDelegateBinding: true,
    });
    expect(result).toMatchObject({ error: expect.stringContaining('not the session-delegation delegate') });
  });

  it('rejects when the USV reports the leaf signature invalid', async () => {
    // delegation passes, leaf fails — distinguished by call order.
    let isValidSigCall = 0;
    publicClient.readContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return ++isValidSigCall === 1; // 1st (delegation) ok, 2nd (leaf) fails
      return undefined;
    });
    const token = await mintToken(fixtureLeaf);
    const result = await verifyDelegationToken(token, {
      ...baseOpts,
      jtiStore: memoryJti(),
      universalSignatureValidator: USV,
      requireSessionDelegateBinding: true,
    });
    expect(result).toMatchObject({ error: expect.stringContaining('session-delegation signature validation failed') });
  });
});
