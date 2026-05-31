import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryAuditSink } from '@agenticprimitives/audit';
import { parseTransaction, type Hex } from 'viem';
import { LocalSecp256k1Signer } from '../../src/providers/local';
import { createRelayerAccount } from '../../src/relayer-account';

const TEST_PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EXPECTED_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

describe('createRelayerAccount (R5.12a / PKG-KEY-CUSTODY-005)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('exposes the backend address and the kms-relayer source tag', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, { role: 'direct-deploy' });
    expect(acct.address.toLowerCase()).toBe(EXPECTED_ADDR);
    expect(acct.source).toBe('kms-relayer');
    expect(acct.type).toBe('local');
  });

  it('signMessage delegates to the inner KMS account', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, { role: 'direct-deploy' });
    const sig = await acct.signMessage({ message: 'hello relayer' });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('signTransaction produces a serializable signed tx', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, { role: 'direct-deploy' });
    const tx = {
      chainId: 31337,
      nonce: 0,
      to: '0x1234567890123456789012345678901234567890' as Hex,
      value: 0n,
      gas: 21000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      type: 'eip1559' as const,
    };
    const signed = await acct.signTransaction(tx);
    expect(signed).toMatch(/^0x/);
    // Round-trip: parse the signed tx to confirm it reflects the same `to`.
    // viem's parseTransaction omits zero-value (and other zero defaults) so
    // we only check the field that always survives.
    const parsed = parseTransaction(signed);
    expect(parsed.to?.toLowerCase()).toBe(tx.to.toLowerCase());
  });

  it('emits key-custody.relay.sign on signMessage with role tag', async () => {
    const sink = createMemoryAuditSink();
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'paymaster-topup',
      auditSink: sink,
    });
    await acct.signMessage({ message: 'test' });
    const events = sink.events();
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.action).toBe('key-custody.relay.sign');
    expect(evt.outcome).toBe('success');
    expect(evt.actor?.type).toBe('system');
    expect(evt.actor?.id).toBe('paymaster-topup');
    expect(evt.context?.role).toBe('paymaster-topup');
    expect(evt.context?.opType).toBe('message');
    expect(evt.context?.to).toBeNull();
    expect(evt.context?.value).toBeNull();
    expect(typeof evt.context?.signerAddress).toBe('string');
    expect((evt.context?.signerAddress as string).toLowerCase()).toBe(EXPECTED_ADDR);
  });

  it('emits key-custody.relay.sign on signTransaction with to + value context', async () => {
    const sink = createMemoryAuditSink();
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'paymaster-topup',
      auditSink: sink,
    });
    const targetAddr = '0x1234567890123456789012345678901234567890' as Hex;
    await acct.signTransaction({
      chainId: 31337,
      nonce: 0,
      to: targetAddr,
      value: 10n ** 18n, // 1 ETH in wei
      gas: 21000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      type: 'eip1559',
    });
    const events = sink.events();
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.action).toBe('key-custody.relay.sign');
    expect(evt.context?.opType).toBe('transaction');
    expect(evt.context?.to).toBe(targetAddr);
    // value is stamped as a decimal STRING (bigint isn't JSON-serializable)
    expect(evt.context?.value).toBe((10n ** 18n).toString());
  });

  it('emits key-custody.relay.sign on signTypedData', async () => {
    const sink = createMemoryAuditSink();
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'custody-relay',
      auditSink: sink,
    });
    await acct.signTypedData({
      domain: { name: 'Test', version: '1', chainId: 31337 },
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      primaryType: 'Mail',
      message: { contents: 'hello' },
    });
    const events = sink.events();
    expect(events).toHaveLength(1);
    expect(events[0]!.context?.opType).toBe('typed-data');
  });

  it('digestFingerprint is a hashed 18-char prefix (never the raw digest)', async () => {
    const sink = createMemoryAuditSink();
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'direct-deploy',
      auditSink: sink,
    });
    await acct.signMessage({ message: 'audit fingerprint check' });
    const evt = sink.events()[0]!;
    const fp = evt.context?.digestFingerprint as string;
    expect(fp).toMatch(/^0x[0-9a-f]{16}$/);
    // The fingerprint must NOT be the raw digest (which would be a 66-char 0x... 32-byte string).
    expect(fp.length).toBe(18);
  });

  it('fail-soft: a throwing audit sink does NOT propagate to the caller', async () => {
    const throwingSink = {
      async write() {
        throw new Error('sink down');
      },
    };
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'direct-deploy',
      auditSink: throwingSink,
    });
    // signMessage should succeed even though audit sink throws.
    await expect(acct.signMessage({ message: 'test' })).resolves.toMatch(/^0x/);
  });

  it('no audit sink: signing still works, just no audit row', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, { role: 'direct-deploy' });
    await expect(acct.signMessage({ message: 'no sink' })).resolves.toMatch(/^0x/);
  });

  it('role tag appears in actor.id AND context.role (both indexable)', async () => {
    const sink = createMemoryAuditSink();
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'register-name',
      auditSink: sink,
    });
    await acct.signMessage({ message: 'role check' });
    const evt = sink.events()[0]!;
    expect(evt.actor?.id).toBe('register-name');
    expect(evt.context?.role).toBe('register-name');
  });

  it('signature is recoverable: same message → same signature (audit emission is additive, not mutating)', async () => {
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, { role: 'direct-deploy' });
    const a = await acct.signMessage({ message: 'determinism check' });
    const b = await acct.signMessage({ message: 'determinism check' });
    expect(a).toBe(b);
  });

  it('transaction value omitted → audit row records value=0', async () => {
    const sink = createMemoryAuditSink();
    const backend = new LocalSecp256k1Signer({ privateKeyHex: TEST_PRIV });
    const acct = await createRelayerAccount(backend, {
      role: 'direct-deploy',
      auditSink: sink,
    });
    await acct.signTransaction({
      chainId: 31337,
      nonce: 0,
      to: '0x1234567890123456789012345678901234567890' as Hex,
      // value intentionally omitted
      gas: 21000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      type: 'eip1559',
    });
    const evt = sink.events()[0]!;
    expect(evt.context?.value).toBe('0');
  });
});
