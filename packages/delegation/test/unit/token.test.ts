import { describe, it, expect, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { createMemoryAuditSink } from '@agenticprimitives/audit';
import { mintDelegationToken } from '../../src/token';
import { ROOT_AUTHORITY } from '../../src/types';
import { buildCaveat, encodeTimestampTerms } from '../../src/caveats';
import type { Delegation } from '../../src/types';

const SMART_ACCOUNT = '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' as const;
const DELEGATE = '0x9876543210987654321098765432109876543210' as const;
const TIMESTAMP_ENFORCER = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;

const SESSION_PRIV_HEX = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SESSION_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

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
  delegate: SESSION_ADDR as `0x${string}`,
  authority: ROOT_AUTHORITY,
  caveats: [buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(1, 9_999_999_999))],
  salt: 42n,
  signature: '0xdeadbeef',
};

describe('mintDelegationToken', () => {
  it('produces a 2-part token (canonicalJSON.signature)', async () => {
    const { token, jti } = await mintDelegationToken(
      {
        iss: 'demo-a2a',
        aud: 'urn:mcp:server:person',
        sub: SMART_ACCOUNT,
        delegation: fixtureDelegation,
        sessionKeyAddress: SESSION_ADDR as `0x${string}`,
        ttlSeconds: 300,
      },
      eip191Sign,
    );
    expect(token.split('.')).toHaveLength(2);
    expect(jti).toMatch(/^jti_/);
  });

  it('encodes claims sorted-key with BigInt salt as numeric string', async () => {
    const { token } = await mintDelegationToken(
      {
        iss: 'demo-a2a',
        aud: 'urn:mcp:server:person',
        sub: SMART_ACCOUNT,
        delegation: fixtureDelegation,
        sessionKeyAddress: SESSION_ADDR as `0x${string}`,
      },
      eip191Sign,
    );
    const [b64] = token.split('.');
    const decoded = Buffer.from(b64!.replace(/-/g, '+').replace(/_/g, '/') + '===', 'base64').toString('utf8');
    // salt should be a string, not a number
    expect(decoded).toContain('"salt":"42"');
    // Keys are sorted: aud before delegation before exp …
    const audIdx = decoded.indexOf('"aud"');
    const delIdx = decoded.indexOf('"delegation"');
    const subIdx = decoded.indexOf('"sub"');
    expect(audIdx).toBeLessThan(delIdx);
    expect(delIdx).toBeLessThan(subIdx);
  });

  it('accepts a caller-supplied jti', async () => {
    const { jti } = await mintDelegationToken(
      {
        iss: 'demo-a2a',
        aud: 'urn:mcp:server:person',
        sub: SMART_ACCOUNT,
        delegation: fixtureDelegation,
        sessionKeyAddress: SESSION_ADDR as `0x${string}`,
        jti: 'custom_jti_abc',
      },
      eip191Sign,
    );
    expect(jti).toBe('custom_jti_abc');
  });

  it('calls signMessage exactly once with the canonical claims string', async () => {
    const signMessage = vi.fn(eip191Sign);
    await mintDelegationToken(
      {
        iss: 'demo-a2a',
        aud: 'urn:mcp:server:person',
        sub: SMART_ACCOUNT,
        delegation: fixtureDelegation,
        sessionKeyAddress: SESSION_ADDR as `0x${string}`,
      },
      signMessage,
    );
    expect(signMessage).toHaveBeenCalledOnce();
    expect(signMessage.mock.calls[0]![0]).toContain('"aud":"urn:mcp:server:person"');
  });

  // C3 pass 5b: minting emits a delegation.mint audit row.
  it('emits delegation.mint when auditSink is wired', async () => {
    const sink = createMemoryAuditSink();
    const { jti } = await mintDelegationToken(
      {
        iss: 'demo-a2a',
        aud: 'urn:mcp:server:person',
        sub: SMART_ACCOUNT,
        delegation: fixtureDelegation,
        sessionKeyAddress: SESSION_ADDR as `0x${string}`,
      },
      eip191Sign,
      { auditSink: sink, correlationId: 'corr-abc' },
    );

    const events = sink.events();
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.action).toBe('delegation.mint');
    expect(evt.outcome).toBe('success');
    expect(evt.correlationId).toBe('corr-abc');
    expect(evt.subject).toEqual({ type: 'jti', id: jti });
    expect(evt.audience).toBe('urn:mcp:server:person');
  });

  // R11.1 / N16: contract REVERSED. Previously asserted fail-soft (the
  // wrapper swallowed sink errors). That OVERRODE the caller's
  // sink-composition intent — a production caller passing
  // `composeFailHardSinks(...)` to enforce durable audit for
  // security-critical events had their fail-hard contract silently
  // bypassed. New contract: the sink composition expresses the caller's
  // intent; the mint flow honors it. Callers who want fail-soft compose
  // with `composeSinks(...)` (which absorbs per-sink errors by design).
  it('R11.1: a throwing audit sink PROPAGATES — no silent swallow', async () => {
    const throwingSink = {
      async write() {
        throw new Error('[audit:fail-hard] sink down');
      },
    };
    await expect(
      mintDelegationToken(
        {
          iss: 'demo-a2a',
          aud: 'urn:mcp:server:person',
          sub: SMART_ACCOUNT,
          delegation: fixtureDelegation,
          sessionKeyAddress: SESSION_ADDR as `0x${string}`,
        },
        eip191Sign,
        { auditSink: throwingSink },
      ),
    ).rejects.toThrow(/fail-hard|sink down/);
  });
});
