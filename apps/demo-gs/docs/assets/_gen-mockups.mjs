// Generates the demo-gs UX mockups as SVG wireframes (structural, not a style refresh — boxes +
// labels + the demo-gs indigo palette communicate layout/hierarchy). Run from repo root:
//   node apps/demo-gs/docs/assets/_gen-mockups.mjs
// Emits *.svg into this directory; they're referenced from ../production-ux-design-spec.md.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const W = 1120, H = 760;
const C = {
  primary: '#4f46e5', primaryActive: '#3730a3', primarySubtle: '#eef2ff', primaryBorder: '#c7d2fe',
  accent: '#0369a1', accentSubtle: '#f0f9ff', accentBorder: '#7dd3fc',
  g900: '#0f172a', g700: '#334155', g600: '#475569', g500: '#64748b', g400: '#94a3b8',
  g300: '#cbd5e1', g200: '#e2e8f0', g100: '#f1f5f9', g50: '#f8fafc', white: '#ffffff',
  ok: '#16a34a', okSubtle: '#f0fdf4', warn: '#d97706', warnSubtle: '#fffbeb',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const E = [];
const rect = (x, y, w, h, { fill = C.white, stroke = C.g200, sw = 1.5, r = 12 } = {}) =>
  E.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
const line = (x1, y1, x2, y2, { stroke = C.g200, sw = 1.5, dash = '' } = {}) =>
  E.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
const txt = (x, y, s, { size = 14, fill = C.g700, weight = 400, anchor = 'start', mono = false } = {}) =>
  E.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" font-family="${mono ? "'SF Mono','Roboto Mono',monospace" : "Inter,system-ui,-apple-system,'Segoe UI',sans-serif"}">${esc(s)}</text>`);
const pill = (x, y, s, { fill = C.g100, fg = C.g600, border = C.g200, w = null } = {}) => {
  const ww = w ?? (s.length * 7 + 22);
  rect(x, y, ww, 22, { fill, stroke: border, r: 11, sw: 1 });
  txt(x + ww / 2, y + 15, s, { size: 11, fill: fg, weight: 700, anchor: 'middle' });
  return ww;
};
const btn = (x, y, w, s, { primary = false, ghost = false } = {}) => {
  const fill = primary ? C.primary : ghost ? C.white : C.g100;
  const fg = primary ? C.white : C.primary;
  rect(x, y, w, 34, { fill, stroke: primary ? C.primary : C.primaryBorder, r: 9, sw: 1.5 });
  txt(x + w / 2, y + 22, s, { size: 13, fill: fg, weight: 700, anchor: 'middle' });
};
const tag = (x, y, s) => { rect(x, y, s.length * 6.2 + 16, 20, { fill: C.primarySubtle, stroke: C.primaryBorder, r: 10, sw: 1 }); txt(x + (s.length * 6.2 + 16) / 2, y + 14, s, { size: 10.5, fill: C.primaryActive, weight: 700, anchor: 'middle' }); return s.length * 6.2 + 16; };
const eyebrow = (x, y, s) => txt(x, y, s.toUpperCase(), { size: 10.5, fill: C.primary, weight: 800 });
const lines = (x, y, widths, { gap = 13, color = C.g200 } = {}) => widths.forEach((w, i) => line(x, y + i * gap, x + w, y + i * gap, { stroke: color, sw: 6 }));

function frame(title) {
  E.length = 0;
  rect(0, 0, W, H, { fill: C.g50, stroke: C.g50, r: 0 });
  // top bar
  rect(0, 0, W, 56, { fill: C.white, stroke: C.g200, r: 0 });
  rect(24, 16, 24, 24, { fill: C.primary, stroke: C.primaryActive, r: 8 });
  txt(58, 28, 'Global Switchboard', { size: 15, weight: 800, fill: C.g900 });
  txt(58, 42, 'skills · needs · offerings · matches', { size: 10, fill: C.g500 });
  txt(W - 24, 33, title, { size: 11, fill: C.g400, weight: 700, anchor: 'end' });
}
function save(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter,system-ui,sans-serif">\n${E.join('\n')}\n</svg>\n`;
  writeFileSync(join(DIR, name), svg);
  console.log('  wrote', name);
}

// ── 1. Landing ──────────────────────────────────────────────────────────────
frame('signed out · landing');
btn(W - 130, 12, 100, 'Connect ▾', { primary: true });
btn(W - 270, 12, 130, 'Browse directory', { ghost: true });
txt(60, 130, 'Find the Kingdom expertise you need —', { size: 30, weight: 800, fill: C.g900 });
txt(60, 168, 'or offer yours.', { size: 30, weight: 800, fill: C.primary });
txt(60, 200, 'Global.Church holds your identity + data. Global Switchboard brokers explainable matches.', { size: 14, fill: C.g600 });
btn(60, 222, 200, 'Post a need  (GCO →)', { primary: true });
btn(276, 222, 200, 'Offer a skill  (KC →)', { ghost: true });
// public signal proof
rect(60, 300, 1000, 150, { fill: C.white });
eyebrow(80, 330, 'Public skill-gap signal · /api/signal');
txt(80, 352, 'Open skill gaps right now', { size: 16, weight: 800, fill: C.g900 });
const gaps = [['Grant Writing', 7], ['Translation', 5], ['Web Dev', 4], ['Video', 3], ['M&E', 2]];
gaps.forEach((g, i) => { const y = 372 + i * 14; txt(80, y + 4, g[0], { size: 11, fill: C.g700 }); rect(200, y - 6, g[1] * 28, 9, { fill: C.primary, stroke: C.primary, r: 4 }); txt(210 + g[1] * 28, y + 4, g[1], { size: 11, weight: 700, fill: C.g700 }); });
// trust cards
['Your data stays in your Global.Church home', 'Switchboard brokers + explains matches', 'Global Church issues the agreement'].forEach((t, i) => {
  const x = 60 + i * 340; rect(x, 480, 320, 130, { fill: C.white });
  tag(x + 20, 502, ['DATA', 'BROKER', 'ISSUER'][i]); txt(x + 20, 552, t.split(' ').slice(0, 3).join(' '), { size: 14, weight: 700, fill: C.g800 }); lines(x + 20, 572, [260, 220]);
});
txt(60, 660, 'Three steps: Connect via Global.Church → choose your role → work from your secure workspace.', { size: 12, fill: C.g500 });
save('demo-gs-landing.svg');

// ── 2. Connect + grant review ─────────────────────────────────────────────────
frame('role-aware connect + grant review');
rect(310, 110, 500, 540, { fill: C.white });
eyebrow(340, 152, 'Before you connect');
txt(340, 178, 'Connect via Global.Church', { size: 22, weight: 800, fill: C.g900 });
tag(340, 196, 'Selected: GCO Organization');
txt(340, 250, 'What Global.Church will do', { size: 13, weight: 800, fill: C.g700 });
lines(340, 268, [430, 400]);
txt(340, 320, 'What Switchboard will receive', { size: 13, weight: 800, fill: C.g700 });
rect(340, 334, 440, 96, { fill: C.primarySubtle, stroke: C.primaryBorder });
txt(356, 358, 'Owner: your GCO org Smart Agent', { size: 12, fill: C.primaryActive, weight: 700 });
txt(356, 378, 'Scope: posted needs + match status (intended)', { size: 12, fill: C.primaryActive });
txt(356, 398, 'Purpose: broker matches · Limit: revocable at home', { size: 12, fill: C.primaryActive });
txt(356, 418, 'Contact released only when a connection is accepted', { size: 12, fill: C.primaryActive });
btn(340, 470, 440, '🌐  Continue to Global.Church', { primary: true });
txt(340, 524, 'Switch path: KC expert  ·  Help me choose', { size: 12, fill: C.primary });
rect(340, 548, 440, 70, { fill: C.g50 });
txt(356, 574, 'You’ll confirm with your device at', { size: 11, fill: C.g500 });
txt(356, 592, 'maria.impact-agent.me', { size: 12, fill: C.g700, mono: true, weight: 700 });
save('demo-gs-connect-grant-review.svg');

// ── 3. Role discovery ─────────────────────────────────────────────────────────
frame('post-connect role discovery');
rect(60, 100, 480, 560, { fill: C.white });
eyebrow(84, 138, 'Setting up your workspace');
txt(84, 162, 'Connection status', { size: 18, weight: 800, fill: C.g900 });
[['Verified your Global.Church sign-in', true], ['Loaded the member registry + grant', true], ['Read your vault (gs:needs / gs:offering)', true], ['Resolved your workspaces', false]].forEach((s, i) => {
  const y = 200 + i * 46; E.push(`<circle cx="100" cy="${y}" r="9" fill="${s[1] ? C.ok : C.white}" stroke="${s[1] ? C.ok : C.g300}" stroke-width="2"/>`);
  if (s[1]) txt(100, y + 4, '✓', { size: 11, fill: C.white, weight: 800, anchor: 'middle' });
  if (i < 3) line(100, y + 9, 100, y + 37, { stroke: C.g200, sw: 2 });
  txt(122, y + 5, s[0], { size: 13, fill: s[1] ? C.g700 : C.g400, weight: s[1] ? 600 : 400 });
});
rect(84, 410, 432, 220, { fill: C.g50 });
txt(104, 440, 'What Switchboard can access', { size: 13, weight: 800, fill: C.g700 });
[['gs:needs (your org vault)', 'read + write'], ['match status', 'read'], ['your contact', 'only on accept']].forEach((r, i) => {
  const y = 470 + i * 30; txt(104, y, r[0], { size: 12, fill: C.g600, mono: true }); pill(380, y - 13, r[1], { fill: C.primarySubtle, fg: C.primaryActive, border: C.primaryBorder });
});
txt(104, 600, 'Owner-keyed today; record-scope = spec 248.', { size: 11, fill: C.g400 });
// found workspaces
rect(560, 100, 500, 270, { fill: C.white }); eyebrow(584, 138, 'Found'); txt(584, 162, 'GCO Organization', { size: 16, weight: 800, fill: C.g900 }); pill(900, 146, 'ready', { fill: C.okSubtle, fg: C.ok, border: C.ok }); lines(584, 188, [300, 260]); btn(584, 230, 180, 'Open workspace', { primary: true });
rect(560, 390, 500, 270, { fill: C.white }); eyebrow(584, 428, 'Add a role'); txt(584, 452, 'KC Expert', { size: 16, weight: 800, fill: C.g900 }); pill(900, 436, 'not started', { fill: C.g100, fg: C.g500 }); lines(584, 478, [300, 260]); btn(584, 520, 180, 'Set up KC', { ghost: true });
save('demo-gs-role-discovery.svg');

// ── 4. Role hub ────────────────────────────────────────────────────────────────
frame('connected · role hub');
btn(W - 210, 12, 180, 'Maria ·  GCO ▾', { ghost: true });
txt(60, 110, 'Welcome back, Maria', { size: 24, weight: 800, fill: C.g900 });
txt(60, 136, 'Choose or resume a workspace. You’re connected as one person; roles are workspaces.', { size: 13, fill: C.g600 });
// gco card
rect(60, 170, 490, 360, { fill: C.white }); tag(84, 200, 'DEMAND'); txt(84, 250, 'GCO Organization', { size: 20, weight: 800, fill: C.g900 }); txt(84, 274, 'Hope Church Missions Team', { size: 13, fill: C.g600 });
['Create org + mint grant', 'Post a skill need', 'Review explainable matches'].forEach((t, i) => { txt(104, 312 + i * 30, '•  ' + t, { size: 13, fill: C.g700 }); });
pill(84, 420, 'ready', { fill: C.okSubtle, fg: C.ok, border: C.ok }); btn(84, 460, 200, 'Open GCO workspace', { primary: true });
// kc card
rect(570, 170, 490, 360, { fill: C.white }); tag(594, 200, 'SUPPLY'); txt(594, 250, 'KC Expert', { size: 20, weight: 800, fill: C.g900 }); txt(594, 274, 'Individual person agent', { size: 13, fill: C.g600 });
['Publish your expertise offering', 'Browse coarsened demand', 'Accept requests on your terms'].forEach((t, i) => { txt(614, 312 + i * 30, '•  ' + t, { size: 13, fill: C.g700 }); });
pill(594, 420, 'not started', { fill: C.g100, fg: C.g500 }); btn(594, 460, 200, 'Set up KC workspace', { ghost: true });
rect(60, 560, 1000, 70, { fill: C.g50 }); txt(84, 590, 'Open Global.Church home', { size: 12, fill: C.primary, weight: 700 }); txt(84, 610, 'Your data lives in your Global.Church home; Switchboard reads only what you grant.', { size: 11, fill: C.g500 });
save('demo-gs-role-hub.svg');

// ── 5. GCO workspace ────────────────────────────────────────────────────────────
frame('GCO workspace');
btn(W - 210, 12, 180, 'Maria ·  GCO ▾', { ghost: true });
rect(60, 78, 1000, 40, { fill: C.g50 }); txt(80, 103, 'GCO ORGANIZATION INTRANET', { size: 11, weight: 800, fill: C.g500 }); txt(300, 103, 'Hope Church Missions Team · signatory Maria', { size: 13, weight: 700, fill: C.g800 }); txt(W - 80, 103, 'sign out', { size: 11, fill: C.g500, anchor: 'end' });
// lifecycle rail
rect(60, 130, 1000, 56, { fill: C.white }); ['Org created', 'Need posted', 'Match reviewed', 'Requested', 'Agreement'].forEach((s, i) => { const x = 110 + i * 200; const done = i < 2; E.push(`<circle cx="${x}" cy="158" r="8" fill="${done ? C.primary : C.white}" stroke="${done ? C.primary : C.g300}" stroke-width="2"/>`); txt(x + 16, 162, s, { size: 11, fill: done ? C.g800 : C.g400, weight: done ? 700 : 400 }); if (i < 4) line(x + 90, 158, x + 200 - 8, 158, { stroke: C.g200, sw: 2 }); });
// primary task
rect(60, 202, 620, 300, { fill: C.white }); eyebrow(84, 234, 'Primary task'); txt(84, 258, 'Post a skill need', { size: 18, weight: 800, fill: C.g900 });
txt(84, 292, 'Required skills (canonical)', { size: 11, fill: C.g500, weight: 700 }); pill(84, 300, 'Grant Writing', { fill: C.primarySubtle, fg: C.primaryActive, border: C.primaryBorder }); pill(190, 300, '+ skill', { fill: C.white, fg: C.primary, border: C.primaryBorder });
txt(84, 350, 'Region', { size: 11, fill: C.g500, weight: 700 }); pill(84, 358, '📍 Sub-Saharan Africa', { fill: C.white, fg: C.g600 });
txt(84, 408, 'Cause · Languages · Commitment', { size: 11, fill: C.g500, weight: 700 }); lines(84, 422, [560, 480]);
btn(84, 452, 240, 'Post need to your org vault', { primary: true });
// right rail
rect(700, 202, 360, 300, { fill: C.g50 }); eyebrow(724, 234, 'What happens next'); ['Switchboard scores against KC offerings', 'You request a connection', 'KC accepts → contact released', 'Global Church issues the agreement'].forEach((t, i) => txt(724, 264 + i * 30, (i + 1) + '.  ' + t, { size: 12, fill: C.g600 }));
// posted needs + directory
rect(60, 520, 490, 200, { fill: C.white }); eyebrow(84, 552, 'Your posted needs · org vault'); ['open  Grant writing for a Sahel project', 'matched  Arabic translation'].forEach((t, i) => { txt(84, 584 + i * 30, t, { size: 12, fill: C.g700 }); });
rect(570, 520, 490, 200, { fill: C.white }); eyebrow(594, 552, 'Directory · coarsened supply'); txt(594, 576, 'Browse Kingdom Consultants', { size: 14, weight: 700, fill: C.g900 }); txt(594, 596, 'Skills shown · contact withheld until accept', { size: 11, fill: C.g500 }); pill(594, 612, 'Grant strategy', { fill: C.okSubtle, fg: C.ok, border: C.ok }); pill(710, 612, '📍 Sensitive region', { fill: C.accentSubtle, fg: C.accent, border: C.accentBorder });
save('demo-gs-gco-dashboard.svg');

// ── 6. KC workspace ──────────────────────────────────────────────────────────────
frame('KC workspace');
btn(W - 210, 12, 180, 'Dana ·  KC ▾', { ghost: true });
rect(60, 78, 1000, 40, { fill: C.g50 }); txt(80, 103, 'KC EXPERT INTRANET', { size: 11, weight: 800, fill: C.g500 }); txt(240, 103, 'Dana — Grant & Foundation Strategy', { size: 13, weight: 700, fill: C.g800 }); txt(W - 80, 103, 'sign out', { size: 11, fill: C.g500, anchor: 'end' });
// summary cards
['Offering published', 'Open requests · 2', 'Demand fit · high'].forEach((t, i) => { const x = 60 + i * 340; rect(x, 130, 320, 70, { fill: C.white }); txt(x + 20, 158, t, { size: 13, weight: 700, fill: C.g800 }); lines(x + 20, 178, [200]); });
// primary task
rect(60, 216, 620, 286, { fill: C.white }); eyebrow(84, 248, 'Primary task'); txt(84, 272, 'Publish your expertise offering', { size: 18, weight: 800, fill: C.g900 });
txt(84, 306, 'Offered skills (canonical → on-chain badge)', { size: 11, fill: C.g500, weight: 700 }); pill(84, 314, 'Grant Writing', { fill: C.primarySubtle, fg: C.primaryActive, border: C.primaryBorder }); pill(190, 314, 'Donor Comms', { fill: C.primarySubtle, fg: C.primaryActive, border: C.primaryBorder }); pill(300, 314, '⛓ verified', { fill: C.accentSubtle, fg: C.accent, border: C.accentBorder });
txt(84, 364, 'Regions · availability · evidence', { size: 11, fill: C.g500, weight: 700 }); lines(84, 378, [560, 480]); btn(84, 452, 220, 'Publish to your vault', { primary: true });
// request queue
rect(700, 216, 360, 286, { fill: C.g50 }); eyebrow(724, 248, 'Requests · accept on your terms'); rect(724, 264, 312, 100, { fill: C.white }); txt(740, 288, 'Sahel literacy — Grant Writing', { size: 12, weight: 700, fill: C.g800 }); txt(740, 308, 'Why: skill +50 · language +5 · avail +5', { size: 10.5, fill: C.g500 }); btn(740, 322, 120, 'Accept', { primary: true }); btn(870, 322, 90, 'Decline', { ghost: true });
// demand directory
rect(60, 520, 1000, 200, { fill: C.white }); eyebrow(84, 552, 'Directory · coarsened demand · where the demand is'); txt(84, 576, 'Open needs you could serve — confidential GCO detail coarsened, you never see raw demand', { size: 11, fill: C.g500 });
[['Grant Writing', '📍 Sensitive region', 'weekly'], ['Translation', '📍 Middle East (coarsened)', 'ongoing']].forEach((r, i) => { const y = 600 + i * 34; pill(84, y, r[0], { fill: C.okSubtle, fg: C.ok, border: C.ok }); pill(220, y, r[1], { fill: C.accentSubtle, fg: C.accent, border: C.accentBorder }); txt(440, y + 14, r[2], { size: 11, fill: C.g500 }); });
save('demo-gs-kc-dashboard.svg');

// ── 7. Header dropdown ───────────────────────────────────────────────────────────
frame('connected identity dropdown + demo shortcuts');
btn(W - 230, 12, 200, 'Maria ·  GCO ▾', { primary: true });
rect(W - 360, 56, 330, 420, { fill: C.white, stroke: C.g300 });
txt(W - 336, 90, 'Maria', { size: 15, weight: 800, fill: C.g900 }); txt(W - 336, 110, 'maria.impact-agent.me', { size: 11, fill: C.g500, mono: true }); pill(W - 336, 122, 'Working as GCO', { fill: C.primarySubtle, fg: C.primaryActive, border: C.primaryBorder });
line(W - 360, 160, W - 30, 160, { stroke: C.g100 });
['Open Global.Church home', 'Switch workspace: KC Expert', 'Disconnect'].forEach((t, i) => txt(W - 336, 190 + i * 34, t, { size: 13, fill: i === 2 ? C.warn : C.g700, weight: i === 2 ? 700 : 400 }));
line(W - 360, 300, W - 30, 300, { stroke: C.g100 });
txt(W - 336, 326, 'DEMO ADMIN SHORTCUTS', { size: 10, weight: 800, fill: C.g400 });
['🎛  Jane / Switchboard (broker)', '⛪  Pete / Global Church (issuer)'].forEach((t, i) => { rect(W - 344, 340 + i * 42, 300, 34, { fill: C.warnSubtle, stroke: C.warn, r: 8, sw: 1 }); txt(W - 332, 362 + i * 42, t, { size: 12, fill: C.g700 }); });
txt(W - 336, 462, 'Demo shortcuts — not production authorization.', { size: 10, fill: C.g400 });
save('demo-gs-header-dropdown.svg');

// ── 8. Match → agreement timeline ─────────────────────────────────────────────────
frame('match → agreement timeline');
txt(60, 110, 'Connection: Hope Church Missions Team  ↔  Dana (KC)', { size: 16, weight: 800, fill: C.g900 });
const lanes = ['GCO Org', 'Switchboard (broker)', 'KC Expert', 'Global Church (issuer)'];
lanes.forEach((l, i) => { const y = 150 + i * 130; rect(60, y, 160, 110, { fill: C.g50 }); txt(80, y + 30, l, { size: 13, weight: 800, fill: C.g700 }); line(240, y + 55, 1060, y + 55, { stroke: C.g100, sw: 1, dash: '4 6' }); });
const steps = [[0, 'Need posted'], [1, 'Scores via grants'], [1, 'Proposes match'], [0, 'Requests connection'], [2, 'Accepts → contact released'], [3, 'Issues agreement'], [3, 'ongoing → fulfilled']];
steps.forEach((s, i) => { const x = 290 + i * 108; const y = 150 + s[0] * 130 + 55; E.push(`<circle cx="${x}" cy="${y}" r="9" fill="${C.primary}"/>`); txt(x, y - 16, '' + (i + 1), { size: 11, fill: C.primary, weight: 800, anchor: 'middle' }); txt(x, y + 30, s[1], { size: 9.5, fill: C.g600, anchor: 'middle' }); });
rect(60, 690, 1000, 50, { fill: C.accentSubtle, stroke: C.accentBorder }); txt(84, 720, 'Who can see what:  members’ needs/offerings are private (owner vault) · broker sees both via grants · public sees only coarsened aggregates · person↔org links never published · public assertion is opt-in.', { size: 11, fill: C.accent });
save('demo-gs-deep-match-agreement.svg');

// ── 9. Broker board (Jane) ────────────────────────────────────────────────────────
frame('Jane / Switchboard — broker demo admin');
rect(60, 78, 1000, 36, { fill: C.warnSubtle, stroke: C.warn }); txt(80, 101, 'DEMO ADMIN — Jane / Global Switchboard (broker). Entitled via the grants members issued. Not production authorization.', { size: 11, fill: C.warn });
[['active needs', 7], ['active offerings', 5], ['agreements', 2]].forEach((s, i) => { const x = 60 + i * 200; rect(x, 126, 180, 56, { fill: C.white }); txt(x + 16, 150, s[1] + '', { size: 20, weight: 800, fill: C.primary }); txt(x + 50, 150, s[0], { size: 11, fill: C.g500 }); });
rect(60, 200, 490, 250, { fill: C.white }); eyebrow(84, 232, 'Pattern-A read bridge'); txt(84, 256, 'Import external Switchboard roles → needs', { size: 13, weight: 700, fill: C.g800 }); txt(84, 278, '4 roles · 6/7 skills mapped · 1 unmapped (surfaced)', { size: 11, fill: C.g500 }); btn(84, 296, 200, 'Import as needs', { primary: true });
rect(570, 200, 490, 250, { fill: C.white }); eyebrow(594, 232, 'Match board · explainable'); rect(594, 250, 440, 80, { fill: C.g50 }); txt(610, 274, '60  Dana — Grant writer', { size: 13, weight: 700, fill: C.g800 }); txt(610, 294, 'skill +50 · language +5 · available +5', { size: 11, fill: C.g500 }); txt(610, 312, '⚠ Sensitive region (coarsened)', { size: 11, fill: C.accent }); btn(610, 360, 160, 'Request connection', { ghost: true });
rect(60, 470, 1000, 250, { fill: C.white }); eyebrow(84, 502, 'Directory + public signal'); txt(84, 526, 'Full projection: demand + supply, agreements backbone, public skill-gap signal (also served at /api/directory + /api/signal).', { size: 12, fill: C.g600 }); lines(84, 556, [900, 820, 880]);
save('demo-gs-broker-board.svg');

// ── 10. Missing-grant / access-request state ───────────────────────────────────────
frame('missing-delegation · request-access state');
rect(310, 150, 500, 420, { fill: C.white, stroke: C.warn }); txt(560, 210, '🔒', { size: 40, anchor: 'middle' });
txt(560, 262, 'Switchboard can’t read this org’s needs yet', { size: 18, weight: 800, fill: C.g900, anchor: 'middle' });
txt(560, 292, 'The organization didn’t return a Switchboard access grant', { size: 12, fill: C.g600, anchor: 'middle' });
txt(560, 310, 'when it was created (no silent fallback — ADR-0013).', { size: 12, fill: C.g600, anchor: 'middle' });
rect(360, 340, 400, 90, { fill: C.warnSubtle, stroke: C.warn }); txt(380, 366, 'Owner: your GCO org · Needs: read gs:needs', { size: 12, fill: C.warn }); txt(380, 388, 'Grantee: Global Switchboard', { size: 12, fill: C.warn }); txt(380, 410, 'Revoke anytime from your Global.Church home', { size: 12, fill: C.warn });
btn(360, 450, 400, 'Re-create the organization to mint the grant', { primary: true });
txt(560, 520, 'Or continue with a limited view (no demand directory).', { size: 12, fill: C.primary, anchor: 'middle' });
save('demo-gs-access-request-state.svg');

console.log('demo-gs mockups generated.');
