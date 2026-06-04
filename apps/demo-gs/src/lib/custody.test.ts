import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { JANE_CUSTODIAN, JANE_EOA, PETE_CUSTODIAN, PETE_EOA } from './personas';
import { personaSignHash } from './chain';

// Spec 252 R2: the key-bearing custodian MUST be the same EOA the rest of demo-gs references, or the
// vault-owning Switchboard SA (derived from this custodian) would never match what the app shows.
describe('operator custody (spec 252)', () => {
  it('Jane/Pete custodians match their public EOA exports', () => {
    expect(JANE_CUSTODIAN.address).toBe(JANE_EOA);
    expect(PETE_CUSTODIAN.address).toBe(PETE_EOA);
  });

  it('the custodian private key derives its own address', () => {
    expect(privateKeyToAccount(JANE_CUSTODIAN.privateKey).address).toBe(JANE_CUSTODIAN.address);
  });

  it('personaSignHash produces a 65-byte ECDSA signature', async () => {
    const sig = await personaSignHash(JANE_CUSTODIAN)(`0x${'ab'.repeat(32)}`);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
