import { describe, it, expect } from 'vitest';
import {
  createMemoryJtiStore,
  createSqliteJtiStore,
  createPostgresJtiStore,
} from '../../src/jti-stores';
import type { BetterSqlite3DatabaseLike, PgPoolLike } from '../../src/types';

describe('createMemoryJtiStore', () => {
  it('first use is usage=1, allowed under limit', async () => {
    const s = createMemoryJtiStore();
    const r = await s.trackUsage('jti_1', 10);
    expect(r.usage).toBe(1);
    expect(r.allowed).toBe(true);
  });

  it('increments per call until limit then rejects', async () => {
    const s = createMemoryJtiStore();
    for (let i = 1; i <= 5; i++) {
      const r = await s.trackUsage('jti_x', 5);
      expect(r.usage).toBe(i);
      expect(r.allowed).toBe(true);
    }
    const sixth = await s.trackUsage('jti_x', 5);
    expect(sixth.usage).toBe(6);
    expect(sixth.allowed).toBe(false);
  });

  it('different jtis are independent', async () => {
    const s = createMemoryJtiStore();
    await s.trackUsage('a', 1);
    await s.trackUsage('a', 1);
    const b = await s.trackUsage('b', 1);
    expect(b.usage).toBe(1);
    expect(b.allowed).toBe(true);
  });

  it('atomic under simulated concurrency (100 parallel writers, single jti)', async () => {
    const s = createMemoryJtiStore();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => s.trackUsage('concurrent', 100)),
    );
    // All 100 calls succeeded; the highest usage is exactly 100.
    const max = Math.max(...results.map((r) => r.usage));
    expect(max).toBe(100);
    // Every reported usage is unique (no double-count).
    const usages = results.map((r) => r.usage).sort((a, b) => a - b);
    expect(usages).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});

describe('H7-B.6 — SQLite JTI store DDL out of hot path', () => {
  // Spy-shaped fake — counts prepare/run calls so we can assert "construction
  // does not issue DDL" and "migrate() does."
  function makeFakeSqlite() {
    const prepared: string[] = [];
    const ran: string[] = [];
    const fake: BetterSqlite3DatabaseLike = {
      prepare(sql: string) {
        prepared.push(sql);
        return {
          run() {
            ran.push(sql);
          },
          get() {
            return { usage: 1 };
          },
        };
      },
    } as unknown as BetterSqlite3DatabaseLike;
    return { fake, prepared, ran };
  }

  it('createSqliteJtiStore does NOT issue DDL at construction', () => {
    const { fake, prepared, ran } = makeFakeSqlite();
    createSqliteJtiStore(fake, 'test_tbl');
    expect(prepared.length).toBe(0);
    expect(ran.length).toBe(0);
  });

  it('trackUsage without migrate() throws a setup error', async () => {
    const { fake } = makeFakeSqlite();
    const s = createSqliteJtiStore(fake, 'test_tbl');
    await expect(s.trackUsage('any', 10)).rejects.toThrow(/migrate\(\) was not called/);
  });

  it('after migrate() the hot path runs and is idempotent on re-call', async () => {
    const { fake, ran } = makeFakeSqlite();
    const s = createSqliteJtiStore(fake, 'test_tbl');
    await s.migrate();
    await s.migrate(); // idempotent
    expect(ran.filter((q) => /CREATE TABLE/.test(q)).length).toBe(1);
    const r = await s.trackUsage('jti', 10);
    expect(r.usage).toBe(1);
    expect(r.allowed).toBe(true);
  });
});

describe('H7-B.6 — Postgres JTI store DDL out of hot path', () => {
  function makeFakePg() {
    const queries: string[] = [];
    const fake: PgPoolLike = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ usage: 1 }] } as { rows: Array<{ usage: number }> };
      },
    } as unknown as PgPoolLike;
    return { fake, queries };
  }

  it('createPostgresJtiStore does NOT issue DDL at construction', () => {
    const { fake, queries } = makeFakePg();
    createPostgresJtiStore(fake, 'tbl');
    expect(queries.length).toBe(0);
  });

  it('trackUsage without migrate() throws a setup error', async () => {
    const { fake } = makeFakePg();
    const s = createPostgresJtiStore(fake, 'tbl');
    await expect(s.trackUsage('any', 10)).rejects.toThrow(/migrate\(\) was not called/);
  });

  it('after migrate() the hot path runs; migrate is idempotent', async () => {
    const { fake, queries } = makeFakePg();
    const s = createPostgresJtiStore(fake, 'tbl');
    await s.migrate();
    await s.migrate();
    expect(queries.filter((q) => /CREATE TABLE/.test(q)).length).toBe(1);
    const r = await s.trackUsage('jti', 10);
    expect(r.usage).toBe(1);
    expect(r.allowed).toBe(true);
  });
});
