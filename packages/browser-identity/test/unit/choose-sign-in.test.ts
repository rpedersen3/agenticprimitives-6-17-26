import { describe, expect, it, vi, afterEach } from 'vitest';
import { chooseSignIn, fedcmAvailable } from '../../src/index';

afterEach(() => {
  delete (globalThis as { IdentityCredential?: unknown }).IdentityCredential;
  vi.restoreAllMocks();
});

describe('fedcmAvailable', () => {
  it('false when IdentityCredential is absent (default test env)', () => {
    expect(fedcmAvailable()).toBe(false);
  });
});

describe('chooseSignIn (Phase 0 — FedCM-first, not FedCM-only)', () => {
  it('runs the fallback when no fedcm strategy is provided (the Phase-0 seam: zero behaviour change)', async () => {
    const fallback = vi.fn(async () => 'fallback-result');
    await expect(chooseSignIn({ fallback })).resolves.toBe('fallback-result');
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('runs the fallback when fedcm is provided but the browser lacks FedCM', async () => {
    const fedcm = vi.fn(async () => 'fedcm-result');
    const fallback = vi.fn(async () => 'fallback-result');
    await expect(chooseSignIn({ fedcm, fallback })).resolves.toBe('fallback-result');
    expect(fedcm).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('runs FedCM when supported AND provided', async () => {
    (globalThis as { IdentityCredential?: unknown }).IdentityCredential = class {};
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { credentials: { get: () => {} } });
    const fedcm = vi.fn(async () => 'fedcm-result');
    const fallback = vi.fn(async () => 'fallback-result');
    await expect(chooseSignIn({ fedcm, fallback })).resolves.toBe('fedcm-result');
    expect(fedcm).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('prefer:"fallback" pins the fallback even when FedCM is available', async () => {
    (globalThis as { IdentityCredential?: unknown }).IdentityCredential = class {};
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { credentials: { get: () => {} } });
    const fedcm = vi.fn(async () => 'fedcm-result');
    const fallback = vi.fn(async () => 'fallback-result');
    await expect(chooseSignIn({ fedcm, fallback, prefer: 'fallback' })).resolves.toBe('fallback-result');
    expect(fedcm).not.toHaveBeenCalled();
  });

  it('prefer:"fedcm" with no fedcm strategy safely falls back', async () => {
    const fallback = vi.fn(async () => 'fallback-result');
    await expect(chooseSignIn({ fallback, prefer: 'fedcm' })).resolves.toBe('fallback-result');
    expect(fallback).toHaveBeenCalledOnce();
  });
});
