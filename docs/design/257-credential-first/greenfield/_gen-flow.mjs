// Spec 257 — GREENFIELD credential-first connect flow (Privy-simple, relying→Impact segue).
// Numbered SVG screens (committed generator; vector "screenshots"). Run:
//   node docs/design/257-credential-first/greenfield/_gen-flow.mjs
// Centerpiece: the Connect ceremony is a POPUP overlaying the (dimmed) relying site — embedded feel,
// credential at the Connect origin. demo-gs = Global.Church (indigo); Impact Connect = teal.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const OUT = dirname(fileURLToPath(import.meta.url));
const W = 820, H = 600;
const C = {
  page: '#0b1324', ink: '#0f172a', sub: '#475569', mute: '#94a3b8', line: '#e2e8f0', white: '#fff',
  // Global.Church (relying) = indigo; Impact (Connect) = teal
  ind: '#4f46e5', indD: '#3730a3', indSub: '#eef2ff', indBar: '#1e1b4b',
  teal: '#0d9488', tealD: '#0f766e', tealSub: '#f0fdfa', tealBar: '#042f2e',
  ok: '#16a34a', okSub: '#f0fdf4', okBd: '#bbf7d0', amber: '#d97706', amberSub: '#fffbeb', amberBd: '#fde68a', bg: '#f1f5f9',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const F = `font-family="'Inter',-apple-system,'Segoe UI',Roboto,sans-serif"`;
const T = (x, y, s, { size = 14, fill = C.ink, weight = 400, anchor = 'start', op = 1 } = {}) =>
  `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${op}">${esc(s)}</text>`;
const R = (x, y, w, h, { r = 12, fill = C.white, stroke = 'none', sw = 1, op = 1 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"/>`;
const btn = (x, y, w, label, { fill = C.teal, txt = C.white, icon = '', stroke = 'none', busy = false } = {}) => {
  const h = 46;
  const ic = icon ? `<text x="${x + 20}" y="${y + h / 2 + 5}" font-size="15">${icon}</text>` : '';
  const sp = busy ? `<circle cx="${x + 24}" cy="${y + h / 2}" r="7" fill="none" stroke="${txt}" stroke-width="2" stroke-dasharray="30 14" opacity="0.9"/>` : '';
  const lx = icon || busy ? x + 44 : x + w / 2;
  const an = icon || busy ? 'start' : 'middle';
  return R(x, y, w, h, { r: 11, fill, stroke, sw: 1.5 }) + ic + sp +
    `<text x="${lx}" y="${y + h / 2 + 5}" ${F} font-size="14.5" font-weight="700" fill="${txt}" text-anchor="${an}">${esc(label)}</text>`;
};
const chip = (x, y, label, [bg, bd, fg]) => {
  const w = 12 + label.length * 6.6 + 16;
  return R(x, y, w, 24, { r: 12, fill: bg, stroke: bd }) + `<circle cx="${x + 13}" cy="${y + 12}" r="3.5" fill="${fg}"/>` + T(x + 22, y + 16, label, { size: 11.5, fill: fg, weight: 700 });
};
const OKc = [C.okSub, C.okBd, C.ok], AMc = [C.amberSub, C.amberBd, C.amber], INc = [C.indSub, '#c7d2fe', C.ind];

// ---- the Global.Church (relying) app surface ----
function gcSurface({ pill = '', toast = '', dim = false } = {}) {
  return R(0, 0, W, H, { r: 0, fill: C.bg }) +
    R(0, 0, W, 56, { r: 0, fill: C.indBar }) +
    `<circle cx="34" cy="28" r="11" fill="${C.ind}"/>` + T(54, 33, 'Global.Church', { size: 15, fill: C.white, weight: 800 }) +
    T(150, 33, '· Switchboard', { size: 12, fill: '#a5b4fc', weight: 600 }) +
    (pill ? R(W - 210, 14, 196, 28, { r: 14, fill: '#312e81' }) + `<circle cx="${W - 196}" cy="28" r="8" fill="${C.teal}"/>` + T(W - 182, 33, pill, { size: 12, fill: C.white, weight: 700 }) : T(W - 30, 33, 'Help', { size: 12.5, fill: '#a5b4fc', anchor: 'end' })) +
    (dim ? R(0, 56, W, H - 56, { r: 0, fill: '#0b1324', op: 0.55 }) : '') +
    (toast ? R(W - 320, H - 70, 300, 50, { r: 12, fill: C.white, stroke: C.okBd, sw: 1.5 }) + `<circle cx="${W - 296}" cy="${H - 45}" r="9" fill="${C.ok}"/>` + T(W - 301, H - 41, '✓', { size: 12, fill: C.white, weight: 800 }) + T(W - 278, H - 49, toast, { size: 12.5, fill: C.ink, weight: 700 }) + T(W - 278, H - 31, 'You can publish, browse, and connect.', { size: 11, fill: C.sub }) : '');
}
// ---- the Impact Connect popup (centered, 380×472), with the co-brand pill ----
function popup(inner, { h = 472 } = {}) {
  const pw = 380, px = (W - pw) / 2, py = (H - h) / 2;
  return `<g filter="url(#sh)">${R(px, py, pw, h, { r: 20, fill: C.white })}</g>` +
    R(px, py, pw, 64, { r: 0, fill: C.tealBar }) +
    `<rect x="${px}" y="${py}" width="${pw}" height="64" rx="20" fill="${C.tealBar}"/><rect x="${px}" y="${py + 32}" width="${pw}" height="32" fill="${C.tealBar}"/>` +
    `<circle cx="${px + 28}" cy="${py + 32}" r="9" fill="${C.teal}"/>` + T(px + 46, py + 37, 'Impact Connect', { size: 14.5, fill: C.white, weight: 800 }) +
    // co-brand pill — the load-bearing trust element
    R(px + pw - 168, py + 18, 152, 28, { r: 14, fill: '#3730a3' }) + `<circle cx="${px + pw - 154}" cy="${py + 32}" r="7" fill="${C.ind}"/>` + T(px + pw - 140, py + 37, 'From Global.Church', { size: 11, fill: C.white, weight: 700 }) +
    `<g transform="translate(${px},${py + 64})">${inner(pw)}</g>` +
    // little caret connecting popup to the page (intentional overlay)
    '';
}
const defs = `<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000" flood-opacity="0.45"/></filter></defs>`;
const svg = (cap, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 30}" viewBox="0 0 ${W} ${H + 30}">${defs}${body}${R(0, H, W, 30, { r: 0, fill: C.page })}${T(W / 2, H + 20, cap, { size: 12.5, fill: C.mute, weight: 700, anchor: 'middle' })}</svg>`;

const S = {};

// 01 — relying-site front door (Global.Church). ONE primary action.
S['01-relying-cta'] = svg('01 · Global.Church — one-tap connect (relying site)', gcSurface() + `
  ${T(W / 2, 150, 'Join the Global Switchboard', { size: 26, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${T(W / 2, 182, 'Offer your skills or post a need — with a portable identity you own.', { size: 14.5, fill: C.sub, anchor: 'middle' })}
  ${btn(W / 2 - 150, 232, 300, 'Connect to Global.Church', { fill: C.ind })}
  ${T(W / 2, 308, 'Powered by your Impact home · no password, no username to invent', { size: 12.5, fill: C.mute, anchor: 'middle' })}`);

// 02 — the SEGUE: button goes to a loading state; the popup is opening (no interstitial page).
S['02-segue-opening'] = svg('02 · The segue — button loads, secure popup opens (no page switch)', gcSurface({ dim: true }) + `
  ${btn(W / 2 - 150, 232, 300, 'Opening secure connect…', { fill: C.indD, busy: true })}
  ${R(W / 2 - 120, 300, 240, 30, { r: 8, fill: 'none' })}
  ${T(W / 2, 320, 'A focused Impact window is opening over this page →', { size: 12.5, fill: '#c7d2fe', anchor: 'middle' })}`);

// 03 — Impact Connect popup over the dimmed relying site: social-first, co-branded.
S['03-popup-choose'] = svg('03 · Impact Connect popup (over Global.Church) — Continue with Google', gcSurface({ dim: true }) + popup((pw) => `
  ${T(28, 50, 'Continue to your Impact home', { size: 17, fill: C.ink, weight: 800 })}
  ${T(28, 72, 'Global.Church will connect to the same', { size: 12, fill: C.sub })}
  ${T(28, 88, 'identity you use everywhere.', { size: 12, fill: C.sub })}
  ${btn(28, 110, pw - 56, 'Continue with Google', { fill: C.teal, icon: 'G' })}
  ${btn(28, 166, pw - 56, 'Continue with email', { fill: C.white, txt: C.ink, stroke: C.line, icon: '✉' })}
  ${R(28, 224, pw - 56, 1, { r: 0, fill: C.line })}
  ${btn(28, 238, pw - 56, 'Use a passkey', { fill: C.white, txt: C.ink, stroke: C.line, icon: '🔑' })}
  ${btn(28, 290, pw - 56, 'Use a wallet', { fill: C.white, txt: C.ink, stroke: C.line, icon: '👛' })}
  ${T(28, 372, 'No password. No username. You can add a', { size: 11, fill: C.mute })}
  ${T(28, 388, 'passkey or wallet later.', { size: 11, fill: C.mute })}`));

// 04 — Google account chooser (one tap if warm). OS-style.
S['04-google'] = svg('04 · Google account picker (one tap)', gcSurface({ dim: true }) + popup((pw) => `
  ${T(28, 52, 'Choose an account', { size: 16, fill: C.ink, weight: 700 })}
  ${T(28, 72, 'to continue to impact-agent.me', { size: 12, fill: C.mute })}
  ${[['Rich Pedersen', 'rich.pedersen@gmail.com', '#ea4335'], ['Add another account', '', '#9aa0a6']].map((a, i) => {
    const y = 96 + i * 60;
    return R(28, y, pw - 56, 50, { r: 10, fill: C.white, stroke: C.line }) +
      (a[2] === '#9aa0a6' ? `<circle cx="${52}" cy="${y + 25}" r="13" fill="none" stroke="#9aa0a6" stroke-width="1.5"/><text x="52" y="${y + 30}" ${F} font-size="16" fill="#9aa0a6" text-anchor="middle">+</text>` : `<circle cx="52" cy="${y + 25}" r="13" fill="${a[2]}"/><text x="52" y="${y + 30}" ${F} font-size="13" fill="#fff" font-weight="700" text-anchor="middle">R</text>`) +
      T(76, y + (a[1] ? 22 : 30), a[0], { size: 13.5, fill: C.ink, weight: 600 }) + (a[1] ? T(76, y + 40, a[1], { size: 11.5, fill: C.mute }) : '');
  }).join('')}
  ${T(28, 360, 'Signing in creates your Impact home if you', { size: 11, fill: C.mute })}
  ${T(28, 376, 'don’t have one — no extra steps.', { size: 11, fill: C.mute })}`, { h: 410 }));

// 05 — progress ceremony: 4 milestones, NO name asked.
S['05-ceremony'] = svg('05 · Building your home — 4 milestones, zero device gesture, no name', gcSurface({ dim: true }) + popup((pw) => `
  ${T(28, 52, 'Setting up your Impact home', { size: 16.5, fill: C.ink, weight: 800 })}
  ${[['Verified it’s you', true], ['Created your Smart Agent', true], ['Securing it on the network', false], ['Connecting Global.Church', false]].map((m, i) => {
    const y = 92 + i * 56;
    const done = m[1];
    return `<circle cx="44" cy="${y}" r="13" fill="${done ? C.ok : C.tealSub}" stroke="${done ? 'none' : C.teal}" stroke-width="1.5"/>` +
      (done ? T(44, y + 5, '✓', { size: 13, fill: C.white, weight: 800, anchor: 'middle' }) : `<circle cx="44" cy="${y}" r="5" fill="none" stroke="${C.teal}" stroke-width="2" stroke-dasharray="20 8"/>`) +
      T(68, y + 5, m[0], { size: 14, fill: done ? C.ink : C.sub, weight: done ? 700 : 600 }) +
      (i < 3 ? `<rect x="43" y="${y + 14}" width="2" height="28" fill="${C.line}"/>` : '');
  }).join('')}
  ${T(28, 372, 'No password to set. No key to back up yet.', { size: 11.5, fill: C.mute })}`));

// 06 — "You're in." reward, then the popup closes.
S['06-youre-in'] = svg('06 · “You’re in.” — reward, then the popup closes itself', gcSurface({ dim: true }) + popup((pw) => `
  <circle cx="${pw / 2}" cy="86" r="34" fill="${C.okSub}" stroke="${C.okBd}" stroke-width="2"/>
  ${T(pw / 2, 96, '✓', { size: 30, fill: C.ok, weight: 800, anchor: 'middle' })}
  ${T(pw / 2, 152, 'You’re in.', { size: 24, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${T(pw / 2, 178, 'Your Impact home is ready and', { size: 13, fill: C.sub, anchor: 'middle' })}
  ${T(pw / 2, 196, 'connected to Global.Church.', { size: 13, fill: C.sub, anchor: 'middle' })}
  ${chip(pw / 2 - 130, 222, 'Smart Agent created', OKc)}${chip(pw / 2 + 10, 222, 'Signed in with Google', OKc)}
  ${T(pw / 2, 300, 'Returning you to Global.Church…', { size: 12, fill: C.mute, anchor: 'middle' })}`, { h: 360 }));

// 07 — back in Global.Church, connected IN PLACE (no page load): identity pill + toast.
S['07-connected'] = svg('07 · Back in Global.Church — connected in-place (no page load)', gcSurface({ pill: 'rich-pedersen', toast: 'Connected · welcome' }) + `
  ${T(40, 130, 'Welcome, rich-pedersen', { size: 24, fill: C.ink, weight: 800 })}
  ${T(40, 156, 'Choose what you want to do — you can do both, switch anytime.', { size: 13.5, fill: C.sub })}
  ${[['Offer your expertise (KC)', 'Publish what you can help with', C.ind], ['Set up an organization (GCO)', 'Post needs your org has', C.indD]].map((r, i) => {
    const x = 40 + i * 370;
    return R(x, 186, 350, 120, { r: 16, fill: C.white, stroke: C.line }) +
      `<rect x="${x}" y="186" width="6" height="120" rx="3" fill="${r[2]}"/>` +
      T(x + 24, 224, r[0], { size: 16, fill: C.ink, weight: 800 }) + T(x + 24, 248, r[1], { size: 12.5, fill: C.sub }) +
      btn(x + 24, 268, 160, i === 0 ? 'Offer expertise' : 'Create org', { fill: r[2] });
  }).join('')}`);

// 08 — DEFERRED: claim your public handle (surfaced as desirable, AFTER you're in).
S['08-claim-handle'] = svg('08 · Later — claim your public handle (deferred, desirable)', gcSurface({ pill: 'your home' }) + `
  ${R(W / 2 - 250, 120, 500, 300, { r: 18, fill: C.white, stroke: C.line })}
  ${T(W / 2, 168, 'Claim your public name', { size: 22, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${T(W / 2, 196, 'A name others can find and link to — your agent’s public home.', { size: 13.5, fill: C.sub, anchor: 'middle' })}
  ${R(W / 2 - 180, 224, 360, 50, { r: 12, fill: C.bg, stroke: C.teal, sw: 1.5 })}
  ${T(W / 2 - 162, 255, 'rich-pedersen', { size: 16, fill: C.ink, weight: 700 })}
  ${T(W / 2 + 162, 255, '.impact', { size: 16, fill: C.mute, weight: 700, anchor: 'end' })}
  ${chip(W / 2 - 150, 288, 'rich-pedersen.impact-agent.me  ·  available', OKc)}
  ${btn(W / 2 - 110, 332, 220, 'Claim this name', { fill: C.teal })}
  ${T(W / 2, 404, 'Skip — you already have a private home; the name is optional.', { size: 12, fill: C.mute, anchor: 'middle' })}`);

// 09 — DEFERRED: secure + recovery nudges (well-timed, non-blocking).
S['09-secure-recovery'] = svg('09 · Later — add a passkey + set up recovery (soft, non-blocking)', gcSurface({ pill: 'rich-pedersen' }) + `
  ${R(40, 120, 360, 150, { r: 16, fill: C.tealSub, stroke: C.line })}
  ${T(64, 154, '🔑  Add this device', { size: 16, fill: C.tealD, weight: 800 })}
  ${T(64, 180, 'Sign in with your face or fingerprint, and be', { size: 12.5, fill: C.sub })}
  ${T(64, 198, 'the only one who controls your home.', { size: 12.5, fill: C.sub })}
  ${btn(64, 214, 150, 'Add a passkey', { fill: C.teal })}
  ${R(420, 120, 360, 150, { r: 16, fill: C.amberSub, stroke: C.amberBd })}
  ${T(444, 154, '⚠  Set up recovery', { size: 16, fill: C.amber, weight: 800 })}
  ${chip(610, 138, '0 trusted people', AMc)}
  ${T(444, 180, 'If you lose your Google sign-in with no', { size: 12.5, fill: C.amber, weight: 600 })}
  ${T(444, 198, 'backup, you could be locked out.', { size: 12.5, fill: C.amber, weight: 600 })}
  ${btn(444, 214, 170, 'Add trusted people', { fill: C.amber })}
  ${T(W / 2, 320, 'Both are optional and take ~1 minute — your first session isn’t blocked.', { size: 12.5, fill: C.mute, anchor: 'middle' })}`);

// 10 — RETURN login: Continue with Google → "Welcome back" → connected (fast path).
S['10-return'] = svg('10 · Return visit — Continue with Google → “Welcome back” (1 tap)', gcSurface({ dim: true }) + popup((pw) => `
  <circle cx="${pw / 2}" cy="78" r="26" fill="${C.teal}"/>
  ${T(pw / 2, 86, 'R', { size: 22, fill: C.white, weight: 800, anchor: 'middle' })}
  ${T(pw / 2, 134, 'Welcome back', { size: 21, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${T(pw / 2, 160, 'rich-pedersen.impact', { size: 15, fill: C.tealD, weight: 700, anchor: 'middle' })}
  ${chip(pw / 2 - 120, 184, 'Adopter', OKc)}${chip(pw / 2 - 40, 184, 'Hope Church (GCO)', OKc)}
  ${btn(28, 224, pw - 56, 'Continue to Global.Church', { fill: C.teal })}
  ${T(pw / 2, 296, 'Not you?  Use a different sign-in', { size: 11.5, fill: C.ind, weight: 600, anchor: 'middle' })}`, { h: 360 }));

// 11 — popup-blocked graceful fallback (full-page redirect, still co-branded).
S['11-popup-blocked'] = svg('11 · Fallback — popups blocked → graceful co-branded redirect', gcSurface() + `
  ${R(W / 2 - 250, 150, 500, 230, { r: 18, fill: C.white, stroke: C.line })}
  ${chip(W / 2 - 90, 178, 'Global.Church  →  Impact', INc)}
  ${T(W / 2, 232, 'One tap to your secure home', { size: 20, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${T(W / 2, 258, 'Your browser blocked the popup, so we’ll take you', { size: 13, fill: C.sub, anchor: 'middle' })}
  ${T(W / 2, 276, 'to impact-agent.me and bring you right back.', { size: 13, fill: C.sub, anchor: 'middle' })}
  ${btn(W / 2 - 130, 304, 260, 'Continue to Impact', { fill: C.teal })}
  ${T(W / 2, 360, 'The page will say impact-agent.me — that’s your home.', { size: 11.5, fill: C.mute, anchor: 'middle' })}`);

for (const [n, s] of Object.entries(S)) writeFileSync(join(OUT, `${n}.svg`), s);
const order = Object.keys(S);
const cards = order.map((n) => `<a class="c" href="${n}.svg"><img src="${n}.svg" alt="${n}"/><span>${n}</span></a>`).join('\n');
writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>257 greenfield connect flow</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;margin:0;background:#0b1324;color:#e2e8f0;padding:28px}
h1{font-size:21px;margin:0 0 4px}p{color:#94a3b8;max-width:840px;margin:0 0 22px}a{color:#818cf8}
.grid{display:flex;flex-direction:column;gap:26px}.c{display:block;text-decoration:none;color:#cbd5e1}
.c img{width:100%;max-width:820px;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.4);display:block}
.c span{display:block;margin-top:8px;font-weight:700;font-size:13px}</style>
<h1>Spec 257 — Greenfield connect flow (Privy-simple, relying→Impact segue)</h1>
<p>First-time = 3 taps to “you’re in,” no username invented. The Connect ceremony is a <b>popup over the dimmed relying site</b> (embedded feel, credential at the Connect origin). Indigo = Global.Church (relying); teal = Impact Connect (popup). Screens 01→07 = first-time; 08–09 = deferred handle/security; 10 = return; 11 = popup-blocked fallback. Spec: <a href="../../../../specs/257-credential-first-connection.md">specs/257</a>.</p>
<div class="grid">${cards}</div>`);
console.log(`wrote ${order.length} numbered SVG screens + index.html to ${OUT}`);
