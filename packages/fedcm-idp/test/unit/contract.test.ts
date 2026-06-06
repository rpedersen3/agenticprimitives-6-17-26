import { describe, expect, it } from 'vitest';
import {
  buildWebIdentity,
  buildProviderConfig,
  buildAccountsResponse,
  buildAssertionClaims,
  buildTokenResponse,
  buildContinueResponse,
  buildErrorResponse,
  assertionCorsHeaders,
  loginStatusHeader,
  SET_LOGIN_HEADER,
  isWebIdentityRequest,
  parseAssertionRequest,
} from '../../src/index';

describe('buildWebIdentity', () => {
  it('emits a single-element provider_urls (spec limit)', () => {
    expect(buildWebIdentity('https://idp/config.json')).toEqual({
      provider_urls: ['https://idp/config.json'],
    });
  });
  it('adds accounts_endpoint + login_url (required from Chrome 145 when client_metadata is configured)', () => {
    expect(
      buildWebIdentity('https://idp/config.json', { accountsEndpoint: '/fedcm/accounts', loginUrl: '/fedcm/login' }),
    ).toEqual({
      provider_urls: ['https://idp/config.json'],
      accounts_endpoint: '/fedcm/accounts',
      login_url: '/fedcm/login',
    });
  });
});

describe('buildProviderConfig', () => {
  it('required endpoints only; omits absent optionals', () => {
    const cfg = buildProviderConfig({ accountsEndpoint: '/a', idAssertionEndpoint: '/t', loginUrl: '/l' });
    expect(cfg).toEqual({ accounts_endpoint: '/a', id_assertion_endpoint: '/t', login_url: '/l' });
  });
  it('includes optionals (disconnect_endpoint, not "disconnect")', () => {
    const cfg = buildProviderConfig({
      accountsEndpoint: '/a', idAssertionEndpoint: '/t', loginUrl: '/l',
      disconnectEndpoint: '/d', clientMetadataEndpoint: '/m', branding: { name: 'Impact' },
    });
    expect(cfg.disconnect_endpoint).toBe('/d');
    expect(cfg.client_metadata_endpoint).toBe('/m');
    expect(cfg.branding?.name).toBe('Impact');
  });
});

describe('accounts + assertion bodies', () => {
  it('buildAccountsResponse — id is the SA address (stable key)', () => {
    expect(buildAccountsResponse([{ id: 'eip155:84532:0xabc', name: 'Person Agent' }]))
      .toEqual({ accounts: [{ id: 'eip155:84532:0xabc', name: 'Person Agent' }] });
  });
  it('buildAssertionClaims — thin; sub = SA addr; intent defaults to signin', () => {
    const c = buildAssertionClaims({ iss: 'i', aud: 'a', sub: 'eip155:84532:0xabc', origin: 'o', nonce: 'n' });
    expect(c).toEqual({ iss: 'i', aud: 'a', sub: 'eip155:84532:0xabc', origin: 'o', nonce: 'n', intent: 'signin' });
  });
  it('buildAssertionClaims — carries optional facets', () => {
    const c = buildAssertionClaims({ iss: 'i', aud: 'a', sub: 's', origin: 'o', nonce: 'n', intent: 'org-create', agentDid: 'did:x', delegationRequestHash: '0xh', iat: 9 });
    expect(c.intent).toBe('org-create');
    expect(c.agent_did).toBe('did:x');
    expect(c.delegation_request_hash).toBe('0xh');
    expect(c.iat).toBe(9);
  });
  it('response builders', () => {
    expect(buildTokenResponse('jwt')).toEqual({ token: 'jwt' });
    expect(buildContinueResponse('https://idp/finish')).toEqual({ continue_on: 'https://idp/finish' });
    expect(buildErrorResponse('access_denied')).toEqual({ error: { code: 'access_denied' } });
    expect(buildErrorResponse('server_error', 'https://idp/err')).toEqual({ error: { code: 'server_error', url: 'https://idp/err' } });
  });
  it('assertion CORS headers echo the exact RP origin (never *)', () => {
    expect(assertionCorsHeaders('https://relying.example')).toEqual({
      'Access-Control-Allow-Origin': 'https://relying.example',
      'Access-Control-Allow-Credentials': 'true',
    });
  });
});

describe('login status', () => {
  it('Set-Login header', () => {
    expect(SET_LOGIN_HEADER).toBe('Set-Login');
    expect(loginStatusHeader('logged-in')).toEqual({ name: 'Set-Login', value: 'logged-in' });
    expect(loginStatusHeader('logged-out')).toEqual({ name: 'Set-Login', value: 'logged-out' });
  });
});

describe('isWebIdentityRequest (Sec-Fetch-Dest gate)', () => {
  it('true only for webidentity (case-insensitive)', () => {
    expect(isWebIdentityRequest('webidentity')).toBe(true);
    expect(isWebIdentityRequest('WebIdentity')).toBe(true);
    expect(isWebIdentityRequest('document')).toBe(false);
    expect(isWebIdentityRequest(null)).toBe(false);
  });
});

describe('parseAssertionRequest (post-145: nonce in params; fail-closed)', () => {
  it('reads nonce from params.nonce (post-145)', () => {
    const r = parseAssertionRequest({ client_id: 'demo-gs', account_id: '0xabc', params: '{"nonce":"n-in-params","scope":"profile.read"}' });
    expect(r?.nonce).toBe('n-in-params');
    expect(r?.params).toEqual({ nonce: 'n-in-params', scope: 'profile.read' });
  });
  it('falls back to a top-level nonce (143–144 compat)', () => {
    const r = parseAssertionRequest({ client_id: 'c', account_id: 'a', nonce: 'top-level' });
    expect(r?.nonce).toBe('top-level');
  });
  it('null when client_id / account_id / nonce missing', () => {
    expect(parseAssertionRequest({ client_id: 'c', account_id: 'a' })).toBeNull(); // no nonce anywhere
    expect(parseAssertionRequest({ account_id: 'a', nonce: 'n' })).toBeNull(); // no client_id
  });
  it('disclosure flag + lenient malformed params', () => {
    const r = parseAssertionRequest({ client_id: 'c', account_id: 'a', nonce: 'n', disclosure_text_shown: 'true', params: 'not-json' });
    expect(r?.disclosureTextShown).toBe(true);
    expect(r?.params).toBeUndefined();
  });
});
