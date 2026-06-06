import { describe, expect, it } from 'vitest';
import {
  buildWebIdentity,
  buildProviderConfig,
  buildAccountsResponse,
  buildAssertionClaims,
  isWebIdentityRequest,
  parseAssertionRequest,
} from '../../src/index';

describe('buildWebIdentity', () => {
  it('declares the provider config URL(s)', () => {
    expect(buildWebIdentity(['https://idp.example/fedcm/config.json'])).toEqual({
      provider_urls: ['https://idp.example/fedcm/config.json'],
    });
  });
});

describe('buildProviderConfig', () => {
  it('includes required endpoints + omits absent optionals', () => {
    const cfg = buildProviderConfig({
      accountsEndpoint: '/fedcm/accounts',
      idAssertionEndpoint: '/fedcm/assertion',
      loginUrl: '/fedcm/login',
    });
    expect(cfg).toEqual({
      accounts_endpoint: '/fedcm/accounts',
      id_assertion_endpoint: '/fedcm/assertion',
      login_url: '/fedcm/login',
    });
    expect('disconnect_endpoint' in cfg).toBe(false);
  });

  it('includes optionals when provided', () => {
    const cfg = buildProviderConfig({
      accountsEndpoint: '/fedcm/accounts',
      idAssertionEndpoint: '/fedcm/assertion',
      loginUrl: '/fedcm/login',
      clientMetadataEndpoint: '/fedcm/client-metadata',
      disconnectEndpoint: '/fedcm/disconnect',
      branding: { name: 'Impact', icons: [{ url: 'https://x/i.png', size: 32 }] },
    });
    expect(cfg.client_metadata_endpoint).toBe('/fedcm/client-metadata');
    expect(cfg.disconnect_endpoint).toBe('/fedcm/disconnect');
    expect(cfg.branding?.name).toBe('Impact');
  });
});

describe('buildAccountsResponse', () => {
  it('wraps the agent rows; id is the SA address (stable key, not a name)', () => {
    const r = buildAccountsResponse([{ id: 'eip155:84532:0xabc', name: 'Person Agent' }]);
    expect(r).toEqual({ accounts: [{ id: 'eip155:84532:0xabc', name: 'Person Agent' }] });
  });
});

describe('buildAssertionClaims (thin bootstrap — ADR-0031)', () => {
  it('sets sub = the SA address, defaults intent to signin, omits absent optionals', () => {
    const c = buildAssertionClaims({
      iss: 'https://www.impact-agent.me',
      aud: 'demo-gs',
      sub: 'eip155:84532:0xabc',
      origin: 'https://relying.example',
      nonce: 'n1',
    });
    expect(c.sub).toBe('eip155:84532:0xabc');
    expect(c.intent).toBe('signin');
    expect('delegation_request_hash' in c).toBe(false);
    expect('agent_did' in c).toBe(false);
  });

  it('carries intent + delegation_request_hash + agent_did + iat when provided', () => {
    const c = buildAssertionClaims({
      iss: 'i', aud: 'a', sub: 's', origin: 'o', nonce: 'n',
      intent: 'org-create', agentDid: 'did:pkh:eip155:84532:0xabc', delegationRequestHash: '0xhash', iat: 123,
    });
    expect(c.intent).toBe('org-create');
    expect(c.agent_did).toBe('did:pkh:eip155:84532:0xabc');
    expect(c.delegation_request_hash).toBe('0xhash');
    expect(c.iat).toBe(123);
  });
});

describe('isWebIdentityRequest', () => {
  it('true only for Sec-Fetch-Dest: webidentity (case-insensitive); false otherwise', () => {
    expect(isWebIdentityRequest('webidentity')).toBe(true);
    expect(isWebIdentityRequest('WebIdentity')).toBe(true);
    expect(isWebIdentityRequest('document')).toBe(false);
    expect(isWebIdentityRequest(null)).toBe(false);
    expect(isWebIdentityRequest(undefined)).toBe(false);
  });
});

describe('parseAssertionRequest (fail-closed on missing fields)', () => {
  it('returns null when a required field is missing', () => {
    expect(parseAssertionRequest({ client_id: 'demo-gs', nonce: 'n' })).toBeNull(); // no account_id
  });

  it('parses required fields + the disclosure flag', () => {
    const r = parseAssertionRequest({ client_id: 'demo-gs', account_id: '0xabc', nonce: 'n', disclosure_text_shown: 'true' });
    expect(r).toEqual({ clientId: 'demo-gs', accountId: '0xabc', nonce: 'n', disclosureTextShown: true, params: undefined });
  });

  it('parses custom params JSON leniently (ignores malformed)', () => {
    const ok = parseAssertionRequest({ client_id: 'c', account_id: 'a', nonce: 'n', params: '{"scope":"profile.read","intent":"org-create"}' });
    expect(ok?.params).toEqual({ scope: 'profile.read', intent: 'org-create' });
    const bad = parseAssertionRequest({ client_id: 'c', account_id: 'a', nonce: 'n', params: 'not-json' });
    expect(bad?.params).toBeUndefined();
  });
});
