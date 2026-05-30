import { describe, it, expect, vi } from 'vitest';
import {
  buildEvent,
  composeSinks,
  composeFailSoftSinks,
  composeFailHardSinks,
  createConsoleAuditSink,
  createMemoryAuditSink,
  createPiiGuardrailSink,
  generateEventId,
  nowIso,
  type AuditEvent,
  type AuditSink,
  type PiiFinding,
} from '../../src';

describe('generateEventId', () => {
  it('returns a UUID-shaped string', () => {
    const id = generateEventId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('returns different values on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateEventId());
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
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = createConsoleAuditSink();
    const event = buildEvent({ action: 'test.action', outcome: 'success' });
    await sink.write(event);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line.startsWith('[AUDIT] ')).toBe(true);
    const parsed = JSON.parse(line.slice('[AUDIT] '.length));
    expect(parsed.action).toBe('test.action');
    expect(parsed.outcome).toBe('success');
    spy.mockRestore();
  });

  it('respects custom prefix', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = createConsoleAuditSink({ prefix: '[CUSTOM]' });
    await sink.write(buildEvent({ action: 'x', outcome: 'success' }));
    const line = spy.mock.calls[0]?.[0] as string;
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: AuditSink = {
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
    await expect(
      composed.write(buildEvent({ action: 'none', outcome: 'success' })),
    ).resolves.toBeUndefined();
  });
});

describe('H7-B.7 — composeFailSoftSinks + composeFailHardSinks', () => {
  it('composeSinks remains an alias for composeFailSoftSinks (no behavior change)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: AuditSink = {
      async write() {
        throw new Error('soft-boom');
      },
    };
    const ok = createMemoryAuditSink();
    const a = composeSinks(failing, ok);
    const b = composeFailSoftSinks(failing, ok);
    await expect(a.write(buildEvent({ action: 'a', outcome: 'success' }))).resolves.toBeUndefined();
    await expect(b.write(buildEvent({ action: 'b', outcome: 'success' }))).resolves.toBeUndefined();
    expect(ok.events()).toHaveLength(2);
    errorSpy.mockRestore();
  });

  it('composeFailHardSinks PROPAGATES the first sink failure to the caller', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: AuditSink = {
      async write() {
        throw new Error('durable-write-failed');
      },
    };
    const ok = createMemoryAuditSink();
    const composed = composeFailHardSinks(failing, ok);
    await expect(
      composed.write(buildEvent({ action: 'delegation.mint', outcome: 'success' })),
    ).rejects.toThrow(/durable-write-failed/);
    // The remaining sink still saw the event (every sink gets a chance to record).
    expect(ok.events()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('composeFailHardSinks resolves when every sink succeeds (happy path)', async () => {
    const a = createMemoryAuditSink();
    const b = createMemoryAuditSink();
    const composed = composeFailHardSinks(a, b);
    await expect(
      composed.write(buildEvent({ action: 'custody.apply', outcome: 'success' })),
    ).resolves.toBeUndefined();
    expect(a.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(1);
  });
});

describe('AuditEvent schema (type-level smoke)', () => {
  it('accepts the canonical shape with all optional fields', () => {
    const event: AuditEvent = {
      id: 'fixed-id',
      timestamp: '2026-05-20T00:00:00.000Z',
      action: 'mcp-runtime.with-delegation.accept',
      outcome: 'success',
      actor: { type: 'user', id: '0xabc' },
      subject: { type: 'delegation', id: '0xdef' },
      correlationId: 'req-1',
      audience: 'urn:mcp:server:person',
      chainId: 84532,
      digest: '0x' + 'ab'.repeat(32) as `0x${string}`,
      reason: undefined,
      context: { jtiUsage: 1, tool: 'get_profile' },
    };
    // The structural assertion is the type check itself; we just ensure
    // the object is well-formed at runtime.
    expect(event.action).toBe('mcp-runtime.with-delegation.accept');
  });

  it('outcome is constrained to the union', () => {
    // Type-only assertion: this just compiles or it doesn't.
    const outcomes: Array<AuditEvent['outcome']> = ['success', 'denied', 'error'];
    expect(outcomes).toHaveLength(3);
  });
});

// ─── createPiiGuardrailSink (pass 5g, AUD-1) ─────────────────────────

describe('createPiiGuardrailSink', () => {
  // 130-char hex (32-byte private key with 0x prefix) — strictly above
  // the default 80-char threshold and outside any allowlisted key.
  const PRIVATE_KEY = '0x' + 'ab'.repeat(64);
  // 42-char Ethereum address — must NEVER be flagged.
  const ADDRESS = '0x' + 'cd'.repeat(20);
  // 66-char keccak digest — under threshold; allowed unconditionally.
  const DIGEST = '0x' + 'ef'.repeat(32);

  function clean(): AuditEvent {
    return buildEvent({
      action: 'mcp-runtime.with-delegation.accept',
      outcome: 'success',
      actor: { type: 'user', id: ADDRESS },
      subject: { type: 'tool', id: 'get_profile' },
      audience: 'urn:mcp:server:person',
      context: { signerAddress: ADDRESS, digest: DIGEST, keyId: 'local-master' },
    });
  }

  it('passes a clean event through unmodified', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    await sink.write(clean());
    expect(inner.events()).toHaveLength(1);
    expect(inner.events()[0]!.context).toEqual({
      signerAddress: ADDRESS,
      digest: DIGEST,
      keyId: 'local-master',
    });
  });

  it('redacts a private-key-shaped hex in an unknown context field', async () => {
    const inner = createMemoryAuditSink();
    let captured: PiiFinding[] | undefined;
    const sink = createPiiGuardrailSink(inner, {
      onDetect: ({ findings }) => {
        captured = findings;
      },
    });
    const evt = clean();
    evt.context = { ...evt.context, token: PRIVATE_KEY };
    await sink.write(evt);

    const written = inner.events()[0]!;
    expect(written.context!.token).toMatch(/^<redacted:long-hex:hex-130>$/);
    // Original PRIVATE_KEY value must not have leaked through.
    expect(JSON.stringify(written)).not.toContain(PRIVATE_KEY);
    expect(captured).toHaveLength(1);
    expect(captured![0]).toMatchObject({ path: 'context.token', reason: 'long-hex' });
  });

  it('respects the allowKeys allowlist for legitimate long hex', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = clean();
    // signerAddress is allowlisted by default; even with a long value
    // it must NOT be flagged.
    evt.context = { ...evt.context, signerAddress: PRIVATE_KEY };
    await sink.write(evt);
    expect(inner.events()[0]!.context!.signerAddress).toBe(PRIVATE_KEY);
  });

  it('respects allowSubjectTypes — subject.id for sign-digest passes through', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = buildEvent({
      action: 'key-custody.sign',
      outcome: 'success',
      subject: { type: 'sign-digest', id: PRIVATE_KEY }, // legitimately long
    });
    await sink.write(evt);
    expect(inner.events()[0]!.subject!.id).toBe(PRIVATE_KEY);
  });

  it('detects JWT-shaped strings', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = clean();
    // 3 base64url segments, >100 chars total.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'a'.repeat(60) + '.' + 'b'.repeat(40);
    evt.context = { ...evt.context, token: jwt };
    await sink.write(evt);
    expect(inner.events()[0]!.context!.token).toMatch(/^<redacted:jwt-shape:jwt-3-seg-/);
  });

  it('detects secret-key substring in reason', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = clean();
    evt.reason = 'Decryption failed: private_key was nil';
    await sink.write(evt);
    expect(inner.events()[0]!.reason).toMatch(/^<redacted:secret-substring:/);
  });

  it('mode=drop suppresses forwarding entirely', async () => {
    const inner = createMemoryAuditSink();
    let detected = false;
    const sink = createPiiGuardrailSink(inner, {
      mode: 'drop',
      onDetect: () => {
        detected = true;
      },
    });
    const evt = clean();
    evt.context = { ...evt.context, token: PRIVATE_KEY };
    await sink.write(evt);
    expect(detected).toBe(true);
    expect(inner.events()).toHaveLength(0); // dropped
    // A clean event in drop mode still passes through.
    await sink.write(clean());
    expect(inner.events()).toHaveLength(1);
  });

  it('mode=warn forwards the ORIGINAL event but still calls onDetect', async () => {
    const inner = createMemoryAuditSink();
    let captured: PiiFinding[] | undefined;
    const sink = createPiiGuardrailSink(inner, {
      mode: 'warn',
      onDetect: ({ findings }) => {
        captured = findings;
      },
    });
    const evt = clean();
    evt.context = { ...evt.context, token: PRIVATE_KEY };
    await sink.write(evt);
    expect(captured).toHaveLength(1);
    // warn mode forwards UNMODIFIED — the original leak is in inner.
    expect(inner.events()[0]!.context!.token).toBe(PRIVATE_KEY);
  });

  it('does not mutate the caller-supplied event object', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = clean();
    evt.context = { ...evt.context, token: PRIVATE_KEY };
    const callerRef = evt.context.token;
    await sink.write(evt);
    expect(evt.context.token).toBe(callerRef); // original untouched
    expect(inner.events()[0]!.context!.token).not.toBe(callerRef); // sink got sanitized copy
  });

  it('addresses (42 chars) are below threshold even outside allowlist', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = clean();
    // Drop into an unknown key; should still pass because it's under 80 chars.
    evt.context = { someAddress: ADDRESS };
    await sink.write(evt);
    expect(inner.events()[0]!.context!.someAddress).toBe(ADDRESS);
  });

  it('keccak digests (66 chars) under default threshold even outside allowlist', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    const evt = clean();
    evt.context = { otherDigest: DIGEST };
    await sink.write(evt);
    expect(inner.events()[0]!.context!.otherDigest).toBe(DIGEST);
  });

  it('composes with composeSinks — guardrail sanitizes for D1, console gets raw', async () => {
    // Pattern in spec 206: console for ops + guardrail-wrapped persistent
    // sink. The guardrail is one layer; placement in the composition
    // determines what reaches each destination.
    const persistent = createMemoryAuditSink();
    const console = createMemoryAuditSink();
    const sink = composeSinks(
      console,
      createPiiGuardrailSink(persistent),
    );
    const evt = clean();
    evt.context = { ...evt.context, token: PRIVATE_KEY };
    await sink.write(evt);
    // Console sees the raw event (it's first in the chain, not wrapped).
    expect(console.events()[0]!.context!.token).toBe(PRIVATE_KEY);
    // Persistent destination only sees the sanitized event.
    expect(persistent.events()[0]!.context!.token).toMatch(/^<redacted:/);
  });
});
