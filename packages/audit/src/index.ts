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

// ─── PII guardrail (defense-in-depth) ────────────────────────────────

/**
 * One detected probable-leak. Reported to `onDetect` and embedded in
 * the redacted event's `_pii` context field so reviewers can trace
 * where the leak came from without seeing the value.
 */
export interface PiiFinding {
  /** Dotted path within the event (e.g. `context.token`, `subject.id`, `reason`). */
  path: string;
  /** Why we flagged it (`long-hex`, `jwt-shape`, `pem-block`, `secret-substring`). */
  reason: string;
  /** Safe descriptor of the original value (e.g. `hex-130`, `jwt-3-seg`). */
  preview: string;
}

export interface PiiGuardrailOpts {
  /**
   * What to do on detection.
   * - `'redact'` (default): replace the offending value in-place with a
   *   safe descriptor (`<redacted:<reason>:<preview>>`); forward the
   *   sanitized event to the inner sink. Preserves forensics minus the
   *   leaked field.
   * - `'drop'`: do NOT forward the event at all. Strictest setting;
   *   loses the row from the trail entirely.
   * - `'warn'`: forward unchanged, just notify via `onDetect`. Useful
   *   during initial roll-out so reviewers see what would be flagged
   *   before enforcement kicks in.
   */
  mode?: 'redact' | 'drop' | 'warn';
  /**
   * Maximum hex string length (chars, including any `0x` prefix) tolerated
   * in non-allowlisted positions. Default 80 — leaves Ethereum addresses
   * (42), keccak/sha256 digests (66), and tx hashes (66) all comfortably
   * below the threshold while catching raw private keys (130) and longer
   * session secrets.
   */
  maxHexLength?: number;
  /**
   * `context` keys (and well-known top-level fields) where long hex is
   * legitimately expected. Merged with the built-in safe set
   * (`signerAddress`, `address`, `paymaster`, `entryPoint`, `keyId`,
   * `nonceHash`, `sessionHash`, `digest`, `txHash`, `blockHash`, `jti`,
   * `eventId`).
   */
  allowKeys?: string[];
  /**
   * `subject.type` values whose `subject.id` is allowed to be any length
   * of hex (e.g. `sign-digest` carries a 32-byte digest). Merged with
   * the built-in safe set (`jti`, `sign-digest`, `tx-hash`, `address`,
   * `event-id`).
   */
  allowSubjectTypes?: string[];
  /**
   * Callback invoked on every detection, regardless of `mode`. The
   * sanitized event (or original, in `warn` mode) is passed alongside
   * the findings. Useful for routing a "guardrail caught a leak" signal
   * to a separate alerting channel.
   */
  onDetect?: (info: { event: AuditEvent; findings: PiiFinding[] }) => void;
}

const DEFAULT_ALLOW_KEYS = new Set([
  'signerAddress',
  'address',
  'paymaster',
  'entryPoint',
  'keyId',
  'nonceHash',
  'sessionHash',
  'digest',
  'txHash',
  'blockHash',
  'jti',
  'eventId',
]);
const DEFAULT_ALLOW_SUBJECT_TYPES = new Set([
  'jti',
  'sign-digest',
  'tx-hash',
  'address',
  'event-id',
]);

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PEM_BLOCK = /-----BEGIN /;
const SECRET_SUBSTRING = /(private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;

/**
 * Wrapper sink that scans event payloads for likely-secret material and
 * either redacts / drops / warns before forwarding to `inner`. **This is
 * defense-in-depth**, not a substitute for the emitter discipline rule
 * "MUST hash or omit raw secrets" (per the audit package CLAUDE.md
 * invariant). It catches accidental leaks at the sink boundary.
 *
 * Production wiring example:
 * ```ts
 * const sink = composeSinks(
 *   createConsoleAuditSink({ prefix: '[AUDIT]' }),
 *   createPiiGuardrailSink(createD1AuditSink(env.DB), { mode: 'redact' }),
 * );
 * ```
 *
 * The guardrail's own decisions are not themselves audit events — they
 * surface through `onDetect`. Use that to wire alerts ("found a leak in
 * action=X") if you want them in your own metrics pipeline.
 */
export function createPiiGuardrailSink(inner: AuditSink, opts?: PiiGuardrailOpts): AuditSink {
  const mode = opts?.mode ?? 'redact';
  const maxHexLength = opts?.maxHexLength ?? 80;
  const allowKeys = new Set([...DEFAULT_ALLOW_KEYS, ...(opts?.allowKeys ?? [])]);
  const allowSubjectTypes = new Set([
    ...DEFAULT_ALLOW_SUBJECT_TYPES,
    ...(opts?.allowSubjectTypes ?? []),
  ]);
  const longHex = new RegExp(`^0x[0-9a-fA-F]{${maxHexLength - 2},}$`);

  function classify(value: string): { reason: string; preview: string } | null {
    if (longHex.test(value)) {
      return { reason: 'long-hex', preview: `hex-${value.length}` };
    }
    if (value.length > 100 && JWT_SHAPE.test(value)) {
      const segs = value.split('.').length;
      return { reason: 'jwt-shape', preview: `jwt-${segs}-seg-len-${value.length}` };
    }
    if (PEM_BLOCK.test(value)) {
      return { reason: 'pem-block', preview: 'pem' };
    }
    if (SECRET_SUBSTRING.test(value)) {
      return { reason: 'secret-substring', preview: `match-len-${value.length}` };
    }
    return null;
  }

  function redactToken(reason: string, preview: string): string {
    return `<redacted:${reason}:${preview}>`;
  }

  return {
    async write(event: AuditEvent) {
      const findings: PiiFinding[] = [];
      // Deep-ish copy of the event so we can mutate fields without
      // affecting the caller's reference.
      const sanitized: AuditEvent = {
        ...event,
        context: event.context ? { ...event.context } : undefined,
        subject: event.subject ? { ...event.subject } : undefined,
        actor: event.actor ? { ...event.actor } : undefined,
      };

      const scan = (path: string, value: unknown, redactInPlace: (token: string) => void): void => {
        if (typeof value !== 'string') return;
        const hit = classify(value);
        if (!hit) return;
        findings.push({ path, reason: hit.reason, preview: hit.preview });
        if (mode === 'redact') redactInPlace(redactToken(hit.reason, hit.preview));
      };

      // context.* — skip allowlisted keys (legitimate hex carriers).
      if (sanitized.context) {
        for (const [k, v] of Object.entries(sanitized.context)) {
          if (allowKeys.has(k)) continue;
          scan(`context.${k}`, v, (token) => {
            sanitized.context![k] = token;
          });
        }
      }
      // subject.id — skip when subject.type is a known hex-carrier.
      if (sanitized.subject && !allowSubjectTypes.has(sanitized.subject.type)) {
        scan('subject.id', sanitized.subject.id, (token) => {
          sanitized.subject!.id = token;
        });
      }
      // actor.id — same rules; addresses + service names are typically short.
      if (sanitized.actor?.id) {
        scan('actor.id', sanitized.actor.id, (token) => {
          sanitized.actor!.id = token;
        });
      }
      // reason / audience — free-string fields that could carry stack traces.
      if (sanitized.reason) {
        scan('reason', sanitized.reason, (token) => {
          sanitized.reason = token;
        });
      }
      if (sanitized.audience) {
        scan('audience', sanitized.audience, (token) => {
          sanitized.audience = token;
        });
      }

      if (findings.length > 0) {
        opts?.onDetect?.({ event: sanitized, findings });
      }

      if (findings.length > 0 && mode === 'drop') {
        // Don't forward at all. The onDetect callback above is the
        // only signal that a row was dropped.
        return;
      }
      if (findings.length > 0 && mode === 'warn') {
        // Forward unchanged.
        await inner.write(event);
        return;
      }
      await inner.write(sanitized);
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
