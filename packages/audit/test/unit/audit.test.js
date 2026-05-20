import { describe, it, expect, vi } from 'vitest';
import { buildEvent, composeSinks, createConsoleAuditSink, createMemoryAuditSink, generateEventId, nowIso, } from '../../src';
describe('generateEventId', () => {
    it('returns a UUID-shaped string', () => {
        const id = generateEventId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
    it('returns different values on each call', () => {
        const ids = new Set();
        for (let i = 0; i < 100; i++)
            ids.add(generateEventId());
        expect(ids.size).toBe(100);
    });
});
describe('nowIso', () => {
    it('returns an ISO-8601 UTC string', () => {
        const s = nowIso();
        expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
});
describe('buildEvent', () => {
    it('fills in id + timestamp when omitted', () => {
        const e = buildEvent({ action: 'test.action', outcome: 'success' });
        expect(e.id).toBeDefined();
        expect(e.timestamp).toBeDefined();
        expect(e.action).toBe('test.action');
        expect(e.outcome).toBe('success');
    });
    it('preserves provided id and timestamp', () => {
        const e = buildEvent({
            id: 'fixed-id',
            timestamp: '2026-05-20T00:00:00.000Z',
            action: 'test.action',
            outcome: 'success',
        });
        expect(e.id).toBe('fixed-id');
        expect(e.timestamp).toBe('2026-05-20T00:00:00.000Z');
    });
    it('passes through all optional fields', () => {
        const e = buildEvent({
            action: 'mcp-runtime.with-delegation.accept',
            outcome: 'success',
            actor: { type: 'user', id: '0x123' },
            subject: { type: 'delegation', id: '0xabc' },
            correlationId: 'req-42',
            audience: 'urn:mcp:server:person',
            chainId: 84532,
            context: { jtiUsage: 1, principal: '0x123' },
        });
        expect(e.actor).toEqual({ type: 'user', id: '0x123' });
        expect(e.subject).toEqual({ type: 'delegation', id: '0xabc' });
        expect(e.correlationId).toBe('req-42');
        expect(e.audience).toBe('urn:mcp:server:person');
        expect(e.chainId).toBe(84532);
        expect(e.context?.jtiUsage).toBe(1);
    });
});
describe('createMemoryAuditSink', () => {
    it('captures events in order', async () => {
        const sink = createMemoryAuditSink();
        await sink.write(buildEvent({ action: 'a', outcome: 'success' }));
        await sink.write(buildEvent({ action: 'b', outcome: 'denied' }));
        await sink.write(buildEvent({ action: 'c', outcome: 'error' }));
        const events = sink.events();
        expect(events).toHaveLength(3);
        expect(events.map((e) => e.action)).toEqual(['a', 'b', 'c']);
    });
    it('respects capacity (FIFO eviction)', async () => {
        const sink = createMemoryAuditSink({ capacity: 2 });
        await sink.write(buildEvent({ action: 'a', outcome: 'success' }));
        await sink.write(buildEvent({ action: 'b', outcome: 'success' }));
        await sink.write(buildEvent({ action: 'c', outcome: 'success' }));
        const events = sink.events();
        expect(events).toHaveLength(2);
        expect(events.map((e) => e.action)).toEqual(['b', 'c']);
    });
    it('reset clears the buffer', async () => {
        const sink = createMemoryAuditSink();
        await sink.write(buildEvent({ action: 'a', outcome: 'success' }));
        sink.reset();
        expect(sink.events()).toHaveLength(0);
    });
});
describe('createConsoleAuditSink', () => {
    it('writes JSON to console.log', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const sink = createConsoleAuditSink();
        const event = buildEvent({ action: 'test.action', outcome: 'success' });
        await sink.write(event);
        expect(spy).toHaveBeenCalledTimes(1);
        const line = spy.mock.calls[0]?.[0];
        expect(line.startsWith('[AUDIT] ')).toBe(true);
        const parsed = JSON.parse(line.slice('[AUDIT] '.length));
        expect(parsed.action).toBe('test.action');
        expect(parsed.outcome).toBe('success');
        spy.mockRestore();
    });
    it('respects custom prefix', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const sink = createConsoleAuditSink({ prefix: '[CUSTOM]' });
        await sink.write(buildEvent({ action: 'x', outcome: 'success' }));
        const line = spy.mock.calls[0]?.[0];
        expect(line.startsWith('[CUSTOM] ')).toBe(true);
        spy.mockRestore();
    });
});
describe('composeSinks', () => {
    it('fans out to all sinks', async () => {
        const a = createMemoryAuditSink();
        const b = createMemoryAuditSink();
        const composed = composeSinks(a, b);
        const event = buildEvent({ action: 'fan-out', outcome: 'success' });
        await composed.write(event);
        expect(a.events()).toHaveLength(1);
        expect(b.events()).toHaveLength(1);
    });
    it('continues fan-out even when one sink rejects', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const failing = {
            async write() {
                throw new Error('boom');
            },
        };
        const ok = createMemoryAuditSink();
        const composed = composeSinks(failing, ok);
        const event = buildEvent({ action: 'partial-fail', outcome: 'success' });
        // The composed sink swallows the failure (fail-soft); the caller's
        // request flow is never broken by an audit-emission error.
        await expect(composed.write(event)).resolves.toBeUndefined();
        expect(ok.events()).toHaveLength(1);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
    it('composes empty sink list cleanly (no-op)', async () => {
        const composed = composeSinks();
        await expect(composed.write(buildEvent({ action: 'none', outcome: 'success' }))).resolves.toBeUndefined();
    });
});
describe('AuditEvent schema (type-level smoke)', () => {
    it('accepts the canonical shape with all optional fields', () => {
        const event = {
            id: 'fixed-id',
            timestamp: '2026-05-20T00:00:00.000Z',
            action: 'mcp-runtime.with-delegation.accept',
            outcome: 'success',
            actor: { type: 'user', id: '0xabc' },
            subject: { type: 'delegation', id: '0xdef' },
            correlationId: 'req-1',
            audience: 'urn:mcp:server:person',
            chainId: 84532,
            digest: '0x' + 'ab'.repeat(32),
            reason: undefined,
            context: { jtiUsage: 1, tool: 'get_profile' },
        };
        // The structural assertion is the type check itself; we just ensure
        // the object is well-formed at runtime.
        expect(event.action).toBe('mcp-runtime.with-delegation.accept');
    });
    it('outcome is constrained to the union', () => {
        // Type-only assertion: this just compiles or it doesn't.
        const outcomes = ['success', 'denied', 'error'];
        expect(outcomes).toHaveLength(3);
    });
});
//# sourceMappingURL=audit.test.js.map