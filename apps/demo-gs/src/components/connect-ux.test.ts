// Spec 258 — demo-gs connect-UX redesign structural guards.
//
// demo-gs has NO component-test infrastructure (vitest runs in the `node` environment with no
// jsdom / @testing-library). The RENDERING acceptance criteria (product-analysis §6 A1–A6 — the
// card lays out the primary CTA above a collapsed name disclosure, the busy/dim overlay, the
// cancelled/error banners) require a DOM and a testing-library render that this app does not set up,
// so they are DEFERRED to a future component-test harness.
//
// What we CAN assert here without a DOM are the structural guards behind the criteria that are pure
// source-shape invariants: the dead HandoffBridge variants are gone (A9), OnboardPanel is
// content-only / credential-first (A7/A8), and ConnectScreen launches the popup directly (no bridge)
// with the explicit redirect fallback intact (A2/A3/A5). These read the source files as text.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const COMPONENTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SRC_DIR = join(COMPONENTS_DIR, '..');

function read(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), 'utf8');
}

/** Every `.ts`/`.tsx` file under src/, recursively (excludes node_modules — there are none under src,
 *  and THIS test file, which necessarily contains the very literals it asserts are absent). */
function allSourceFiles(dir: string): string[] {
  const self = fileURLToPath(import.meta.url);
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...allSourceFiles(full)); continue; }
    if (full === self) continue;
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('spec 258 — HandoffBridge scope (A9)', () => {
  const sources = allSourceFiles(SRC_DIR).map((f) => readFileSync(f, 'utf8'));

  it('no `variant="new-user"` anywhere in src/', () => {
    for (const src of sources) expect(src).not.toContain('variant="new-user"');
  });

  it('no `variant="reconnect"` anywhere in src/', () => {
    for (const src of sources) expect(src).not.toContain('variant="reconnect"');
  });

  it('the HandoffVariant union is narrowed to org-create only', () => {
    const bridge = read('components/HandoffBridge.tsx');
    const decl = bridge.split('\n').find((l) => l.startsWith('export type HandoffVariant'));
    expect(decl).toBe("export type HandoffVariant = 'org-create';");
    // The dead variants survive nowhere in the variantCopy switch (a `case 'new-user'` / `'reconnect'`).
    expect(bridge).not.toContain("case 'new-user'");
    expect(bridge).not.toContain("case 'reconnect'");
  });

  it('the org-create bridge is still rendered in App.tsx', () => {
    expect(read('App.tsx')).toContain('variant="org-create"');
  });
});

describe('spec 258 — OnboardPanel is content-only / credential-first (A7/A8)', () => {
  const onboard = read('components/OnboardPanel.tsx');

  it('no longer calls startConnect(', () => {
    expect(onboard).not.toContain('startConnect(');
  });

  it('has no name-required guard that blocks before connect', () => {
    // The removed wall was: `if (!trimmed) { setErr(...); return; }`.
    expect(onboard).not.toMatch(/if\s*\(\s*!trimmed\s*\)/);
    expect(onboard).not.toContain('setErr(');
  });

  it('accepts an onConnect prop and the SSO button calls it', () => {
    expect(onboard).toContain('onConnect');
    expect(onboard).toContain('onClick={onConnect}');
  });

  it('preserves the CONNECT_KEY / ConnectStash re-export', () => {
    expect(onboard).toContain("export { CONNECT_KEY, type ConnectStash } from '../lib/connect-launch';");
  });

  it('App wires onConnect={goConnect} into both OnboardPanel renders', () => {
    const app = read('App.tsx');
    expect(app).toContain('<OnboardPanel kind="gco" onConnect={onConnect} />');
    expect(app).toContain('<OnboardPanel kind="kc" onConnect={onConnect} />');
  });
});

describe('spec 258 — ConnectScreen launches the popup directly (A2/A3/A5)', () => {
  const connect = read('components/ConnectScreen.tsx');

  it('no longer references the HandoffBridge or showBridge', () => {
    expect(connect).not.toContain('HandoffBridge');
    expect(connect).not.toContain('showBridge');
  });

  it('startConnectPopup( is the primary connect path', () => {
    expect(connect).toContain('startConnectPopup(');
  });

  it('startConnect( remains for the explicit popup-blocked redirect fallback (ADR-0013)', () => {
    expect(connect).toContain('startConnect(');
    expect(connect).toContain('redirectFallback');
  });

  it('has the secondary name disclosure + soft cancelled banner', () => {
    expect(connect).toContain('showNamePanel');
    expect(connect).toContain('cancelled');
    expect(connect).toContain('Use my Impact name instead');
  });
});
