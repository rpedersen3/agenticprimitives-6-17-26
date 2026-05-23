// JtiStore adapters: memory (test), sqlite (demo + many prod), postgres (prod).
// Each implementation MUST be atomic under concurrent writers per the
// security invariant in spec 205 §5.

import type { JtiStore } from '@agenticprimitives/delegation';
import type { BetterSqlite3DatabaseLike, PgPoolLike } from './types';

/**
 * Sentinel env var. When set to "true", `createMemoryJtiStore` will
 * construct in production without throwing. Required for one-off
 * scenarios (CI smoke tests against a prod-built bundle, isolated dev
 * worker instances). All callers MUST treat this as a loud opt-in — a
 * one-time `console.warn` is emitted on construction.
 */
export const ALLOW_MEMORY_JTI_ENV = 'AGENTIC_ALLOW_MEMORY_JTI_STORE';

let memoryStoreWarnedOnce = false;

export function createMemoryJtiStore(): JtiStore {
  // Production guard. The memory store has zero replay protection
  // across worker isolates / restarts / horizontal pods. Wiring it in
  // production silently disables JTI tracking — a critical-severity
  // regression — so we fail loud at construction.
  const env = typeof process !== 'undefined' ? (process.env ?? {}) : {};
  if (env.NODE_ENV === 'production' && env[ALLOW_MEMORY_JTI_ENV] !== 'true') {
    throw new Error(
      '[mcp-runtime] createMemoryJtiStore refused: NODE_ENV=production. ' +
        'The memory store offers no cross-process replay protection. Use ' +
        'createSqliteJtiStore / createPostgresJtiStore / a D1-backed store in ' +
        `production. If you genuinely need to override (e.g., isolated test ` +
        `worker), set ${ALLOW_MEMORY_JTI_ENV}=true and accept that delegation ` +
        'tokens are replay-vulnerable across restarts.',
    );
  }
  if (env.NODE_ENV === 'production' && !memoryStoreWarnedOnce) {
    console.warn(
      `[mcp-runtime] ⚠ MEMORY JTI STORE in production — ${ALLOW_MEMORY_JTI_ENV} ` +
        'is set; delegation-token replay protection is non-durable. Remove this ' +
        'flag before handling real-value workloads.',
    );
    memoryStoreWarnedOnce = true;
  }
  const usage = new Map<string, number>();
  return {
    async trackUsage(jti: string, limit: number) {
      const current = (usage.get(jti) ?? 0) + 1;
      usage.set(jti, current);
      return { usage: current, allowed: current <= limit };
    },
  };
}

export function createSqliteJtiStore(
  db: BetterSqlite3DatabaseLike,
  table: string = 'token_usage',
): JtiStore {
  // The CREATE TABLE is idempotent; safe to run on every construction.
  db.prepare(
    `CREATE TABLE IF NOT EXISTS ${table} (
      jti TEXT PRIMARY KEY,
      usage INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ).run();

  const upsert = db.prepare(
    `INSERT INTO ${table} (jti, usage) VALUES (?, 1)
     ON CONFLICT(jti) DO UPDATE SET usage = usage + 1
     RETURNING usage`,
  );

  return {
    async trackUsage(jti: string, limit: number) {
      const row = upsert.get(jti) as { usage: number } | undefined;
      const current = row?.usage ?? 1;
      return { usage: current, allowed: current <= limit };
    },
  };
}

export function createPostgresJtiStore(
  pool: PgPoolLike,
  table: string = 'token_usage',
): JtiStore {
  let initialized = false;
  return {
    async trackUsage(jti: string, limit: number) {
      if (!initialized) {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS ${table} (
            jti TEXT PRIMARY KEY,
            usage INTEGER NOT NULL DEFAULT 0,
            first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`,
        );
        initialized = true;
      }
      const res = await pool.query(
        `INSERT INTO ${table} (jti, usage) VALUES ($1, 1)
         ON CONFLICT (jti) DO UPDATE SET usage = ${table}.usage + 1
         RETURNING usage`,
        [jti],
      );
      const current = (res.rows[0] as { usage: number } | undefined)?.usage ?? 1;
      return { usage: current, allowed: current <= limit };
    },
  };
}
