import { describe, it, expect, vi } from 'vitest';
import {
  noopMetricsSink,
  createConsoleMetricsSink,
  composeMetricsSinks,
  createMemoryMetricsSink,
  createPiiGuardrailSink,
  createMemoryAuditSink,
  type MetricsSink,
} from '../../src/index.js';

describe('noopMetricsSink', () => {
  it('accepts every call and returns undefined (never throws)', () => {
    expect(noopMetricsSink.increment('reqs')).toBeUndefined();
    expect(noopMetricsSink.observe('latency', 12.5)).toBeUndefined();
    expect(noopMetricsSink.gauge('inflight', 3, { route: '/a2a' })).toBeUndefined();
  });
});

describe('createConsoleMetricsSink', () => {
  it('formats count/hist/gauge lines, with the default prefix and tags', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sink = createConsoleMetricsSink();
    sink.increment('reqs');                 // default value = 1, no tags
    sink.observe('latency', 42, { p: '99' }); // with tags → JSON tail
    sink.gauge('depth', 7);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[0]![0]).toBe('[METRIC] count reqs=1');
    expect(log.mock.calls[1]![0]).toBe('[METRIC] hist latency=42 {"p":"99"}');
    expect(log.mock.calls[2]![0]).toBe('[METRIC] gauge depth=7');
    log.mockRestore();
  });

  it('honors a custom prefix', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createConsoleMetricsSink({ prefix: 'M:' }).increment('x', 5);
    expect(log.mock.calls[0]![0]).toBe('M: count x=5');
    log.mockRestore();
  });
});

describe('composeMetricsSinks', () => {
  it('fans out every method to all sinks', () => {
    const a = createMemoryMetricsSink();
    const b = createMemoryMetricsSink();
    const fan = composeMetricsSinks(a, b);
    fan.increment('reqs', 2);
    fan.observe('lat', 10);
    fan.gauge('depth', 4);
    for (const s of [a, b]) {
      const snap = s.snapshot();
      expect(snap.counts.get('reqs')).toBe(2);
      expect(snap.observations.get('lat')).toEqual([10]);
      expect(snap.gauges.get('depth')).toBe(4);
    }
  });

  it('is fail-soft: a throwing sink does not stop the others', () => {
    const boom: MetricsSink = {
      increment: () => { throw new Error('down'); },
      observe: () => { throw new Error('down'); },
      gauge: () => { throw new Error('down'); },
    };
    const good = createMemoryMetricsSink();
    const fan = composeMetricsSinks(boom, good);
    expect(() => { fan.increment('reqs'); fan.observe('lat', 1); fan.gauge('g', 2); }).not.toThrow();
    expect(good.snapshot().counts.get('reqs')).toBe(1); // default value
    expect(good.snapshot().observations.get('lat')).toEqual([1]);
    expect(good.snapshot().gauges.get('g')).toBe(2);
  });
});

describe('createMemoryMetricsSink', () => {
  it('accumulates counts, appends observations, last-write-wins gauges', () => {
    const m = createMemoryMetricsSink();
    m.increment('reqs');       // default 1
    m.increment('reqs', 4);    // → 5
    m.observe('lat', 10);
    m.observe('lat', 20);      // appends
    m.gauge('depth', 1);
    m.gauge('depth', 9);       // overwrites
    const snap = m.snapshot();
    expect(snap.counts.get('reqs')).toBe(5);
    expect(snap.observations.get('lat')).toEqual([10, 20]);
    expect(snap.gauges.get('depth')).toBe(9);
  });

  it('keys by name + sorted tags so tag order is irrelevant', () => {
    const m = createMemoryMetricsSink();
    m.increment('reqs', 1, { b: '2', a: '1' });
    m.increment('reqs', 1, { a: '1', b: '2' }); // same logical key
    m.increment('reqs', 1);                       // untagged → distinct key
    const snap = m.snapshot();
    expect(snap.counts.get('reqs|a=1,b=2')).toBe(2);
    expect(snap.counts.get('reqs')).toBe(1);
  });

  it('snapshot is a copy and reset clears all three maps', () => {
    const m = createMemoryMetricsSink();
    m.increment('reqs'); m.observe('lat', 1); m.gauge('g', 1);
    const before = m.snapshot();
    m.reset();
    expect(before.counts.get('reqs')).toBe(1); // snapshot detached from internal state
    const after = m.snapshot();
    expect(after.counts.size).toBe(0);
    expect(after.observations.size).toBe(0);
    expect(after.gauges.size).toBe(0);
  });
});

describe('createPiiGuardrailSink — classification + modes (margin)', () => {
  const longHex = '0x' + 'a'.repeat(120);
  // A PEM block fixture — CERTIFICATE, not a key, so the secret scanner has nothing to flag while
  // still exercising the guardrail's PEM_BLOCK classifier (which only matches the `-----BEGIN ` marker).
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

  it('redacts long-hex in a non-allowlisted context key + records the finding', async () => {
    const inner = createMemoryAuditSink();
    const onDetect = vi.fn();
    const sink = createPiiGuardrailSink(inner, { onDetect });
    await sink.write({ id: '1', timestamp: 't', action: 'x', outcome: 'success', context: { secretBlob: longHex } });
    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(inner.events()[0]!.context!.secretBlob).toMatch(/^<redacted:long-hex:/);
  });

  it('redacts subject.id, actor.id, reason and audience', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner);
    await sink.write({
      id: '2', timestamp: 't', action: 'x', outcome: 'error',
      subject: { type: 'mystery', id: longHex },
      actor: { type: 'service', id: longHex },
      reason: pem, audience: longHex,
    });
    const ev = inner.events()[0]!;
    expect(ev.subject!.id).toMatch(/^<redacted:/);
    expect(ev.actor!.id).toMatch(/^<redacted:/);
    expect(ev.reason).toMatch(/^<redacted:pem-block:/);
    expect(ev.audience).toMatch(/^<redacted:long-hex:/);
  });

  it('mode "drop" forwards nothing; mode "warn" forwards unchanged', async () => {
    const dropInner = createMemoryAuditSink();
    await createPiiGuardrailSink(dropInner, { mode: 'drop' }).write({ id: '3', timestamp: 't', action: 'x', outcome: 'success', context: { b: longHex } });
    expect(dropInner.events()).toHaveLength(0);

    const warnInner = createMemoryAuditSink();
    await createPiiGuardrailSink(warnInner, { mode: 'warn' }).write({ id: '4', timestamp: 't', action: 'x', outcome: 'success', context: { b: longHex } });
    expect(warnInner.events()[0]!.context!.b).toBe(longHex); // unchanged
  });

  it('skips allowlisted subject types + leaves clean events untouched', async () => {
    const inner = createMemoryAuditSink();
    const sink = createPiiGuardrailSink(inner, { allowSubjectTypes: ['wallet'] });
    await sink.write({ id: '5', timestamp: 't', action: 'x', outcome: 'success', subject: { type: 'wallet', id: longHex } });
    expect(inner.events()[0]!.subject!.id).toBe(longHex); // allowlisted → not redacted
  });
});
