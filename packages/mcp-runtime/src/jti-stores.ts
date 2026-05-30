// JtiStore adapters: memory (test), sqlite (demo + many prod), postgres (prod).
// Each implementation MUST be atomic under concurrent writers per the
// security invariant in spec 205 §5.
//
// H7-B.6 / PKG-MCP-RUNTIME-001 closure (also covers EXT-027). Prior versions
// ran `CREATE TABLE IF NOT EXISTS …` inside the adapter constructor (sqlite)
// or lazily on first `trackUsage` (postgres). That coupled the security hot
// path to runtime DDL permissions:
//   - Postgres deploys following least-privilege (app role lacks DDL): first
//     `trackUsage` throws → JTI store down → replay protection silently
//     disabled (caller swallows → fail-open).
//   - SQLite: CREATE runs at construction → mig-vs-app race.
//
// Fix: explicit `migrate()` step the consumer wires once at bootstrap; the
// runtime path no longer issues DDL. If `migrate()` was not called and the
// table is missing, `trackUsage` fails LOUD with a setup error (not a silent
// noop).

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

/**
 * H7-B.9 / XPKG-005 — explicit environment opt-in. The memory store is
 * the only JTI store that ships with this package and has cross-isolate
 * replay-vulnerability; production deploys MUST pass `environment:
 * 'production'` to gate it on (and supply the `AP_ALLOW_MEMORY_JTI_STORE`
 * opt-out). The previous `process.env.NODE_ENV` check silently opened on
 * Cloudflare Workers / SES where `process.env` is undefined.
 */
export interface CreateMemoryJtiStoreOpts {
  environment?: 'production' | 'development';
}

export function createMemoryJtiStore(opts: CreateMemoryJtiStoreOpts = {}): JtiStore {
  // Production guard — H7-B.9: the caller MUST pass `environment: 'production'`
  // to opt into the gate. We no longer infer from NODE_ENV (Workers / SES
  // runtimes don't reliably expose it, leading to silent fall-open).
  const env = typeof process !== 'undefined' ? (process.env ?? {}) : {};
  const environment = opts.environment ?? (env.NODE_ENV === 'production' ? 'production' : 'development');
  if (environment === 'production' && env[ALLOW_MEMORY_JTI_ENV] !== 'true') {
    throw new Error(
      '[mcp-runtime] createMemoryJtiStore refused: environment="production". ' +
        'The memory store offers no cross-process replay protection. Use ' +
        'createSqliteJtiStore / createPostgresJtiStore / a D1-backed store in ' +
        `production. If you genuinely need to override (e.g., isolated test ` +
        `worker), set ${ALLOW_MEMORY_JTI_ENV}=true and accept that delegation ` +
        'tokens are replay-vulnerable across restarts.',
    );
  }
  if (environment === 'production' && !memoryStoreWarnedOnce) {
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

/**
 * JtiStore extended with an explicit `migrate()` step. H7-B.6: the SQL /
 * pg adapters MUST be migrated once at bootstrap before any `trackUsage`
 * is called. The migrate step is idempotent (`CREATE TABLE IF NOT EXISTS`)
 * but requires DDL permission — keep it out of the security hot path.
 */
export interface MigratableJtiStore extends JtiStore {
  migrate(): Promise<void>;
}

/**
 * H7-B.6 — SQLite JTI store. Construction no longer issues DDL; call
 * `await store.migrate()` from your bootstrap before serving traffic.
 * Calling `trackUsage` without a prior `migrate()` throws a setup error
 * (NOT a silent noop) so least-privilege deploys fail loud, not silent.
 */
export function createSqliteJtiStore(
  db: BetterSqlite3DatabaseLike,
  table: string = 'token_usage',
): MigratableJtiStore {
  let migrated = false;
  let upsert: ReturnType<BetterSqlite3DatabaseLike['prepare']> | null = null;

  const prepareUpsert = () =>
    db.prepare(
      `INSERT INTO ${table} (jti, usage) VALUES (?, 1)
       ON CONFLICT(jti) DO UPDATE SET usage = usage + 1
       RETURNING usage`,
    );

  return {
    async migrate() {
      if (migrated) return;
      db.prepare(
        `CREATE TABLE IF NOT EXISTS ${table} (
          jti TEXT PRIMARY KEY,
          usage INTEGER NOT NULL DEFAULT 0,
          first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ).run();
      upsert = prepareUpsert();
      migrated = true;
    },
    async trackUsage(jti: string, limit: number) {
      if (!migrated || !upsert) {
        throw new Error(
          `[mcp-runtime] sqlite JTI store: migrate() was not called before trackUsage. ` +
            `Call \`await store.migrate()\` once at bootstrap (it is idempotent). ` +
            `H7-B.6 (PKG-MCP-RUNTIME-001 / EXT-027 closure) moved DDL off the hot path.`,
        );
      }
      const row = upsert.get(jti) as { usage: number } | undefined;
      const current = row?.usage ?? 1;
      return { usage: current, allowed: current <= limit };
    },
  };
}

/**
 * H7-B.6 — Postgres JTI store. Construction no longer issues DDL; call
 * `await store.migrate()` from your bootstrap. Calling `trackUsage` without
 * a prior `migrate()` throws a setup error so a misconfigured least-privilege
 * deploy fails loud rather than silently disabling replay protection.
 */
export function createPostgresJtiStore(
  pool: PgPoolLike,
  table: string = 'token_usage',
): MigratableJtiStore {
  let migrated = false;
  return {
    async migrate() {
      if (migrated) return;
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${table} (
          jti TEXT PRIMARY KEY,
          usage INTEGER NOT NULL DEFAULT 0,
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
      );
      migrated = true;
    },
    async trackUsage(jti: string, limit: number) {
      if (!migrated) {
        throw new Error(
          `[mcp-runtime] postgres JTI store: migrate() was not called before trackUsage. ` +
            `Call \`await store.migrate()\` once at bootstrap (it is idempotent). ` +
            `H7-B.6 (PKG-MCP-RUNTIME-001 / EXT-027 closure) moved DDL off the hot path.`,
        );
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
