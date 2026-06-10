import { describe, it, expect } from 'vitest';
import {
  newTaskRecord,
  applyTransition,
  dispatchTask,
  buildSkillRegistry,
  createInMemoryTaskStore,
  AuthRequired,
  type SkillHandler,
  type TaskRecord,
  type A2aMessage,
} from '../src/index.js';

const ADDR = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;
const PRINCIPAL = ADDR('a');
const ASSIGNEE = ADDR('b');
const SENDER = ADDR('c');
const HASH = (`0x${'ab'.repeat(32)}`) as `0x${string}`;

const msg: A2aMessage = {
  messageId: (`0x${'11'.repeat(32)}`) as `0x${string}`,
  sender: SENDER,
  skill: 'echo',
  bodyRef: { owner: ASSIGNEE, recordType: 'a2a:msg:1' },
  bodyHash: HASH,
  signature: '0xdead',
  createdAt: 1000,
};

const DUMMY_DELEGATION = {
  delegator: PRINCIPAL, delegate: SENDER, authority: '0x', caveats: [], salt: 0n, signature: '0x',
} as never;

function freshRecord(skill = 'echo'): TaskRecord {
  return newTaskRecord({
    taskId: (`0x${'22'.repeat(32)}`) as `0x${string}`,
    principal: PRINCIPAL, assignee: ASSIGNEE, sender: SENDER, skill, delegation: DUMMY_DELEGATION,
    inbound: { ...msg, skill }, permissionGrantRef: HASH, inputHash: HASH, now: 1000,
  });
}

// makeContext stub — W1 doesn't exercise vault/mcp; just supplies input + a dummy delegation.
const makeCtx = (input: unknown) => () => ({
  input,
  delegation: { delegator: PRINCIPAL, delegate: SENDER, authority: '0x', caveats: [], salt: 0n, signature: '0x' } as never,
  vault: { read: async () => null, write: async () => ({ owner: ASSIGNEE, recordType: 'x' }) },
  mcp: { callTool: async () => null },
  emitArtifact: async () => (`0x${'33'.repeat(32)}`) as `0x${string}`,
});

describe('newTaskRecord', () => {
  it('starts submitted with rev 1 and the grant ref', () => {
    const r = freshRecord();
    expect(r.task.state).toBe('submitted');
    expect(r.rev).toBe(1);
    expect(r.task.permissionGrantRef).toBe(HASH);
    expect(r.principal).toBe(PRINCIPAL);
  });
});

describe('applyTransition (fail-closed)', () => {
  it('allows submitted -> working', () => {
    const t = applyTransition(freshRecord(), 'working', { now: 2000 });
    expect(t.ok).toBe(true);
    if (t.ok) { expect(t.record.task.state).toBe('working'); expect(t.record.rev).toBe(2); }
  });
  it('rejects an illegal submitted -> completed', () => {
    const t = applyTransition(freshRecord(), 'completed', { now: 2000 });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toMatch(/illegal transition/);
  });
  it('rejects a no-op transition', () => {
    expect(applyTransition(freshRecord(), 'submitted', { now: 2000 }).ok).toBe(false);
  });
});

describe('dispatchTask', () => {
  const echo: SkillHandler = {
    skill: 'echo',
    handle: async (ctx) => {
      const id = await ctx.emitArtifact({ artifactKind: 'echo', body: ctx.input });
      return { state: 'completed', artifactIds: [id] };
    },
  };

  it('unknown skill -> rejected, no handler run', async () => {
    const reg = buildSkillRegistry([echo]);
    const { record, events } = await dispatchTask(freshRecord('nope'), reg, makeCtx({}), 3000);
    expect(record.task.state).toBe('rejected');
    expect(record.error).toMatch(/unknown skill/);
    expect(events.at(-1)?.state).toBe('rejected');
  });

  it('runs the handler: submitted -> working -> completed with artifacts', async () => {
    const reg = buildSkillRegistry([echo]);
    const { record, events } = await dispatchTask(freshRecord(), reg, makeCtx({ hi: 1 }), 3000);
    expect(record.task.state).toBe('completed');
    expect(record.task.artifactIds.length).toBe(1);
    expect(events.map((e) => e.state)).toEqual(['working', 'completed']);
  });

  it('AuthRequired -> auth-required', async () => {
    const reg = buildSkillRegistry([{ skill: 'echo', handle: async (ctx) => ctx.requestAuth('expired') }]);
    const { record } = await dispatchTask(freshRecord(), reg, makeCtx({}), 3000);
    expect(record.task.state).toBe('auth-required');
  });

  it('handler throw -> failed with error', async () => {
    const reg = buildSkillRegistry([{ skill: 'echo', handle: async () => { throw new Error('boom'); } }]);
    const { record } = await dispatchTask(freshRecord(), reg, makeCtx({}), 3000);
    expect(record.task.state).toBe('failed');
    expect(record.error).toBe('boom');
  });

  // FR-3.6 — hand-off, policy-gated (FLF-INV-09).
  const TARGET = ADDR('e');
  const policy = (over = {}) => ({ allowedTargetAgents: [TARGET], allowedAgentClasses: [], requiresUserApproval: false, preservePrivacyTier: false, allowedScopes: [], maxHopCount: 3, ...over });

  it('requestHandoff to an allowed target -> completed + records the handoff', async () => {
    const reg = buildSkillRegistry([{ skill: 'echo', handle: async (ctx) => ctx.requestHandoff({ target: TARGET, reason: 'specialist' }) }]);
    const { record } = await dispatchTask(freshRecord(), reg, makeCtx({}), 3000, { handoffPolicy: policy() });
    expect(record.task.state).toBe('completed');
    expect(record.handoff?.target).toBe(TARGET);
    expect(record.hopCount).toBe(1);
  });

  it('requestHandoff with NO policy -> rejected (fail-closed)', async () => {
    const reg = buildSkillRegistry([{ skill: 'echo', handle: async (ctx) => ctx.requestHandoff({ target: TARGET }) }]);
    const { record } = await dispatchTask(freshRecord(), reg, makeCtx({}), 3000);
    expect(record.task.state).toBe('failed');
    expect(record.error).toMatch(/handoff not permitted/);
  });

  it('requestHandoff to a disallowed target -> rejected', async () => {
    const reg = buildSkillRegistry([{ skill: 'echo', handle: async (ctx) => ctx.requestHandoff({ target: ADDR('9') }) }]);
    const { record } = await dispatchTask(freshRecord(), reg, makeCtx({}), 3000, { handoffPolicy: policy() });
    expect(record.task.state).toBe('failed');
  });

  it('requestHandoff over the hop budget -> rejected', async () => {
    const reg = buildSkillRegistry([{ skill: 'echo', handle: async (ctx) => ctx.requestHandoff({ target: TARGET }) }]);
    const rec = { ...freshRecord(), hopCount: 3 };
    const { record } = await dispatchTask(rec, reg, makeCtx({}), 3000, { handoffPolicy: policy({ maxHopCount: 3 }) });
    expect(record.task.state).toBe('failed');
  });
});

describe('buildSkillRegistry', () => {
  it('rejects duplicate skills', () => {
    const h: SkillHandler = { skill: 'x', handle: async () => ({ state: 'completed' }) };
    expect(() => buildSkillRegistry([h, h])).toThrow(/duplicate/);
  });
});

describe('createInMemoryTaskStore', () => {
  it('put/get + listDue tracks non-terminal + reserveMessageId is one-shot', async () => {
    const store = createInMemoryTaskStore();
    const r = freshRecord();
    await store.put(r);
    expect((await store.get(r.task.taskId))?.task.state).toBe('submitted');
    expect(await store.listDue(0)).toContain(r.task.taskId);
    const done = applyTransition(r, 'working', { now: 1 });
    if (done.ok) { const c = applyTransition(done.record, 'completed', { now: 2 }); if (c.ok) await store.put(c.record); }
    expect(await store.listDue(0)).not.toContain(r.task.taskId);
    expect(await store.reserveMessageId(msg.messageId, 60)).toBe(true);
    expect(await store.reserveMessageId(msg.messageId, 60)).toBe(false);
  });
});

describe('AuthRequired', () => {
  it('carries the reason', () => {
    expect(new AuthRequired('nope').authReason).toBe('nope');
  });
});
