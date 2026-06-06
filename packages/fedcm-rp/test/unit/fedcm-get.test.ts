import { describe, expect, it, vi, afterEach } from 'vitest';
import { fedcmSupported, fedcmGet } from '../../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { IdentityCredential?: unknown }).IdentityCredential;
});

function stubFedcm(getImpl: (req: unknown) => Promise<unknown>) {
  vi.stubGlobal('window', { IdentityCredential: class {} });
  vi.stubGlobal('navigator', { credentials: { get: vi.fn(getImpl) } });
}

describe('fedcmSupported', () => {
  it('false without IdentityCredential', () => {
    expect(fedcmSupported()).toBe(false);
  });
  it('true when window.IdentityCredential exists', () => {
    vi.stubGlobal('window', { IdentityCredential: class {} });
    expect(fedcmSupported()).toBe(true);
  });
});

describe('fedcmGet', () => {
  it('throws when FedCM is unsupported (caller falls back to spec-259)', async () => {
    await expect(fedcmGet({ providers: [{ configURL: 'c', clientId: 'id' }] })).rejects.toThrow(/not supported/i);
  });

  it('passes the post-145 request shape (nonce in params) and returns the token + configURL', async () => {
    let received: any;
    stubFedcm(async (req) => { received = req; return { token: 'jwt-1', configURL: 'https://idp/config.json', isAutoSelected: false }; });
    const res = await fedcmGet({
      providers: [{ configURL: 'https://idp/config.json', clientId: 'demo-gs', params: { nonce: 'n1', intent: 'signin' } }],
      mediation: 'optional',
    });
    expect(res).toEqual({ token: 'jwt-1', configURL: 'https://idp/config.json', isAutoSelected: false });
    // nonce + custom params ride INSIDE params (post-145), not as a top-level provider member.
    expect(received.identity.providers[0]).toEqual({ configURL: 'https://idp/config.json', clientId: 'demo-gs', params: { nonce: 'n1', intent: 'signin' } });
    expect(received.mediation).toBe('optional');
  });

  it('supports multiple providers in one call (Chrome 136)', async () => {
    let received: any;
    stubFedcm(async (req) => { received = req; return { token: 't' }; });
    await fedcmGet({ providers: [{ configURL: 'a', clientId: '1' }, { configURL: 'b', clientId: '2' }] });
    expect(received.identity.providers).toHaveLength(2);
  });

  it('throws when the browser returns no credential / no token', async () => {
    stubFedcm(async () => null);
    await expect(fedcmGet({ providers: [{ configURL: 'c', clientId: 'id' }] })).rejects.toThrow(/no credential/i);
    stubFedcm(async () => ({ configURL: 'c' }));
    await expect(fedcmGet({ providers: [{ configURL: 'c', clientId: 'id' }] })).rejects.toThrow(/no token/i);
  });
});
