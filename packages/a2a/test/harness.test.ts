// W5 — two-agent acceptance harness (spec 269 AC-1..AC-4). Two embedded agents (alice, bob) over a
// SHARED in-memory vault + the real JSON-RPC dispatch. Proves: happy-path task exchange, the delegation
// gate denials at the agent surface, a cross-vault "entitlement" deposit, and the auth-required round-trip.
import { describe, it, expect } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import {
  createA2aAgent,
  buildA2aGrantCaveats,
  createInMemoryTaskStore,
  dispatchA2aRpc,
  isTerminal,
  type A2aAgent,
  type A2aEnforcers,
  type OnChainChecks,
  type SkillHandler,
  type VaultClient,
  type A2aMessage,
} from '../src/index.js';

const ADDR = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;
const ALICE = ADDR('a');
const BOB = ADDR('b');
const enforcers: A2aEnforcers = { allowedTargets: ADDR('1'), allowedMethods: ADDR('2'), timestamp: ADDR('3') };
const DM = ADDR('d');
const hashBody = (data: unknown) => keccak256(toBytes(JSON.stringify(data ?? null)));

// One vault shared by both agents, keyed by owner — so an agent can deposit into another principal's
// namespace (AC-3) and a sender can read the assignee's artifact namespace (AC-1).
function sharedVault(): VaultClient & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async write({ owner, recordType, data }) { store.set(`${owner.toLowerCase()}:${recordType}`, data); return { owner, recordType }; },
    async read(ref) { return store.get(`${ref.owner.toLowerCase()}:${ref.recordType}`) ?? null; },
  };
}

const okChecks = (over: Partial<OnChainChecks> = {}): OnChainChecks => ({
  isRevoked: async () => false, verifyDelegationSignature: async () => true, verifyMessageSignature: async () => true, ...over,
});

let msgN = 0;
const nextMsgId = () => (`0x${(++msgN).toString(16).padStart(64, '0')}`) as Hex;

function grant(opts: { delegator: `0x${string}`; delegate: `0x${string}`; recipient: `0x${string}`; skill: string; window?: { validAfter: number; validUntil: number } }): Delegation {
  return {
    delegator: opts.delegator, delegate: opts.delegate, authority: ROOT_AUTHORITY,
    caveats: buildA2aGrantCaveats({ recipientAgentSA: opts.recipient, skill: opts.skill, enforcers, window: opts.window ?? { validAfter: 0, validUntil: 9_999_999_999 } }),
    salt: BigInt(++msgN), signature: '0xsig',
  };
}
function message(sender: `0x${string}`, skill: string, input: unknown): A2aMessage {
  return { messageId: nextMsgId(), sender, skill, bodyRef: { owner: BOB, recordType: 'pending' }, bodyHash: hashBody(input), signature: '0xmsg', createdAt: 1000 };
}

function makeAgent(sa: `0x${string}`, handlers: SkillHandler[], vault: VaultClient, checks: OnChainChecks): A2aAgent {
  let n = 0;
  return createA2aAgent({
    agentSA: sa, chainId: 84532, delegationManager: DM, enforcers, taskStore: createInMemoryTaskStore(),
    checks, handlers, vault, mcp: { callTool: async () => null }, hashBody, now: () => 5000,
    newTaskId: () => (`0x${sa.slice(2, 4)}${(++n).toString(16).padStart(62, '0')}`) as Hex,
  });
}

// rpc(agent, method, params) — exercise the JSON-RPC dispatch surface (no JSON string: BigInt salts).
const rpc = (agent: A2aAgent, method: string, params: unknown) => dispatchA2aRpc(agent, { jsonrpc: '2.0', id: 1, method, params });

const echo: SkillHandler = { skill: 'echo', handle: async (ctx) => ({ state: 'completed', artifactIds: [await ctx.emitArtifact({ artifactKind: 'echo', body: ctx.input })] }) };

describe('AC-1 — happy path: alice sends bob an echo task, polls the result', () => {
  it('submitted → processed → completed, artifact body in bob vault', async () => {
    const v = sharedVault();
    const bob = makeAgent(BOB, [echo], v, okChecks());
    const input = { ping: 'pong' };
    const g = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'echo' });
    const send = await rpc(bob, 'message/send', { delegation: g, requester: ALICE, message: message(ALICE, 'echo', input), input });
    expect('result' in send && send.result).toBeTruthy();
    const taskId = (send as { result: { taskId: Hex } }).result.taskId;

    await bob.processDue();

    const got = await rpc(bob, 'tasks/get', { taskId, caller: ALICE });
    const task = (got as { result: { state: string; artifactRefs: { owner: string; recordType: string }[] } }).result;
    expect(task.state).toBe('completed');
    expect(task.artifactRefs.length).toBe(1);
    expect(await v.read(task.artifactRefs[0]!)).toEqual(input); // body lives in bob's vault
  });
});

describe('AC-2 — the delegation gate denies at the agent surface', () => {
  const v = sharedVault();
  const input = { x: 1 };
  it('wrong recipient (grant scoped to another agent) → unauthorized', async () => {
    const bob = makeAgent(BOB, [echo], v, okChecks());
    const g = grant({ delegator: ALICE, delegate: ALICE, recipient: ADDR('9'), skill: 'echo' });
    const r = await rpc(bob, 'message/send', { delegation: g, requester: ALICE, message: message(ALICE, 'echo', input), input });
    expect('error' in r).toBe(true);
  });
  it('expired window → unauthorized', async () => {
    const bob = makeAgent(BOB, [echo], v, okChecks());
    const g = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'echo', window: { validAfter: 0, validUntil: 1 } });
    const r = await rpc(bob, 'message/send', { delegation: g, requester: ALICE, message: message(ALICE, 'echo', input), input });
    expect('error' in r).toBe(true);
  });
  it('wrong skill (grant for echo, message for other) → unauthorized', async () => {
    const bob = makeAgent(BOB, [echo, { skill: 'other', handle: async () => ({ state: 'completed' }) }], v, okChecks());
    const g = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'echo' });
    const r = await rpc(bob, 'message/send', { delegation: g, requester: ALICE, message: message(ALICE, 'other', input), input });
    expect('error' in r).toBe(true);
  });
  it('revoked grant → unauthorized (on-chain fail-closed)', async () => {
    const bob = makeAgent(BOB, [echo], v, okChecks({ isRevoked: async () => true }));
    const g = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'echo' });
    const r = await rpc(bob, 'message/send', { delegation: g, requester: ALICE, message: message(ALICE, 'echo', input), input });
    expect('error' in r).toBe(true);
  });
});

describe('AC-3 — entitlement conversation: bob deposits a credential into alice’s vault', () => {
  it('the handler writes to the principal’s namespace, not bob’s', async () => {
    const v = sharedVault();
    const issue: SkillHandler = {
      skill: 'issue-entitlement',
      handle: async (ctx) => {
        // The reader (delegator/principal) asked bob to deposit an entitlement into the reader's vault.
        await ctx.vault.write({ owner: ctx.delegation.delegator, recordType: 'entitlement:gold', data: { tier: 'gold', by: BOB } });
        return { state: 'completed' };
      },
    };
    const bob = makeAgent(BOB, [issue], v, okChecks());
    const input = { want: 'gold' };
    const g = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'issue-entitlement' });
    const send = await rpc(bob, 'message/send', { delegation: g, requester: ALICE, message: message(ALICE, 'issue-entitlement', input), input });
    const taskId = (send as { result: { taskId: Hex } }).result.taskId;
    await bob.processDue();

    expect((await rpc(bob, 'tasks/get', { taskId, caller: ALICE }) as { result: { state: string } }).result.state).toBe('completed');
    // The entitlement landed in ALICE's namespace; bob never wrote to his own.
    expect(await v.read({ owner: ALICE, recordType: 'entitlement:gold' })).toEqual({ tier: 'gold', by: BOB });
    expect(await v.read({ owner: BOB, recordType: 'entitlement:gold' })).toBeNull();
  });
});

describe('AC-4 — auth-required round-trip: suspend, then resubmit with a fresh grant', () => {
  it('guarded → auth-required → resubmit → completed', async () => {
    const v = sharedVault();
    const guarded: SkillHandler = {
      skill: 'guarded',
      handle: async (ctx) => {
        const input = ctx.input as { authToken?: string };
        if (!input?.authToken) return ctx.requestAuth('step-up-required');
        return { state: 'completed', artifactIds: [await ctx.emitArtifact({ artifactKind: 'receipt', body: { ok: true } })] };
      },
    };
    const bob = makeAgent(BOB, [guarded], v, okChecks());

    // 1) first attempt — no token → bob parks the task in auth-required.
    const first = { need: 'token' };
    const g1 = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'guarded' });
    const send = await rpc(bob, 'message/send', { delegation: g1, requester: ALICE, message: message(ALICE, 'guarded', first), input: first });
    const taskId = (send as { result: { taskId: Hex } }).result.taskId;
    await bob.processDue();
    expect((await rpc(bob, 'tasks/get', { taskId, caller: ALICE }) as { result: { state: string } }).result.state).toBe('auth-required');

    // 2) resubmit — fresh grant + new signed message carrying the step-up token.
    const second = { authToken: 'stepped-up' };
    const g2 = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'guarded' });
    const resub = await rpc(bob, 'tasks/resubmit', { taskId, delegation: g2, requester: ALICE, message: message(ALICE, 'guarded', second), input: second });
    expect((resub as { result: { state: string } }).result.state).toBe('submitted');
    await bob.processDue();

    const done = (await rpc(bob, 'tasks/get', { taskId, caller: ALICE }) as { result: { state: string; artifactRefs: unknown[] } }).result;
    expect(isTerminal(done.state as never)).toBe(true);
    expect(done.state).toBe('completed');
    expect(done.artifactRefs.length).toBe(1);
  });

  it('a stranger cannot resubmit someone else’s parked task', async () => {
    const v = sharedVault();
    const guarded: SkillHandler = { skill: 'guarded', handle: async (ctx) => (ctx.input as { authToken?: string })?.authToken ? { state: 'completed' } : ctx.requestAuth('x') };
    const bob = makeAgent(BOB, [guarded], v, okChecks());
    const g1 = grant({ delegator: ALICE, delegate: ALICE, recipient: BOB, skill: 'guarded' });
    const send = await rpc(bob, 'message/send', { delegation: g1, requester: ALICE, message: message(ALICE, 'guarded', {}), input: {} });
    const taskId = (send as { result: { taskId: Hex } }).result.taskId;
    await bob.processDue();
    const tok = { authToken: 'x' };
    const g2 = grant({ delegator: ADDR('9'), delegate: ADDR('9'), recipient: BOB, skill: 'guarded' });
    const r = await rpc(bob, 'tasks/resubmit', { taskId, delegation: g2, requester: ADDR('9'), message: message(ADDR('9'), 'guarded', tok), input: tok });
    expect('error' in r).toBe(true);
  });
});
