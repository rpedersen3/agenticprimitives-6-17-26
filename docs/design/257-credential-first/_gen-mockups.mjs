// Spec 257 — credential-first connection: SVG screen-flow mockups (committed generator, not raster).
// Run: node docs/design/257-credential-first/_gen-mockups.mjs  → writes *.svg + index.html here.
// Mobile-first card frames (390×760). Vector "screenshots" you open in a browser / the IDE.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = dirname(fileURLToPath(import.meta.url));
const W = 390, H = 760;

// palette: Impact = teal (demo-jp), Global.Church = indigo (demo-gs), neutral slate.
const C = {
  bg: '#f1f5f9', card: '#ffffff', ink: '#0f172a', sub: '#475569', mute: '#94a3b8',
  line: '#e2e8f0', teal: '#0d9488', tealD: '#0f766e', tealSub: '#f0fdfa',
  indigo: '#4f46e5', amber: '#d97706', amberSub: '#fffbeb', amberBd: '#fde68a',
  ok: '#16a34a', okSub: '#f0fdf4', okBd: '#bbf7d0', white: '#ffffff',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const T = (x, y, s, { size = 14, fill = C.ink, weight = 400, anchor = 'start', op = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family="'Inter',-apple-system,Segoe UI,Roboto,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${op}">${esc(s)}</text>`;
const rect = (x, y, w, h, { r = 12, fill = C.card, stroke = 'none', sw = 1, op = 1 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"/>`;
// a tappable button
const btn = (x, y, w, label, { kind = 'primary', icon = '' } = {}) => {
  const h = 50;
  const fill = kind === 'primary' ? C.teal : kind === 'amber' ? C.amber : C.white;
  const stroke = kind === 'secondary' ? C.line : 'none';
  const txt = kind === 'secondary' ? C.ink : C.white;
  const ic = icon ? `<text x="${x + 18}" y="${y + h / 2 + 5}" font-size="16">${icon}</text>` : '';
  const lx = icon ? x + 42 : x + w / 2;
  const anchor = icon ? 'start' : 'middle';
  return rect(x, y, w, h, { r: 12, fill, stroke, sw: 1.5 }) + ic +
    `<text x="${lx}" y="${y + h / 2 + 5}" font-family="Inter,sans-serif" font-size="15" font-weight="700" fill="${txt}" text-anchor="${anchor}">${esc(label)}</text>`;
};
// a labelled facet/credential chip row
const chip = (x, y, label, tone = 'ok') => {
  const m = { ok: [C.okSub, C.okBd, C.ok], amber: [C.amberSub, C.amberBd, C.amber], mute: [C.line, C.line, C.sub] }[tone];
  const w = 9 + label.length * 7 + 22;
  return rect(x, y, w, 26, { r: 13, fill: m[0], stroke: m[1] }) +
    `<circle cx="${x + 14}" cy="${y + 13}" r="4" fill="${m[2]}"/>` +
    T(x + 24, y + 17, label, { size: 12, fill: m[2], weight: 700 });
};

function frame(title, badge, inner) {
  // device card + a top "brand bar"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  ${rect(16, 18, W - 32, H - 36, { r: 26, fill: C.card, stroke: C.line })}
  <clipPath id="cp"><rect x="16" y="18" width="${W - 32}" height="${H - 36}" rx="26"/></clipPath>
  <g clip-path="url(#cp)">
    ${rect(16, 18, W - 32, 54, { r: 0, fill: '#0b1324' })}
    <circle cx="44" cy="45" r="11" fill="${C.teal}"/>
    ${T(64, 50, 'Impact', { size: 15, fill: C.white, weight: 800 })}
    ${T(W - 36, 50, badge || '', { size: 11, fill: C.mute, weight: 600, anchor: 'end' })}
    ${inner}
  </g>
  <!-- caption -->
  ${T(W / 2, H - 6, title, { size: 12, fill: C.mute, weight: 700, anchor: 'middle' })}
</svg>`;
}

const screens = {};

// 01 — credential-first two-button entry (relying app: Global.Church or Impact-Adopt)
screens['01-entry'] = frame('01 · Front door — credential-first, no name', 'demo-gs / demo-jp', `
  ${T(40, 120, 'Your portable workspace', { size: 22, fill: C.ink, weight: 800 })}
  ${T(40, 146, 'Created once. Works everywhere.', { size: 14, fill: C.sub })}
  ${btn(40, 188, W - 80, 'Continue with Google', { icon: 'G' })}
  ${btn(40, 250, W - 80, 'Continue with a passkey', { kind: 'secondary', icon: '🔑' })}
  ${btn(40, 312, W - 80, 'Continue with a wallet', { kind: 'secondary', icon: '👛' })}
  ${rect(40, 392, W - 80, 96, { r: 14, fill: C.tealSub, stroke: C.line })}
  ${T(56, 420, 'Your Impact name is how others find', { size: 12.5, fill: C.tealD, weight: 600 })}
  ${T(56, 440, 'your agent — not something you need', { size: 12.5, fill: C.tealD, weight: 600 })}
  ${T(56, 460, 'to remember to get back in.', { size: 12.5, fill: C.tealD, weight: 600 })}
  ${T(56, 478, 'I know my Impact name →', { size: 12.5, fill: C.indigo, weight: 700 })}
`);

// 02 — "We found your Impact home" resolution (1 agent)
screens['02-home-found'] = frame('02 · Resolved from Google — no name typed', 'one home', `
  <circle cx="${W / 2}" cy="135" r="26" fill="${C.okSub}" stroke="${C.okBd}"/>
  ${T(W / 2, 143, '✓', { size: 26, fill: C.ok, weight: 800, anchor: 'middle' })}
  ${T(W / 2, 188, 'We found your Impact home', { size: 19, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${rect(40, 214, W - 80, 120, { r: 16, fill: C.white, stroke: C.line })}
  <circle cx="74" cy="248" r="18" fill="${C.teal}"/>
  ${T(74, 254, 'R', { size: 16, fill: C.white, weight: 800, anchor: 'middle' })}
  ${T(104, 244, 'rich-pedersen.impact', { size: 16, fill: C.ink, weight: 800 })}
  ${T(104, 264, 'your public agent handle', { size: 11.5, fill: C.mute })}
  ${T(56, 300, 'Connected:', { size: 12, fill: C.sub, weight: 700 })}
  ${chip(124, 288, 'Adopter', 'ok')}
  ${chip(210, 288, 'Hope Church (GCO)', 'ok')}
  ${btn(40, 360, W - 80, 'Continue', {})}
  ${T(W / 2, 432, 'Not you?  Use a different sign-in', { size: 12, fill: C.indigo, weight: 600, anchor: 'middle' })}
  ${rect(40, 470, W - 80, 22, { r: 6, fill: 'none' })}
  ${T(56, 486, '▸ Details (agent address)', { size: 11.5, fill: C.mute })}
`);

// 03 — account chooser (many homes for one identity)
screens['03-chooser'] = frame('03 · Account chooser (rotation / multiple homes)', 'many homes', `
  ${T(40, 120, 'Which home?', { size: 20, fill: C.ink, weight: 800 })}
  ${T(40, 144, 'Your Google sign-in matches more than one.', { size: 13, fill: C.sub })}
  ${[['rich-pedersen.impact', 'Adopter · created May 12', C.teal, 'R'],
     ['rich-personal.impact', 'created Apr 3', C.indigo, 'R']].map((h, i) => {
    const y = 176 + i * 92;
    return rect(40, y, W - 80, 76, { r: 14, fill: C.white, stroke: C.line }) +
      `<circle cx="74" cy="${y + 38}" r="16" fill="${h[2]}"/>` + T(74, y + 44, h[3], { size: 14, fill: C.white, weight: 800, anchor: 'middle' }) +
      T(102, y + 34, h[0], { size: 15, fill: C.ink, weight: 800 }) +
      T(102, y + 54, h[1], { size: 11.5, fill: C.mute }) +
      T(W - 56, y + 44, '→', { size: 18, fill: C.sub, anchor: 'end' });
  }).join('')}
  ${rect(40, 376, W - 80, 70, { r: 14, fill: C.amberSub, stroke: C.amberBd })}
  ${T(56, 402, 'Want one home?', { size: 12.5, fill: C.amber, weight: 800 })}
  ${T(56, 422, 'Add this sign-in to a home you already have', { size: 11.5, fill: C.amber, weight: 600 })}
  ${T(56, 438, 'instead — your address never changes.', { size: 11.5, fill: C.amber, weight: 600 })}
`);

// 04 — signup: pick a public name (the ONLY place a name is asked)
screens['04-signup-name'] = frame('04 · Signup — name = public handle (only place asked)', 'bootstrap', `
  ${T(40, 120, 'Pick your public name', { size: 20, fill: C.ink, weight: 800 })}
  ${T(40, 146, 'This is your agent’s public home — how', { size: 13, fill: C.sub })}
  ${T(40, 164, 'others find and link to you. Not a password.', { size: 13, fill: C.sub })}
  ${rect(40, 192, W - 80, 50, { r: 12, fill: C.white, stroke: C.teal, sw: 1.5 })}
  ${T(56, 223, 'rich-pedersen', { size: 16, fill: C.ink, weight: 700 })}
  ${T(W - 56, 223, '.impact', { size: 16, fill: C.mute, weight: 700, anchor: 'end' })}
  ${chip(40, 256, 'rich-pedersen.impact-agent.me', 'ok')}
  ${btn(40, 300, W - 80, 'Create my home', {})}
  ${rect(40, 372, W - 80, 96, { r: 14, fill: C.bg, stroke: C.line })}
  ${T(56, 400, 'What happens', { size: 12, fill: C.sub, weight: 800 })}
  ${T(56, 422, '• Your Smart Agent is created (sponsored)', { size: 11.5, fill: C.sub })}
  ${T(56, 440, '• Google controls it for now', { size: 11.5, fill: C.sub })}
  ${T(56, 458, '• No key gesture, no wallet needed', { size: 11.5, fill: C.sub })}
`);

// 05 — post-signup: soft "secure your home" + amber recovery-readiness
screens['05-secure-nudge'] = frame('05 · Soft nudge — secure + recovery readiness', 'home ready', `
  ${T(40, 116, 'You’re in, rich-pedersen 🎉', { size: 19, fill: C.ink, weight: 800 })}
  ${T(40, 140, 'Two quick ways to protect your home — later is fine.', { size: 12.5, fill: C.sub })}
  ${rect(40, 164, W - 80, 92, { r: 14, fill: C.tealSub, stroke: C.line })}
  ${T(56, 192, '🔑  Add this device as a passkey', { size: 13.5, fill: C.tealD, weight: 800 })}
  ${T(56, 214, 'Phishing-resistant, works across your', { size: 11.5, fill: C.sub })}
  ${T(56, 230, 'devices. Then only you control your home.', { size: 11.5, fill: C.sub })}
  ${T(W - 60, 244, 'Add  →', { size: 12.5, fill: C.tealD, weight: 800, anchor: 'end' })}
  ${rect(40, 272, W - 80, 96, { r: 14, fill: C.amberSub, stroke: C.amberBd })}
  ${T(56, 300, '⚠  Set up recovery', { size: 13.5, fill: C.amber, weight: 800 })}
  ${chip(190, 286, '0 trusted people', 'amber')}
  ${T(56, 326, 'If you lose your Google sign-in with no', { size: 11.5, fill: C.amber, weight: 600 })}
  ${T(56, 342, 'backup, you could be locked out of your home.', { size: 11.5, fill: C.amber, weight: 600 })}
  ${T(W - 60, 356, 'Set up  →', { size: 12.5, fill: C.amber, weight: 800, anchor: 'end' })}
  ${T(W / 2, 412, 'Maybe later', { size: 12.5, fill: C.mute, weight: 700, anchor: 'middle' })}
`);

// 06 — add a passkey (the quick migration / step-up)
screens['06-add-passkey'] = frame('06 · Add a passkey (the quick migration)', 'custody step-up', `
  ${T(40, 118, 'Secure your home with this device', { size: 18, fill: C.ink, weight: 800 })}
  ${T(40, 144, 'Use your fingerprint, face, or PIN. A passkey', { size: 12.5, fill: C.sub })}
  ${T(40, 162, 'is created on this device and added to your home.', { size: 12.5, fill: C.sub })}
  ${rect(40, 188, W - 80, 120, { r: 14, fill: C.bg, stroke: C.line })}
  ${T(56, 214, 'After this', { size: 12, fill: C.sub, weight: 800 })}
  ${T(56, 236, '✓ Your phone can sign you in + approve', { size: 11.5, fill: C.ink })}
  ${T(56, 256, '✓ Phishing-resistant, cross-device', { size: 11.5, fill: C.ink })}
  ${T(56, 276, '✓ Optional: remove Google as the controller', { size: 11.5, fill: C.ink })}
  ${T(56, 296, '   so only your devices control your home', { size: 11.5, fill: C.mute })}
  ${btn(40, 326, W - 80, 'Create your passkey', { icon: '🔑' })}
  ${rect(40, 398, W - 80, 26, { r: 8, fill: 'none' })}
  ${T(56, 416, 'The prompt will say impact-agent.me — that’s your home.', { size: 11, fill: C.mute })}
`);

// 07 — add trusted recovery people + threshold
screens['07-recovery-people'] = frame('07 · Add trusted recovery people (plain language)', 'recovery setup', `
  ${T(40, 116, 'Add trusted recovery people', { size: 18, fill: C.ink, weight: 800 })}
  ${T(40, 142, 'If you lose access, a required number of', { size: 12.5, fill: C.sub })}
  ${T(40, 160, 'trusted people can help restore control.', { size: 12.5, fill: C.sub })}
  ${T(40, 178, 'They can’t use your account or see your data.', { size: 12.5, fill: C.sub })}
  ${['Maria (sister)', 'Pastor John', 'Dev (friend)'].map((n, i) => {
    const y = 204 + i * 46;
    return rect(40, y, W - 80, 38, { r: 11, fill: C.white, stroke: C.line }) +
      `<circle cx="64" cy="${y + 19}" r="11" fill="${C.teal}"/>` + T(64, y + 24, n[0], { size: 12, fill: C.white, weight: 800, anchor: 'middle' }) +
      T(86, y + 24, n, { size: 13, fill: C.ink, weight: 600 }) + T(W - 58, y + 24, '✓', { size: 14, fill: C.ok, weight: 800, anchor: 'end' });
  }).join('')}
  ${rect(40, 350, W - 80, 56, { r: 12, fill: C.tealSub, stroke: C.line })}
  ${T(56, 374, 'How many are needed to help?', { size: 12, fill: C.sub, weight: 700 })}
  ${T(56, 396, 'Threshold:', { size: 12, fill: C.sub })}
  ${chip(124, 382, '2 of 3', 'ok')}
  ${btn(40, 420, W - 80, 'Confirm recovery', {})}
`);

// 08 — recovery readiness badge (protected state)
screens['08-readiness'] = frame('08 · Recovery-readiness badge (protected)', 'protected', `
  <circle cx="${W / 2}" cy="150" r="40" fill="${C.okSub}" stroke="${C.okBd}" stroke-width="2"/>
  ${T(W / 2, 162, '🛡', { size: 34, anchor: 'middle' })}
  ${T(W / 2, 218, 'Your home is protected', { size: 19, fill: C.ink, weight: 800, anchor: 'middle' })}
  ${chip(W / 2 - 60, 234, '2-of-3 recovery', 'ok')}
  ${rect(40, 280, W - 80, 120, { r: 14, fill: C.bg, stroke: C.line })}
  ${T(56, 308, 'If you lose your Google or passkey access,', { size: 12.5, fill: C.sub })}
  ${T(56, 328, 'two of your three trusted recovery contacts', { size: 12.5, fill: C.sub })}
  ${T(56, 348, 'can help you add a new sign-in method.', { size: 12.5, fill: C.sub })}
  ${T(56, 376, 'Your name, your agent, and everything you', { size: 11.5, fill: C.mute })}
  ${T(56, 392, 'connected stay exactly the same.', { size: 11.5, fill: C.mute })}
  ${T(W / 2, 440, 'Manage recovery', { size: 12.5, fill: C.indigo, weight: 700, anchor: 'middle' })}
`);

// 09 — "Can't access your account?" recovery entry
screens['09-cant-access'] = frame('09 · Can’t access your account? (recovery entry)', 'recover access', `
  ${T(40, 120, 'Can’t access your account?', { size: 18, fill: C.ink, weight: 800 })}
  ${T(40, 144, 'We’ll help you recover access to your home —', { size: 12.5, fill: C.sub })}
  ${T(40, 162, 'the same one, with everything intact.', { size: 12.5, fill: C.sub })}
  ${[['Use another sign-in you already added', 'passkey · wallet'],
     ['Ask your trusted recovery people', '2-of-3 quorum'],
     ['I know my Impact name or address', 'identify your home']].map((o, i) => {
    const y = 192 + i * 76;
    return rect(40, y, W - 80, 62, { r: 13, fill: C.white, stroke: C.line }) +
      T(58, y + 28, o[0], { size: 13.5, fill: C.ink, weight: 700 }) +
      T(58, y + 48, o[1], { size: 11.5, fill: C.mute }) + T(W - 56, y + 38, '→', { size: 18, fill: C.sub, anchor: 'end' });
  }).join('')}
  ${rect(40, 432, W - 80, 40, { r: 11, fill: C.tealSub, stroke: C.line })}
  ${T(56, 457, 'Recover access — never a new identity.', { size: 11.5, fill: C.tealD, weight: 700 })}
`);

// 10 — name-as-handle surface in the portal
screens['10-name-handle'] = frame('10 · The name lives in the portal as a public handle', 'profile', `
  ${T(40, 116, 'Your public agent', { size: 18, fill: C.ink, weight: 800 })}
  ${rect(40, 140, W - 80, 110, { r: 16, fill: C.white, stroke: C.line })}
  <circle cx="80" cy="184" r="24" fill="${C.teal}"/>
  ${T(80, 192, 'R', { size: 22, fill: C.white, weight: 800, anchor: 'middle' })}
  ${T(118, 178, 'rich-pedersen.impact', { size: 17, fill: C.ink, weight: 800 })}
  ${T(118, 200, 'rich-pedersen.impact-agent.me', { size: 11.5, fill: C.indigo, weight: 600 })}
  ${T(118, 226, 'A2A agent · vault · profile', { size: 11, fill: C.mute })}
  ${btn(40, 270, (W - 90) / 2, 'Share handle', { kind: 'secondary' })}
  ${btn(40 + (W - 90) / 2 + 10, 270, (W - 90) / 2, 'Copy URL', { kind: 'secondary' })}
  ${rect(40, 340, W - 80, 132, { r: 14, fill: C.bg, stroke: C.line })}
  ${T(56, 366, 'Sign-in methods', { size: 12, fill: C.sub, weight: 800 })}
  ${chip(56, 380, 'Google', 'ok')}${chip(140, 380, 'This device (passkey)', 'ok')}
  ${chip(56, 416, 'Recovery wallet', 'ok')}${chip(190, 416, '2-of-3 recovery', 'ok')}
  ${T(56, 458, 'Your name never changes — credentials can.', { size: 11, fill: C.mute })}
`);

for (const [name, svg] of Object.entries(screens)) writeFileSync(join(OUT, `${name}.svg`), svg);

// walkthrough index (clickable storyboard, in flow order)
const order = Object.keys(screens);
const cards = order.map((n) =>
  `<a class="c" href="${n}.svg"><img src="${n}.svg" alt="${n}"/><span>${n.replace(/^\d+-/, '').replace(/-/g, ' ')}</span></a>`).join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>Spec 257 — credential-first flow</title>
<style>
 body{font:14px/1.5 Inter,system-ui,sans-serif;margin:0;background:#0b1324;color:#e2e8f0;padding:28px}
 h1{font-size:20px;margin:0 0 4px} p{color:#94a3b8;margin:0 0 22px;max-width:760px}
 .grid{display:flex;flex-wrap:wrap;gap:20px}
 .c{display:block;text-decoration:none;color:#cbd5e1;width:260px}
 .c img{width:260px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:block}
 .c span{display:block;margin-top:8px;font-weight:700;text-transform:capitalize;font-size:12.5px}
 a{color:#818cf8}
</style>
<h1>Spec 257 — Credential-first connection: proposed flow</h1>
<p>Social is the front door · the name is a public handle · recovery rotates credentials without changing the Smart Agent. Click any screen to open the full SVG. Read the spec: <a href="../../../specs/257-credential-first-connection.md">specs/257-credential-first-connection.md</a>.</p>
<div class="grid">
${cards}
</div>`;
writeFileSync(join(OUT, 'index.html'), html);
console.log(`wrote ${order.length} SVG screens + index.html to ${OUT}`);
