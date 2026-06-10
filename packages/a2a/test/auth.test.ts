import { describe, it, expect } from 'vitest';
import { ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import {
  buildA2aGrantCaveats,
  skillSelector,
  A2A_ANY_SKILL,
  authorizeA2aMessage,
  hashA2aMessage,
  decodeAllowedTargetsTerms,
  decodeAllowedMethodsTerms,
  type A2aEnforcers,
  type OnChainChecks,
  type MessageIdReserver,
  type A2aMessage,
} from '../src/index.js';

const ADDR = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;
const DELEGATOR = ADDR('a');
const THIS_AGENT = ADDR('b');
const REQUESTER = ADDR('c'); // the delegate / sender
const enforcers: A2aEnforcers = { allowedTargets: ADDR('1'), allowedMethods: ADDR('2'), timestamp: ADDR('3') };
const HASH = (`0x${'ab'.repeat(32)}`) as `0x${string}`;

function grant(skill = 'echo', recipient = THIS_AGENT, window = { validAfter: 0, validUntil: 9_999_999_999 }): Delegation {
  return {
    delegator: DELEGATOR, delegate: REQUESTER, authority: ROOT_AUTHORITY,
    caveats: buildA2aGrantCaveats({ recipientAgentSA: recipient, skill, enforcers, window }),
    salt: 0n, signature: '0xsig',
  };
}
const message = (skill = 'echo'): A2aMessage => ({
  messageId: (`0x${'11'.repeat(32)}`) as `0x${string}`,
  sender: REQUESTER, skill, bodyRef: { owner: THIS_AGENT, recordType: 'a2a:msg:1' },
  bodyHash: HASH, signature: '0xmsg', createdAt: 1000,
});
const okChecks = (): OnChainChecks => ({
  isRevoked: async () => false,
  verifyDelegationSignature: async () => true,
  verifyMessageSignature: async () => true,
});
const okStore = (): MessageIdReserver => ({ reserveMessageId: async () => true });
const call = (over: Partial<Parameters<typeof authorizeA2aMessage>[0]> = {}) =>
  authorizeA2aMessage({
    delegation: grant(), requester: REQUESTER, message: message(), thisAgentSA: THIS_AGENT,
    skill: 'echo', enforcers, checks: okChecks(), store: okStore(), now: 5000, ...over,
  });

describe('grant caveat builders + decode roundtrip', () => {
  it('builds timestamp + allowedTargets(recipient) + allowedMethods(skill)', () => {
    const cav = buildA2aGrantCaveats({ recipientAgentSA: THIS_AGENT, skill: 'echo', enforcers, window: { validAfter: 1, validUntil: 2 } });
    expect(cav.map((c) => c.enforcer)).toEqual([enforcers.timestamp, enforcers.allowedTargets, enforcers.allowedMethods]);
    expect(decodeAllowedTargetsTerms(cav[1]!.terms)[0]!.toLowerCase()).toBe(THIS_AGENT);
    expect(decodeAllowedMethodsTerms(cav[2]!.terms)[0]).toBe(skillSelector('echo'));
  });
  it('skillSelector is deterministic + supports the any-sentinel', () => {
    expect(skillSelector('echo')).toBe(skillSelector('echo'));
    expect(skillSelector('echo')).not.toBe(skillSelector('other'));
    expect(skillSelector('*')).toBe(A2A_ANY_SKILL);
  });
  it('hashA2aMessage is stable + body-sensitive', () => {
    const m = message();
    expect(hashA2aMessage(m)).toBe(hashA2aMessage(m));
    expect(hashA2aMessage(m)).not.toBe(hashA2aMessage({ ...m, bodyHash: (`0x${'cd'.repeat(32)}`) as `0x${string}` }));
  });
});

describe('authorizeA2aMessage — happy path', () => {
  it('returns the principal (delegator) when everything checks', async () => {
    const r = await call();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal).toBe(DELEGATOR);
  });
  it('accepts an any-skill grant for any skill', async () => {
    const r = await call({ delegation: grant('*'), message: message('whatever'), skill: 'whatever' });
    expect(r.ok).toBe(true);
  });
});

describe('authorizeA2aMessage — AC-2 delegation gate (each rejected, no task)', () => {
  it('AC-2a: expired grant (outside timestamp window)', async () => {
    const r = await call({ delegation: grant('echo', THIS_AGENT, { validAfter: 0, validUntil: 2 }), now: 5000 }); // nowSec=5 > 2
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/timestamp window/);
  });
  it('AC-2b: wrong target (allowedTargets != this agent)', async () => {
    const r = await call({ delegation: grant('echo', ADDR('9')) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowedTargets/);
  });
  it('AC-2c: revoked', async () => {
    const r = await call({ checks: { ...okChecks(), isRevoked: async () => true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/revoked/);
  });
  it('AC-2d: wrong skill (allowedMethods != requested)', async () => {
    const r = await call({ message: message('forge'), skill: 'forge' }); // grant() scoped to 'echo'
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowedMethods/);
  });
});

describe('authorizeA2aMessage — additional fail-closed paths', () => {
  it('delegate != requester', async () => {
    const r = await call({ requester: ADDR('d') });
    expect(r.ok).toBe(false);
  });
  it('bad delegation signature (ERC-1271 false)', async () => {
    const r = await call({ checks: { ...okChecks(), verifyDelegationSignature: async () => false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/delegation signature/);
  });
  it('bad message signature', async () => {
    const r = await call({ checks: { ...okChecks(), verifyMessageSignature: async () => false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/message signature/);
  });
  it('isRevoked throws -> fail closed', async () => {
    const r = await call({ checks: { ...okChecks(), isRevoked: async () => { throw new Error('rpc down'); } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/revocation check unavailable/);
  });
  it('FR-4.3 replay: a used message id is rejected', async () => {
    const r = await call({ store: { reserveMessageId: async () => false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/replay/);
  });
});
