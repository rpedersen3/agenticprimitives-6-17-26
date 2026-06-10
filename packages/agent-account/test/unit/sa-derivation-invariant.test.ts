/**
 * R5.12c / PKG-AGENT-ACCOUNT-005 — sponsored-deploy invariant tests.
 *
 * `assertSaMatchesCustodianDerivation` is the gate a relying broker
 * uses BEFORE sponsoring a deploy / signing an action for a
 * client-supplied target SA address. The test mocks the on-chain
 * factory view so we can run in <100ms without anvil.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentAccountClient, SaMismatchError } from '../../src/client';

const FACTORY = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as const;
const ENTRY_POINT = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
const OWNER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const OTHER_CUSTODIAN = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const PREDICTED_ACCOUNT = '0x1234567890123456789012345678901234567890' as const;

// The mock's getAddressForAgentAccount returns a stable fake derivation
// per spec. Tests assert the assert helper threads the spec correctly
// AND fails on mismatch.
const factoryReturnsByOwner = new Map<string, string>();

vi.mock('viem', async (importOriginal) => {
  const real = await importOriginal<typeof import('viem')>();
  return {
    ...real,
    createPublicClient: vi.fn(() => ({
      getCode: vi.fn(async () => '0x'),
    })),
    createWalletClient: vi.fn(() => ({})),
    getContract: vi.fn(({ address }: { address: string }) => {
      if (address === FACTORY) {
        return {
          read: {
            // Derive a deterministic-looking fake address per
            // (mode, custodians, salt) tuple so different specs return
            // different addresses (tests can assert mismatch).
            getAddressForAgentAccount: vi.fn(
              // CA-F1: view signature is now (initParams, timelockOverrides, salt).
              async ([initParams, , salt]: [
                {
                  mode: number;
                  custodians: readonly string[];
                  trustees: readonly string[];
                },
                readonly number[],
                bigint,
              ]) => {
                const key = `${initParams.mode}|${initParams.custodians.join(',')}|${salt.toString()}`;
                if (factoryReturnsByOwner.has(key)) {
                  return factoryReturnsByOwner.get(key);
                }
                return PREDICTED_ACCOUNT;
              },
            ),
          },
        };
      }
      return { read: {} };
    }),
    http: vi.fn(() => ({})),
  };
});

describe('AgentAccountClient.assertSaMatchesCustodianDerivation (R5.12c)', () => {
  let client: AgentAccountClient;
  beforeEach(() => {
    factoryReturnsByOwner.clear();
    client = new AgentAccountClient({
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 31337,
      entryPoint: ENTRY_POINT,
      factory: FACTORY,
    });
  });

  // ─── Happy path ──────────────────────────────────────────────────

  it('returns the verified address when claimed matches derived', async () => {
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT);
    const result = await client.assertSaMatchesCustodianDerivation({
      claimed: PREDICTED_ACCOUNT,
      custodians: [OWNER],
    });
    expect(result.toLowerCase()).toBe(PREDICTED_ACCOUNT.toLowerCase());
  });

  it('accepts a case-insensitive claimed address (checksum-agnostic)', async () => {
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT);
    // Force the claimed address to be all-lowercase to ensure the
    // check normalises case.
    const lowercaseClaimed = PREDICTED_ACCOUNT.toLowerCase() as `0x${string}`;
    const result = await client.assertSaMatchesCustodianDerivation({
      claimed: lowercaseClaimed,
      custodians: [OWNER],
    });
    expect(result.toLowerCase()).toBe(PREDICTED_ACCOUNT.toLowerCase());
  });

  // ─── Mismatch / SaMismatchError ──────────────────────────────────

  it('throws SaMismatchError when claimed does NOT match derived', async () => {
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT);
    const lyingAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as `0x${string}`;
    await expect(
      client.assertSaMatchesCustodianDerivation({
        claimed: lyingAddress,
        custodians: [OWNER],
      }),
    ).rejects.toBeInstanceOf(SaMismatchError);
  });

  it('SaMismatchError carries claimed + derived + spec for forensics', async () => {
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT);
    const lyingAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as `0x${string}`;
    try {
      await client.assertSaMatchesCustodianDerivation({
        claimed: lyingAddress,
        custodians: [OWNER],
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SaMismatchError);
      const e = err as SaMismatchError;
      expect(e.claimed.toLowerCase()).toBe(lyingAddress.toLowerCase());
      expect(e.derived.toLowerCase()).toBe(PREDICTED_ACCOUNT.toLowerCase());
      expect(e.spec.mode).toBe(0);
      expect(e.spec.salt).toBe(0n);
      expect(e.spec.custodians?.[0]).toBe(OWNER);
      expect(e.message).toContain(lyingAddress);
      expect(e.message).toContain(PREDICTED_ACCOUNT);
    }
  });

  // ─── Spec defaults ───────────────────────────────────────────────

  it('default spec is mode=0, salt=0n, no trustees (canonical SIWE-only)', async () => {
    let receivedSpec: { mode: number; salt: bigint } | undefined;
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT);
    const realGetAddress = client.getAddressForAgentAccount.bind(client);
    const spy = vi
      .spyOn(client, 'getAddressForAgentAccount')
      .mockImplementation(async (spec) => {
        receivedSpec = { mode: spec.mode ?? -1, salt: spec.salt };
        return realGetAddress(spec);
      });
    await client.assertSaMatchesCustodianDerivation({
      claimed: PREDICTED_ACCOUNT,
      custodians: [OWNER],
    });
    expect(receivedSpec?.mode).toBe(0);
    expect(receivedSpec?.salt).toBe(0n);
    spy.mockRestore();
  });

  it('honours non-default mode / salt / trustees overrides', async () => {
    const altAddr = '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;
    factoryReturnsByOwner.set(`2|${OWNER},${OTHER_CUSTODIAN}|42`, altAddr);
    const result = await client.assertSaMatchesCustodianDerivation({
      claimed: altAddr,
      custodians: [OWNER, OTHER_CUSTODIAN],
      mode: 2,
      salt: 42n,
    });
    expect(result.toLowerCase()).toBe(altAddr.toLowerCase());
  });

  // ─── The financial-DoS scenario (the reason this gate exists) ────

  it('blocks a client supplying a target SA with a DIFFERENT custodian set than verified', async () => {
    // Scenario: an authenticated user verified SIWE for `OWNER` but tries
    // to trick the broker into deploying an SA derived for a different
    // custodian (`OTHER_CUSTODIAN`). The broker must reject so the
    // sponsored deploy goes to the canonical SA, not an arbitrary one.
    //
    // The broker constructs the spec from the VERIFIED credential
    // (OWNER) and passes the client-supplied target as `claimed`. If
    // the client's target was computed from a different custodian, the
    // factory derives a different address → throws.
    const otherCustodiansAddr = '0xbbbb1111bbbb1111bbbb1111bbbb1111bbbb1111' as `0x${string}`;
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT); // canonical for OWNER
    factoryReturnsByOwner.set(`0|${OTHER_CUSTODIAN}|0`, otherCustodiansAddr); // canonical for OTHER

    await expect(
      client.assertSaMatchesCustodianDerivation({
        claimed: otherCustodiansAddr, // client-supplied target derived from a different custodian
        custodians: [OWNER], // verified credential
      }),
    ).rejects.toBeInstanceOf(SaMismatchError);
  });

  it('returns the canonical address when client correctly claims the SA for the verified custodian', async () => {
    factoryReturnsByOwner.set(`0|${OWNER}|0`, PREDICTED_ACCOUNT);
    const result = await client.assertSaMatchesCustodianDerivation({
      claimed: PREDICTED_ACCOUNT,
      custodians: [OWNER],
    });
    expect(result.toLowerCase()).toBe(PREDICTED_ACCOUNT.toLowerCase());
  });
});
