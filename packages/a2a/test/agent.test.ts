import { describe, it, expect } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import {
  createA2aAgent,
  buildA2aGrantCaveats,
  dispatchA2aRpc,
  handleA2aRpcBody,
  A2aWireAdapter,
  createInMemoryTaskStore,
  type A2aEnforcers,
  type OnChainChecks,
  type SkillHandler,
  type VaultClient,
  type A2aMessage,
  type A2aTransport,
} from '../src/index.js';

const ADDR = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;
const AGENT = ADDR('b');
const REQUESTER = ADDR('c');
const DELEGATOR = ADDR('a');
const DM = ADDR('d');
const enforcers: A2aEnforcers = { allowedTargets: ADDR('1'), allowedMethods: ADDR('2'), timestamp: ADDR('3') };
const hashBody = (data: unknown) => keccak256(toBytes(JSON.stringify(data ?? null)));

const okChecks = (): OnChainChecks => ({ isRevoked: async () => false, verifyDelegationSignature: async () => true, verifyMessageSignature: async () => true });

function grant(skill = 'echo'): Delegation {
  return {
    delegator: DELEGATOR, delegate: REQUESTER, authority: ROOT_AUTHORITY,
    caveats: buildA2aGrantCaveats({ recipientAgentSA: AGENT, skill, enforcers, window: { validAfter: 0, validUntil: 9_999_999_999 } }),
    salt: 0n, signature: '0xsig',
  };
}
function msg(input: unknown, skill = 'echo'): A2aMessage {
  return { messageId: (`0x${'11'.repeat(32)}`) as Hex, sender: REQUESTER, skill, bodyRef: { owner: AGENT, recordType: 'pending' }, bodyHash: hashBody(input), signature: '0xmsg', createdAt: 1000 };
}

// in-memory vault
function vault(): VaultClient & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async write({ owner, recordType, data }) { store.set(`${owner}:${recordType}`, data); return { owner, recordType }; },
    async read(ref) { return store.get(`${ref.owner}:${ref.recordType}`) ?? null; },
  };
}

const echo: SkillHandler = {
  skill: 'echo',
  handle: async (ctx) => {
    const id = await ctx.emitArtifact({ artifactKind: 'echo', body: ctx.input });
    return { state: 'completed', artifactIds: [id] };
  },
};

function makeAgent(over: Partial<Parameters<typeof createA2aAgent>[0]> = {}) {
  let n = 0;
  return createA2aAgent({
    agentSA: AGENT, chainId: 84532, delegationManager: DM, enforcers,
    taskStore: createInMemoryTaskStore(), checks: okChecks(), handlers: [echo],
    vault: vault(), mcp: { callTool: async () => null }, hashBody,
    newTaskId: () => (`0x${(++n).toString(16).padStart(64, '0')}`) as Hex,
    now: () => 5000,
    ...over,
  });
}

describe('createA2aAgent — message/send', () => {
  it('authorizes + returns submitted immediately (does NOT run the skill inline)', async () => {
    const agent = makeAgent();
    const input = { hi: 1 };
    const r = await agent.messageSend({ delegation: grant(), requester: REQUESTER, message: msg(input), input });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.state).toBe('submitted'); // not yet processed
      const t = await agent.tasksGet({ taskId: r.result.taskId, caller: REQUESTER });
      expect(t.ok && t.result.state).toBe('submitted');
    }
  });

  it('rejects input that does not match the signed bodyHash', async () => {
    const agent = makeAgent();
    const r = await agent.messageSend({ delegation: grant(), requester: REQUESTER, message: msg({ hi: 1 }), input: { hi: 2 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/bodyHash/);
  });

  it('rejects an unauthorized grant (wrong skill)', async () => {
    const agent = makeAgent();
    const input = { x: 1 };
    const r = await agent.messageSend({ delegation: grant('echo'), requester: REQUESTER, message: msg(input, 'forge'), input });
    expect(r.ok).toBe(false);
  });
});

describe('createA2aAgent — processDue (the alarm body)', () => {
  it('dispatches submitted -> completed with an artifact written to the vault', async () => {
    const agent = makeAgent();
    const input = { echo: 'hello' };
    const send = await agent.messageSend({ delegation: grant(), requester: REQUESTER, message: msg(input), input });
    expect(send.ok).toBe(true);
    const events = await agent.processDue();
    expect(events.map((e) => e.state)).toEqual(['working', 'completed']);
    if (send.ok) {
      const t = await agent.tasksGet({ taskId: send.result.taskId, caller: DELEGATOR });
      // wrong: DELEGATOR is not a party (sender=REQUESTER, assignee=AGENT)
      expect(t.ok).toBe(false);
      const t2 = await agent.tasksGet({ taskId: send.result.taskId, caller: REQUESTER });
      expect(t2.ok && t2.result.state).toBe('completed');
      if (t2.ok) expect(t2.result.artifactRefs.length).toBe(1);
    }
  });
});

describe('createA2aAgent — tasks/get + tasks/cancel auth', () => {
  it('unknown task -> not found; non-party -> unauthorized; cancel by party works', async () => {
    const agent = makeAgent();
    const nf = await agent.tasksGet({ taskId: (`0x${'ee'.repeat(32)}`) as Hex, caller: REQUESTER });
    expect(nf.ok).toBe(false);
    const input = { a: 1 };
    const send = await agent.messageSend({ delegation: grant(), requester: REQUESTER, message: msg(input), input });
    if (send.ok) {
      const np = await agent.tasksGet({ taskId: send.result.taskId, caller: ADDR('9') });
      expect(np.ok).toBe(false);
      const c = await agent.tasksCancel({ taskId: send.result.taskId, caller: REQUESTER });
      expect(c.ok && c.result.state).toBe('canceled');
    }
  });
});

describe('JSON-RPC dispatch', () => {
  it('routes message/send + rejects unknown method + bad envelope', async () => {
    const agent = makeAgent();
    const input = { j: 1 };
    const res = await dispatchA2aRpc(agent, { jsonrpc: '2.0', id: 1, method: 'message/send', params: { delegation: grant(), requester: REQUESTER, message: msg(input), input } });
    expect('result' in res).toBe(true);
    const unk = await dispatchA2aRpc(agent, { jsonrpc: '2.0', id: 2, method: 'tasks/frobnicate' });
    expect('error' in unk && unk.error.code).toBe(-32601);
    const bad = await handleA2aRpcBody(agent, '{not json');
    expect('error' in bad && bad.error.code).toBe(-32700);
    const stream = await dispatchA2aRpc(agent, { jsonrpc: '2.0', id: 3, method: 'message/stream' });
    expect('error' in stream).toBe(true);
  });
});

describe('agent-card', () => {
  it('advertises streaming/push/history + the registered skills', () => {
    const card = makeAgent().agentCard();
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: true, stateTransitionHistory: true });
    expect(card.skills).toEqual([{ id: 'echo' }]);
  });
});

describe('A2aWireAdapter (over an injected transport)', () => {
  it('submitTask + getTask round-trip through the agent', async () => {
    const agent = makeAgent();
    const transport: A2aTransport = { rpc: async (_t, req) => dispatchA2aRpc(agent, req) };
    const client = new A2aWireAdapter(transport);
    const input = { ping: true };
    const sub = await client.submitTask(AGENT, { message: msg(input), delegation: grant(), requester: REQUESTER, input });
    expect(sub.state).toBe('submitted');
    await agent.processDue();
    const t = await client.getTask(AGENT, sub.taskId, REQUESTER);
    expect(t.state).toBe('completed');
  });

  it('subscribeTaskUpdates throws without a streaming transport', () => {
    const client = new A2aWireAdapter({ rpc: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) });
    expect(() => client.subscribeTaskUpdates(AGENT, (`0x${'22'.repeat(32)}`) as Hex)).toThrow(/streaming/);
  });
});
