// spec 277 Phase 1 — the Vault seam contract (exercised via the in-memory adapter).
import { describe, it, expect } from 'vitest';
import {
  createMemoryVault,
  projectFields,
  isSensitiveClassification,
  SENSITIVE_CLASSIFICATIONS,
} from '../../src/index.js';

const OWNER = 'eip155:8453:0xABCdef0000000000000000000000000000000001';

describe('createMemoryVault', () => {
  it('round-trips write → read with classification + updatedAt', async () => {
    const v = createMemoryVault({ now: () => '2026-06-17T00:00:00Z' });
    await v.write({ owner: OWNER, resource: 'person-pii', data: { email: 'a@b.c', phone: '+1' }, classification: 'pii.sensitive' });
    const obj = await v.read({ owner: OWNER, resource: 'person-pii' });
    expect(obj).not.toBeNull();
    expect(obj!.classification).toBe('pii.sensitive');
    expect(obj!.data).toEqual({ email: 'a@b.c', phone: '+1' });
    expect(obj!.updatedAt).toBe('2026-06-17T00:00:00Z');
    expect(obj!.owner).toBe(OWNER.toLowerCase());
  });

  it('owner match is case-insensitive', async () => {
    const v = createMemoryVault();
    await v.write({ owner: OWNER, resource: 'r', data: { x: 1 } });
    expect(await v.read({ owner: OWNER.toUpperCase(), resource: 'r' })).not.toBeNull();
  });

  it('tombstones on write(null) — absent from read + list', async () => {
    const v = createMemoryVault();
    await v.write({ owner: OWNER, resource: 'r', data: { x: 1 }, classification: 'internal' });
    await v.write({ owner: OWNER, resource: 'r', data: null });
    expect(await v.read({ owner: OWNER, resource: 'r' })).toBeNull();
    expect(await v.list(OWNER)).toEqual([]);
  });

  it('list returns only the owner’s live refs (no payloads), sorted', async () => {
    const v = createMemoryVault({ now: () => 'T' });
    await v.write({ owner: OWNER, resource: 'b', data: { x: 1 }, classification: 'internal' });
    await v.write({ owner: OWNER, resource: 'a', data: { y: 2 }, classification: 'pii.low' });
    await v.write({ owner: 'eip155:8453:0xother', resource: 'z', data: { z: 3 } });
    const refs = await v.list(OWNER);
    expect(refs.map((r) => r.resource)).toEqual(['a', 'b']);
    expect(refs[0]).toEqual({ resource: 'a', classification: 'pii.low', updatedAt: 'T' });
  });

  it('read with fields projects only requested keys', async () => {
    const v = createMemoryVault();
    await v.write({ owner: OWNER, resource: 'r', data: { email: 'a@b.c', phone: '+1', ssn: '000' } });
    const obj = await v.read({ owner: OWNER, resource: 'r', fields: ['email', 'phone', 'missing'] });
    expect(obj!.data).toEqual({ email: 'a@b.c', phone: '+1' });
  });

  it('missing object reads as null', async () => {
    const v = createMemoryVault();
    expect(await v.read({ owner: OWNER, resource: 'nope' })).toBeNull();
  });
});

describe('classification helpers + projectFields', () => {
  it('isSensitiveClassification', () => {
    expect(isSensitiveClassification('pii.sensitive')).toBe(true);
    expect(isSensitiveClassification('secret.high')).toBe(true);
    expect(isSensitiveClassification('public')).toBe(false);
    expect(isSensitiveClassification('internal')).toBe(false);
    expect(SENSITIVE_CLASSIFICATIONS).toContain('delegation.private');
  });

  it('projectFields is a no-op without fields and passes through non-objects', () => {
    expect(projectFields({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(projectFields('scalar', ['a'])).toBe('scalar');
    expect(projectFields([1, 2], ['0'])).toEqual([1, 2]);
  });
});
