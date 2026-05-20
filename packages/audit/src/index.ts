/**
 * @agenticprimitives/audit — append-only audit/forensics primitives.
 *
 * Owns:
 *  - The canonical `AuditEvent` schema every other package emits.
 *  - The `AuditSink` interface a consumer implements (or composes from
 *    one of the provided sinks).
 *  - In-band sinks: `createConsoleAuditSink`, `createMemoryAuditSink`.
 *
 * Does NOT own:
 *  - Concrete persistence backends (D1 / Cloud Logging / Splunk / etc.).
 *    Those live with the consumer that needs them.
 *  - Domain semantics — `action` is a free-string the emitter chooses
 *    (e.g. `<package>.<surface>.<outcome>`).
 *
 * Doctrine (per CLAUDE.md): zero domain knowledge. The schema is
 * deliberately structural — every package's emitter knows what to put
 * in `subject` / `context`; this package only stamps the shape.
 *
 * Closes system audit finding C3.
 */

import type { Hex } from '@agenticprimitives/types';

// ─── Event schema ─────────────────────────────────────────────────────

/**
 * One audit event. Designed to be JSON-serialisable for sinks that
 * persist or forward over HTTP. All fields are strings or numbers so
 * the on-wire shape matches the in-memory shape with no codec needed.
 *
 * `id` is per-event (UUID-ish); `correlationId` ties multiple events
 * to a single request / flow / session.
 */
export interface AuditEvent {
  /** Per-event unique ID. UUID v4 (or v7 if you have it) recommended. */
  id: string;
  /** Ties events from the same browser request / job / pipeline. */
  correlationId?: string;
  /** ISO-8601 timestamp (UTC). */
  timestamp: string;
  /**
   * Free-form dotted action name. Convention:
   * `<package>.<surface>.<outcome>`. The schema doesn't enforce a
   * registry; consumers should keep a doc-list of the action strings
   * they emit in each package's `AUDIT.md` under "Audit events
   * emitted".
   */
  action: string;
  /**
   * Outcome class. `success` for normal operations, `denied` for
   * authority/policy rejects (NOT errors — denial IS a security
   * outcome that must be auditable), `error` for unexpected failures.
   */
  outcome: 'success' | 'denied' | 'error';
  /**
   * Who initiated. Use stable identifiers — smart-account address,
   * service identity (`a2a-to-mcp`), system label (`bundler`, etc.).
   */
  actor?: {
    type: 'user' | 'service' | 'system' | 'unknown';
    /** Smart-account address, service name, or system label. */
    id?: string;
  };
  /**
   * What was acted on. Free-form `type` discriminator + opaque `id` —
   * consumers choose conventions like `tool`/`session`/`tx`/etc. The
   * audit package deliberately does not enumerate types because that
   * would couple it to domain vocabulary.
   */
  subject?: {
    type: string;
    id: string;
  };
  /** Human-readable + structured reason for non-success outcomes. */
  reason?: string;
  /**
   * Free-form additional structured context. Keep keys flat (no nested
   * objects) so structured-log backends (Cloud Logging, Datadog) index
   * cleanly.
   */
  context?: Record<string, string | number | boolean | null>;
  /** Audience / route for service-to-service events. */
  audience?: string;
  /** Chain ID for on-chain events. */
  chainId?: number;
  /** On-chain tx / digest, when relevant. */
  digest?: Hex;
}

// ─── Sink interface ───────────────────────────────────────────────────

/**
 * The minimal contract every audit sink implements. `write` is async
 * because the most useful sinks are persistent (D1, HTTP, etc.); even
 * in-memory sinks return a resolved promise for shape symmetry.
 *
 * Sinks MUST be append-only — events never edited or deleted. The
 * sink's persistence backend (D1 schema, log retention, etc.) should
 * enforce this, but the interface assumes it.
 *
 * Sinks SHOULD be fail-soft: an audit-emission failure should NOT
 * propagate as a request failure. Instead, log the failure to a
 * fallback channel (the in-band console). Implementations decide
 * how to handle the rare double-failure.
 */
export interface AuditSink {
  /** Emit one event. Resolves on durable acceptance; rejects only on
   *  programmer error (malformed event), never on transient backend
   *  failure (those are absorbed inside the sink). */
  write(event: AuditEvent): Promise<void>;
}

// ─── Provided sinks ───────────────────────────────────────────────────

/**
 * Emit events as one-line JSON to `console.log`. Suitable for
 * Cloudflare Workers (where `wrangler tail` surfaces console output)
 * and for local dev. Production deploys typically PAIR this with a
 * durable sink — see `composeSinks` below.
 */
export function createConsoleAuditSink(opts?: {
  /** Prefix used to filter the audit events out of regular logs.
   *  Default: `'[AUDIT]'`. */
  prefix?: string;
}): AuditSink {
  const prefix = opts?.prefix ?? '[AUDIT]';
  return {
    async write(event) {
      // One-line JSON; Cloudflare's log line limit is 1KB so we stay
      // compact. If `context` overflows, the line gets clipped — that's
      // the sink's responsibility to handle (e.g. by pre-truncating).
      const line = `${prefix} ${JSON.stringify(event)}`;
      // eslint-disable-next-line no-console
      console.log(line);
    },
  };
}

/**
 * In-memory ring buffer. **Test-only.** Production sinks must be
 * durable; this is for unit tests + the demo's recent-events UI.
 */
export interface MemoryAuditSink extends AuditSink {
  /** Read out the captured events (oldest first). */
  events(): AuditEvent[];
  /** Clear the buffer. */
  reset(): void;
}

export function createMemoryAuditSink(opts?: {
  /** Maximum events retained; older events discarded FIFO. Default 1024. */
  capacity?: number;
}): MemoryAuditSink {
  const capacity = opts?.capacity ?? 1024;
  const buf: AuditEvent[] = [];
  return {
    async write(event) {
      buf.push(event);
      if (buf.length > capacity) buf.shift();
    },
    events() {
      return buf.slice();
    },
    reset() {
      buf.length = 0;
    },
  };
}

/**
 * Combine multiple sinks into one. Each emit fans out to all sinks
 * sequentially; a failure in one sink does NOT short-circuit the
 * others — every sink gets a chance to record the event.
 *
 * Production wiring is typically `composeSinks(d1Sink, consoleSink)`
 * — durable storage plus a tail-friendly mirror.
 */
export function composeSinks(...sinks: AuditSink[]): AuditSink {
  return {
    async write(event) {
      const errors: unknown[] = [];
      for (const sink of sinks) {
        try {
          await sink.write(event);
        } catch (e) {
          errors.push(e);
        }
      }
      if (errors.length > 0) {
        // Surface to console as a last resort — the audit event itself
        // may have been written to some sinks but not others.
        // eslint-disable-next-line no-console
        console.error(
          `[audit] ${errors.length} sink(s) failed for event ${event.id}:`,
          errors,
        );
      }
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate a UUID-shaped event ID. Uses Web Crypto when available
 * (Workers, modern Node); falls back to a deterministic ordering for
 * legacy Node (warning: NOT cryptographically random — tests + dev only).
 */
export function generateEventId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback: 16 random-ish bytes formatted as a UUID v4.
  const bytes = new Uint8Array(16);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Convenience: produce an ISO-8601 UTC timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build an `AuditEvent` with sane defaults. Saves callers from
 * repeatedly writing `id: generateEventId(), timestamp: nowIso()`.
 *
 * Required: `action`, `outcome`. Everything else optional + spreads
 * through.
 */
export function buildEvent(
  partial: Omit<AuditEvent, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: string;
  },
): AuditEvent {
  return {
    id: partial.id ?? generateEventId(),
    timestamp: partial.timestamp ?? nowIso(),
    ...partial,
  };
}
