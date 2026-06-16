// spec 276 KCS-D6 — generic named delegated-signer resolution. Naming + account are
// injected; the delegation chain is verified by authority linkage (rooted at the named
// SA, terminating at the signer key). Fail-closed on any break.
import { describe, it, expect } from 'vitest';
import { type Address } from 'viem';
import { type Delegation, hashDelegation, ROOT_AUTHORITY } from '@agenticprimitives/delegation';
import type { KmsAccountBackend } from '@agenticprimitives/key-custody';
import { resolveDelegatedSigner } from '../../src/index.js';

const SA = ('0x' + '11'.repeat(20)) as Address;
const MID = ('0x' + '22'.repeat(20)) as Address;
const SIGNER = ('0x' + '33'.repeat(20)) as Address;
const DM = ('0x' + '44'.repeat(20)) as Address;
const CHAIN_ID = 8453;

function fakeSigner(addr: Address = SIGNER): KmsAccountBackend {
  return {
    provider: 'gcp-kms',
    async getSignerAddress() {
      return addr;
    },
    async signA2AAction() {
      const sig = new Uint8Array(65).fill(9);
      sig[64] = 28;
      return { signature: sig, keyId: 'k', signerAddress: addr };
    },
  };
}

function rootDeleg(delegate: Address): Delegation {
  return { delegator: SA, delegate, authority: ROOT_AUTHORITY, caveats: [], salt: 0n, signature: '0x' };
}
function childDeleg(parent: Delegation, delegate: Address): Delegation {
  return {
    delegator: parent.delegate,
    delegate,
    authority: hashDelegation(parent, CHAIN_ID, DM),
    caveats: [],
    salt: 1n,
    signature: '0x',
  };
}

const base = {
  name: 'acme',
  resolveName: async (n: string) => (n === 'acme' ? SA : null),
  verifyAccount: async () => true,
  chainId: CHAIN_ID,
  delegationManager: DM,
};

describe('resolveDelegatedSigner', () => {
  it('resolves a two-link chain rooted at the named SA, terminating at the signer', async () => {
    const root = rootDeleg(MID);
    const leaf = childDeleg(root, SIGNER);
    const r = await resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [root, leaf] });
    expect(r.delegatorAgent).toBe(SA);
    expect(r.signerAddress).toBe(SIGNER);
    const sig = await r.sign(new Uint8Array(32));
    expect(sig.startsWith('0x')).toBe(true);
    expect(sig.length).toBe(2 + 130);
  });

  it('resolves a single root link that delegates directly to the signer', async () => {
    const root = rootDeleg(SIGNER);
    const r = await resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [root] });
    expect(r.signerAddress).toBe(SIGNER);
  });

  it('rejects an empty chain', async () => {
    await expect(resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [] })).rejects.toThrow(/empty/);
  });

  it('rejects an unresolved name', async () => {
    const root = rootDeleg(SIGNER);
    await expect(
      resolveDelegatedSigner({ ...base, name: 'nope', signer: fakeSigner(), delegationChain: [root] }),
    ).rejects.toThrow(/did not resolve/);
  });

  it('rejects an invalid account (fail-closed)', async () => {
    const root = rootDeleg(SIGNER);
    await expect(
      resolveDelegatedSigner({ ...base, verifyAccount: async () => false, signer: fakeSigner(), delegationChain: [root] }),
    ).rejects.toThrow(/not a valid\/deployed account/);
  });

  it('rejects a chain not rooted at the named SA', async () => {
    const root = { ...rootDeleg(SIGNER), delegator: MID };
    await expect(
      resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [root] }),
    ).rejects.toThrow(/root delegator does not match/);
  });

  it('rejects a non-root chain[0]', async () => {
    const notRoot = { ...rootDeleg(SIGNER), authority: ('0x' + '00'.repeat(32)) as `0x${string}` };
    await expect(
      resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [notRoot] }),
    ).rejects.toThrow(/not a root delegation/);
  });

  it('rejects broken continuity (leaf.delegator != prev.delegate)', async () => {
    const root = rootDeleg(MID);
    const leaf = { ...childDeleg(root, SIGNER), delegator: SIGNER }; // wrong delegator
    await expect(
      resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [root, leaf] }),
    ).rejects.toThrow(/delegator != chain\[0\]\.delegate/);
  });

  it('rejects a tampered authority link', async () => {
    const root = rootDeleg(MID);
    const leaf = { ...childDeleg(root, SIGNER), authority: ROOT_AUTHORITY }; // wrong authority
    await expect(
      resolveDelegatedSigner({ ...base, signer: fakeSigner(), delegationChain: [root, leaf] }),
    ).rejects.toThrow(/does not bind chain\[0\]/);
  });

  it('rejects a chain that terminates at a different key than the signer', async () => {
    const root = rootDeleg(MID);
    const leaf = childDeleg(root, MID); // leaf delegates to MID, not SIGNER
    await expect(
      resolveDelegatedSigner({ ...base, signer: fakeSigner(SIGNER), delegationChain: [root, leaf] }),
    ).rejects.toThrow(/leaf delegate != signer address/);
  });
});
