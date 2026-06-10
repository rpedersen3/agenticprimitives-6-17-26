import { describe, it, expect } from 'vitest';
import { keccak256, toBytes, type Hex } from 'viem';
import { ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import {
  createA2aAgent,
  buildA2aGrantCaveats,
  createInMemoryTaskStore,
  hashPushPayload,
  deliverPush,
  verifyPushEnvelope,
  formatSseEvent,
  isStreamEnd,
  type A2aEnforcers,
  type OnChainChecks,
  type SkillHandler,
  type VaultClient,
  type A2aMessage,
  type PushEnvelope,
  type TaskRecord,
} from '../src/index.js';

const ADDR = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;
const AGENT = ADDR('b');
const REQUESTER = ADDR('c');
const DELEGATOR = ADDR('a');
const enforcers: A2aEnforcers = { allowedTargets: ADDR('1'), allowedMethods: ADDR('2'), timestamp: ADDR('3') };
const hashBody = (data: unknown) => keccak256(toBytes(JSON.stringify(data ?? null)));
const okChecks = (): OnChainChecks => ({ isRevoked: async () => false, verifyDelegationSignature: async () => true, verifyMessageSignature: async () => true });
const grant = (): Delegation => ({ delegator: DELEGATOR, delegate: REQUESTER, authority: ROOT_AUTHORITY, caveats: buildA2aGrantCaveats({ recipientAgentSA: AGENT, skill: 'echo', enforcers, window: { validAfter: 0, validUntil: 9_999_999_999 } }), salt: 0n, signature: '0xsig' });
const msg = (input: unknown): A2aMessage => ({ messageId: (`0x${'11'.repeat(32)}`) as Hex, sender: REQUESTER, skill: 'echo', bodyRef: { owner: AGENT, recordType: 'pending' }, bodyHash: hashBody(input), signature: '0xmsg', createdAt: 1000 });

function vault(): VaultClient & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return { store, async write({ owner, recordType, data }) { store.set(`${owner}:${recordType}`, data); return { owner, recordType }; }, async read(ref) { return store.get(`${ref.owner}:${ref.recordType}`) ?? null; } };
}
const echo: SkillHandler = { skill: 'echo', handle: async (ctx) => ({ state: 'completed', artifactIds: [await ctx.emitArtifact({ artifactKind: 'echo', body: ctx.input })] }) };

describe('push envelope (FR-5.2 / SR-5)', () => {
  const rec = (): TaskRecord => ({
    task: { taskId: (`0x${'22'.repeat(32)}`) as Hex, state: 'completed', assignee: AGENT, assigneeKind: 'agent', inputHash: (`0x${'ab'.repeat(32)}`) as Hex, artifactIds: [(`0x${'33'.repeat(32)}`) as Hex], maxRetries: 0, permissionGrantRef: (`0x${'cd'.repeat(32)}`) as Hex },
    principal: DELEGATOR, sender: REQUESTER, skill: 'echo', delegation: grant(), inbound: [], artifacts: [], rev: 3, updatedAt: 5000,
    pushConfig: { url: 'https://reader.example/push', token: 'tok' },
  });

  it('deliverPush signs + sends; the receiver verifies the assignee signature', async () => {
    let sent: PushEnvelope | undefined;
    const sign = async (digest: Hex) => (`0x${'ee'.repeat(32)}${digest.slice(2, 4)}`) as Hex; // deterministic stub
    const send = async (_url: string, env: PushEnvelope) => { sent = env; };
    const ok = await deliverPush(rec(), sign, send, 5000);
    expect(ok).toBe(true);
    expect(sent?.token).toBe('tok');
    // receiver: verify recomputes hashPushPayload(payload) + checks the assignee sig
    let asked: { account: string; digest: string; sig: string } | undefined;
    const verify = async (account: `0x${string}`, digest: Hex, sig: Hex) => { asked = { account, digest, sig }; return true; };
    expect(await verifyPushEnvelope(sent!, AGENT, verify)).toBe(true);
    expect(asked!.account).toBe(AGENT);
    expect(asked!.digest).toBe(hashPushPayload(sent!.payload));
  });

  it('no pushConfig -> no-op (false)', async () => {
    const r = rec(); delete r.pushConfig;
    expect(await deliverPush(r, async () => '0x' as Hex, async () => {}, 0)).toBe(false);
  });

  it('retries a transient send failure then succeeds', async () => {
    let n = 0;
    const send = async () => { if (++n < 2) throw new Error('502'); };
    expect(await deliverPush(rec(), async () => '0x' as Hex, send, 0, 2)).toBe(true);
    expect(n).toBe(2);
  });

  it('gives up after exhausting retries', async () => {
    const send = async () => { throw new Error('down'); };
    expect(await deliverPush(rec(), async () => '0x' as Hex, send, 0, 1)).toBe(false);
  });
});

describe('agent — vault residency + push on terminal (W4 e2e)', () => {
  it('emitArtifact persists the body to the vault + push fires on completed', async () => {
    const v = vault();
    const pushed: PushEnvelope[] = [];
    let n = 0;
    const agent = createA2aAgent({
      agentSA: AGENT, chainId: 84532, delegationManager: ADDR('d'), enforcers,
      taskStore: createInMemoryTaskStore(), checks: okChecks(), handlers: [echo], vault: v, mcp: { callTool: async () => null },
      hashBody, now: () => 5000, newTaskId: () => (`0x${(++n).toString(16).padStart(64, '0')}`) as Hex,
      signTerminal: async (d) => (`0x${'ee'.repeat(32)}${d.slice(2, 4)}`) as Hex,
      pushSender: async (_url, env) => { pushed.push(env); },
    });
    const input = { echo: 'hi' };
    const send = await agent.messageSend({ delegation: grant(), requester: REQUESTER, message: msg(input), input, pushConfig: { url: 'https://reader/push' } });
    expect(send.ok).toBe(true);
    await agent.processDue();
    // artifact body landed in the vault
    const bodies = [...v.store.entries()].filter(([k]) => k.includes('a2a:artifact:'));
    expect(bodies.length).toBe(1);
    expect(bodies[0]![1]).toEqual(input);
    // push fired with the terminal state
    expect(pushed.length).toBe(1);
    expect(pushed[0]!.payload.state).toBe('completed');
  });

  it('pushConfigSet registers a webhook (party-authed)', async () => {
    const agent = createA2aAgent({
      agentSA: AGENT, chainId: 84532, delegationManager: ADDR('d'), enforcers,
      taskStore: createInMemoryTaskStore(), checks: okChecks(), handlers: [echo], vault: vault(), mcp: { callTool: async () => null },
      hashBody, now: () => 5000, newTaskId: () => (`0x${'00'.repeat(31)}07`) as Hex,
    });
    const input = { a: 1 };
    const send = await agent.messageSend({ delegation: grant(), requester: REQUESTER, message: msg(input), input });
    if (send.ok) {
      const stranger = await agent.pushConfigSet({ taskId: send.result.taskId, caller: ADDR('9'), url: 'https://x/p' });
      expect(stranger.ok).toBe(false);
      const party = await agent.pushConfigSet({ taskId: send.result.taskId, caller: REQUESTER, url: 'https://x/p' });
      expect(party.ok && party.result.registered).toBe(true);
    }
  });
});

describe('SSE framing (FR-5.3)', () => {
  it('formats a frame + flags terminal states as stream-end', () => {
    const frame = formatSseEvent({ kind: 'task.status', taskId: (`0x${'22'.repeat(32)}`) as Hex, state: 'working', rev: 2 });
    expect(frame).toMatch(/^event: task.status\ndata: /);
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(isStreamEnd({ kind: 'task.status', taskId: (`0x${'22'.repeat(32)}`) as Hex, state: 'completed', rev: 3 })).toBe(true);
    expect(isStreamEnd({ kind: 'task.status', taskId: (`0x${'22'.repeat(32)}`) as Hex, state: 'working', rev: 2 })).toBe(false);
  });
});
