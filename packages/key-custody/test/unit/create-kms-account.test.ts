import { describe, it, expect, beforeEach } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { LocalSecp256k1Signer } from '../../src/providers/local';
import { createKmsAccount } from '../../src/account';

const TEST_PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('createKmsAccount', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('exposes the backend address', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const account = await createKmsAccount(backend);
    expect(account.address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(account.provider).toBe('local-aes');
    expect(account.keyId).toContain('local-aes:0x');
  });

  it('signMessage produces a 65-byte (0x-prefixed) signature for a string', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const account = await createKmsAccount(backend);
    const sig = await account.signMessage('hello agenticprimitives');
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('signMessage with same message produces same signature (deterministic via secp256k1)', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const account = await createKmsAccount(backend);
    const a = await account.signMessage('determinism check');
    const b = await account.signMessage('determinism check');
    expect(a).toBe(b);
  });

  it('signTypedData hashes via EIP-712 and signs', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const account = await createKmsAccount(backend);
    const sig = await account.signTypedData({
      domain: { name: 'TestDomain', version: '1', chainId: 31337 },
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      primaryType: 'Mail',
      message: { contents: 'hi' },
    });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
