/**
 * DEL-001 remint-attack regression (the audit's explicit required closure).
 *
 * Threat: an attacker OBSERVES a delegation token in flight, extracts the embedded `delegation`
 * (delegator = the victim's SA), and tries to re-mint a token signed with the ATTACKER's own session
 * key — impersonating the delegator. With `requireSessionDelegateBinding` on, every such attempt must
 * fail, because the token must carry a `sessionDelegation` leaf that (a) binds to the victim SA as
 * delegator, (b) names the PRESENTING session key as delegate, and (c) is signed by the victim SA
 * (validated via the UniversalSignatureValidator). The attacker controls none of those.
 *
 * Proven below: the legit token verifies; all three re-mint variants are rejected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { mintDelegationToken, verifyDelegationToken } from '../../src/token';
import { ROOT_AUTHORITY } from '../../src/types';
import { buildCaveat, encodeTimestampTerms } from '../../src/caveats';
import type { Delegation, JtiStore } from '../../src/types';
import type { Address } from '@agenticprimitives/types';

const VICTIM_SA = '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' as Address; // the delegator (victim)
const RELYING_SA = '0x000000000000000000000000000000000000d00d' as Address; // delegation.delegate
const DM = '0x000000000000000000000000000000000000beef' as Address;
const USV = '0x7A282fFf06E6DC73613A31F55345535e24CB6832' as Address;
const TIMESTAMP_ENFORCER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Address;

// Two session keypairs: the legit member's, and the attacker's (well-known Anvil keys).
const MEMBER_PRIV = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ATTACKER_PRIV = '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const LEGIT_LEAF_SIG = '0x1eaf1eaf'; // the victim SA's signature over the leaf (USV-valid)
const FORGED_LEAF_SIG = '0xattacker' as `0x${string}`; // attacker can't sign as the victim (USV-invalid)

function priv(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function addrOf(privHex: string): Address {
  const pub = secp256k1.getPublicKey(priv(privHex), false); // uncompressed
  const hash = keccak_256(pub.slice(1));
  let hex = '0x';
  for (const b of hash.slice(12)) hex += b.toString(16).padStart(2, '0');
  return hex as Address;
}

function eip191Sign(message: string, privHex: string): `0x${string}` {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix, 0);
  combined.set(bytes, prefix.length);
  const digest = keccak_256(combined);
  const s = secp256k1.Signature.fromBytes(
    secp256k1.sign(digest, priv(privHex), { prehash: false, format: 'recovered' }),
    'recovered',
  );
  const r = s.r.toString(16).padStart(64, '0');
  const ss = s.s.toString(16).padStart(64, '0');
  const v = (s.recovery ?? 0) + 27;
  return ('0x' + r + ss + v.toString(16).padStart(2, '0')) as `0x${string}`;
}

const MEMBER_SK = addrOf(MEMBER_PRIV);
const ATTACKER_SK = addrOf(ATTACKER_PRIV);

// The delegation the attacker observes + extracts (delegator = the victim SA).
const observedDelegation: Delegation = {
  delegator: VICTIM_SA,
  delegate: RELYING_SA,
  authority: ROOT_AUTHORITY,
  caveats: [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(1, 9_999_999_999))],
  salt: 42n,
  signature: '0xde1e6a7e', // victim SA's signature over the delegation (USV-valid)
};

const leaf = (delegate: Address, signature: string): Delegation => ({
  delegator: VICTIM_SA,
  delegate,
  authority: ROOT_AUTHORITY,
  caveats: [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(1, 9_999_999_999))],
  salt: 7n,
  signature: signature as `0x${string}`,
});

function memoryJti(): JtiStore {
  const used = new Set<string>();
  return {
    trackUsage: async (jti) => (used.has(jti) ? { allowed: false, count: 1 } : (used.add(jti), { allowed: true, count: 1 })),
  };
}

type MockPublicClient = { getCode: ReturnType<typeof vi.fn>; readContract: ReturnType<typeof vi.fn> };
let publicClient: MockPublicClient;
vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return { ...actual, createPublicClient: () => publicClient as unknown as ReturnType<typeof actual.createPublicClient>, http: actual.http };
});

async function mint(sessionPrivHex: string, sessionKeyAddress: Address, sessionDelegation?: Delegation): Promise<string> {
  const { token } = await mintDelegationToken(
    {
      iss: 'attacker-or-member',
      aud: 'urn:mcp:server:person',
      sub: VICTIM_SA,
      delegation: observedDelegation,
      sessionKeyAddress,
      sessionDelegation,
      ttlSeconds: 300,
    },
    (msg) => eip191Sign(msg, sessionPrivHex),
  );
  return token;
}

const opts = () => ({
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
  jtiStore: memoryJti(),
  universalSignatureValidator: USV,
  requireSessionDelegateBinding: true,
});

describe('DEL-001 — observe-and-re-mint attack is rejected', () => {
  beforeEach(() => {
    publicClient = { getCode: vi.fn(), readContract: vi.fn() };
    // USV: a signature validates UNLESS it is the attacker's forged leaf signature (the attacker
    // cannot produce the victim SA's signature). isRevoked = false.
    publicClient.readContract.mockImplementation((args: { functionName: string; args?: unknown[] }) => {
      if (args.functionName === 'isRevoked') return false;
      if (args.functionName === 'isValidSig') return (args.args?.[2] as string) !== FORGED_LEAF_SIG;
      return undefined;
    });
  });

  it('LEGIT: the member mints with its own session key + a victim-signed leaf → accepted', async () => {
    const token = await mint(MEMBER_PRIV, MEMBER_SK, leaf(MEMBER_SK, LEGIT_LEAF_SIG));
    const result = await verifyDelegationToken(token, opts());
    expect(result).toMatchObject({ principal: VICTIM_SA });
  });

  it('ATTACK 1: attacker re-mints with their OWN session key but REUSES the member leaf → rejected', async () => {
    // The observed leaf names MEMBER_SK as delegate; the presenting key is ATTACKER_SK. Binding breaks.
    const token = await mint(ATTACKER_PRIV, ATTACKER_SK, leaf(MEMBER_SK, LEGIT_LEAF_SIG));
    const result = await verifyDelegationToken(token, opts());
    expect(result).toMatchObject({ error: expect.stringContaining('not the session-delegation delegate') });
  });

  it('ATTACK 2: attacker forges a leaf for THEIR key, but cannot sign it as the victim → rejected', async () => {
    // Leaf shape is right (delegator = victim, delegate = ATTACKER_SK) but the signature is not the
    // victim SA's — the UniversalSignatureValidator rejects it.
    const token = await mint(ATTACKER_PRIV, ATTACKER_SK, leaf(ATTACKER_SK, FORGED_LEAF_SIG));
    const result = await verifyDelegationToken(token, opts());
    expect(result).toMatchObject({ error: expect.stringContaining('session-delegation signature validation failed') });
  });

  it('ATTACK 3: attacker strips the leaf entirely → rejected (binding required)', async () => {
    const token = await mint(ATTACKER_PRIV, ATTACKER_SK, undefined);
    const result = await verifyDelegationToken(token, opts());
    expect(result).toMatchObject({ error: expect.stringContaining('session-delegation required') });
  });
});
