// Spec 258 — demo-gs connect UX redesign.
// Numbered SVG mockups for the credential-first connect flow on the Global Switchboard landing.
// Design brief: make the relying site feel like a normal product sign-in, not a protocol handoff.
// Primary CTA = "Continue with Global.Church" (no name field visible by default).
// Secondary = "Use my Impact name instead" (expands a name/handle panel below the CTA).
// The HandoffBridge 'new-user' variant is REMOVED from the connect path — the CTA fires the popup
// directly with a loading/dim state instead. Bridge variants 'org-create' and 'reconnect' are kept.
//
// Run:
//   node docs/design/258-demo-gs-connect-ux/_gen.mjs
//
// IMPORTANT: the F helper MUST quote the entire font-family value as a single XML attribute string
// (e.g., font-family="'Inter',sans-serif"). Never embed unquoted commas in attribute text — the SVG
// will fail to parse as XML. All text run through esc() before being emitted.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Validate each SVG as well-formed XML before writing.
// Node has no built-in XML parser; we do a lightweight structural check.
function validateSvg(svgStr, name) {
  // Check it opens and closes the root element.
  if (!svgStr.trim().startsWith('<svg')) throw new Error(`${name}: does not start with <svg`);
  if (!svgStr.includes('</svg>')) throw new Error(`${name}: missing </svg>`);
  // Check that no unescaped & appears outside entity refs (&amp; &lt; &gt; &quot; &#NNN;)
  const stripped = svgStr.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
  if (stripped.includes('&')) throw new Error(`${name}: unescaped & — run all text through esc()`);
  // Check font-family attributes are properly quoted (no bare comma in attribute value mid-token)
  // A bare comma in an SVG attribute value is legal XML but can break CSS parsing in renderers;
  // we ensure font-family is always a full quoted string.
  // This is a heuristic, not a full XML parse.
}

const OUT = dirname(fileURLToPath(import.meta.url));
const W = 820, H = 600;

// Palette — light corporate. Global.Church (relying) = indigo. Impact Connect (popup) = teal.
// Backgrounds stay light; popup overlay uses a subtle dark dim. No dark surfaces for the relying site.
const C = {
  // Page chrome
  bg: '#f8fafc',          // site background (very light gray-blue, not white)
  white: '#ffffff',
  ink: '#0f172a',         // primary text
  sub: '#475569',         // secondary text
  mute: '#94a3b8',        // muted/meta text
  line: '#e2e8f0',        // border / divider
  g50: '#f8fafc',
  g100: '#f1f5f9',
  g200: '#e2e8f0',
  g500: '#64748b',
  g700: '#374151',

  // Global.Church (relying) — indigo
  ind: '#4f46e5',
  indD: '#3730a3',
  indL: '#6366f1',
  indSub: '#eef2ff',
  indBd: '#c7d2fe',
  indBar: '#1e1b4b',      // header bar background
  indActive: '#4338ca',

  // Impact Connect (popup) — teal
  teal: '#0d9488',
  tealD: '#0f766e',
  tealSub: '#f0fdfa',
  tealBd: '#99f6e4',
  tealBar: '#042f2e',

  // Semantic
  ok: '#16a34a',
  okSub: '#f0fdf4',
  okBd: '#bbf7d0',
  warn: '#d97706',
  warnSub: '#fffbeb',
  warnBd: '#fde68a',
  err: '#b91c1c',
  errSub: '#fef2f2',
  errBd: '#fecaca',

  // Caption bar below each SVG
  capBar: '#0b1324',
};

// Escape for XML text content and attribute values.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// IMPORTANT: F must be a single quoted attribute so the whole value is one XML token.
// font-family="'Inter',-apple-system,'Segoe UI',Roboto,sans-serif"
// No unquoted commas in the attribute string — the value is already a proper quoted attribute.
const F = `font-family="'Inter',-apple-system,'Segoe UI',Roboto,sans-serif"`;
const FM = `font-family="'SF Mono','Roboto Mono',ui-monospace,monospace"`;

// Text primitive. fill is always a colour string (no unescaped special chars).
const T = (x, y, s, { size = 14, fill = C.ink, weight = 400, anchor = 'start', op = 1, italic = false } = {}) =>
  `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${op}"${italic ? ' font-style="italic"' : ''}>${esc(s)}</text>`;

const TM = (x, y, s, { size = 12, fill = C.ind, weight = 600, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" ${FM} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

// Rectangle primitive.
const R = (x, y, w, h, { r = 12, fill = C.white, stroke = 'none', sw = 1, op = 1 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}"/>`;

// Circle primitive.
const Circle = (cx, cy, r, { fill = C.ind, stroke = 'none', sw = 1 } = {}) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

// Button primitive. fill/txt are hex strings; label is escaped internally.
const btn = (x, y, w, label, { fill = C.ind, txt = C.white, icon = '', stroke = 'none', busy = false, ghost = false, sm = false } = {}) => {
  const h = sm ? 38 : 46;
  const fSize = sm ? 13 : 14.5;
  const ic = icon ? `<text x="${x + 18}" y="${y + h / 2 + 5}" font-size="15">${icon}</text>` : '';
  const sp = busy
    ? `<circle cx="${x + 26}" cy="${y + h / 2}" r="7" fill="none" stroke="${txt}" stroke-width="2" stroke-dasharray="28 14" opacity="0.9"/>`
    : '';
  const lx = icon || busy ? x + 46 : x + w / 2;
  const an = icon || busy ? 'start' : 'middle';
  const strokeAttr = ghost ? `stroke="${stroke || C.indBd}" stroke-width="1.5"` : (stroke !== 'none' ? `stroke="${stroke}" stroke-width="1.5"` : '');
  return R(x, y, w, h, { r: 11, fill, stroke: ghost ? (stroke || C.indBd) : stroke, sw: 1.5 }) + ic + sp +
    `<text x="${lx}" y="${y + h / 2 + 5}" ${F} font-size="${fSize}" font-weight="700" fill="${esc(txt)}" text-anchor="${an}">${esc(label)}</text>`;
};

// Pill / badge chip.
const pill = (x, y, label, { bg = C.indSub, bd = C.indBd, fg = C.ind } = {}) => {
  const tw = label.length * 6.8;
  const w = tw + 28;
  return R(x, y, w, 22, { r: 11, fill: bg, stroke: bd, sw: 1 }) +
    T(x + 14, y + 15, label, { size: 11, fill: fg, weight: 700 });
};

// Input field placeholder.
const inputField = (x, y, w, placeholder, { value = '', mono = false, active = false } = {}) => {
  const bd = active ? C.ind : C.line;
  const sw = active ? 2 : 1.5;
  return R(x, y, w, 44, { r: 9, fill: C.white, stroke: bd, sw }) +
    (value
      ? (mono
          ? TM(x + 12, y + 27, value, { size: 14, fill: C.ink })
          : T(x + 12, y + 27, value, { size: 14, fill: C.ink }))
      : T(x + 12, y + 27, placeholder, { size: 14, fill: C.mute, italic: true }));
};

// Spinner ring (busy state indicator).
const spinner = (cx, cy, r = 9) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.indBd}" stroke-width="2.5" stroke-dasharray="40 18" opacity="0.9"/>`;

// Divider line.
const divider = (x, y, w) =>
  R(x, y, w, 1, { r: 0, fill: C.line });

// The Global.Church relying-site chrome (header + page bg).
// pill = connected identity pill text (e.g. 'rich-pedersen')
// dim = is the page dimmed (popup open)?
// toast = success toast message
function siteChrome({ pill: pillText = '', dim = false, toast = '' } = {}) {
  const headerH = 56;
  const header =
    R(0, 0, W, headerH, { r: 0, fill: C.indBar }) +
    Circle(32, 28, 11, { fill: C.ind }) +
    T(50, 33, 'Global Switchboard', { size: 15, fill: C.white, weight: 800 }) +
    T(196, 33, '· by Global.Church', { size: 11.5, fill: '#a5b4fc', weight: 500 }) +
    (pillText
      // Connected pill: indigo pill in header right with teal dot
      ? R(W - 218, 14, 204, 28, { r: 14, fill: '#312e81' }) +
        Circle(W - 200, 28, 7, { fill: C.teal }) +
        T(W - 186, 33, pillText, { size: 12, fill: C.white, weight: 700 })
      // Signed-out: "Connect" link
      : btn(W - 148, 13, 128, 'Connect', { fill: C.ind, sm: true })
    );

  const pageBg = R(0, headerH, W, H - headerH, { r: 0, fill: C.bg });
  const dimOverlay = dim
    ? R(0, headerH, W, H - headerH, { r: 0, fill: '#0b1324', op: 0.52 })
    : '';

  const toastEl = toast
    ? R(W - 330, H - 68, 310, 48, { r: 12, fill: C.white, stroke: C.okBd, sw: 1.5 }) +
      Circle(W - 308, H - 44, 9, { fill: C.ok }) +
      T(W - 316, H - 40, '✓', { size: 11, fill: C.white, weight: 800 }) +
      T(W - 291, H - 49, toast, { size: 12.5, fill: C.ink, weight: 700 }) +
      T(W - 291, H - 32, 'You can publish, browse, and connect.', { size: 11, fill: C.sub })
    : '';

  return pageBg + header + dimOverlay + toastEl;
}

// The Impact Connect popup (centered over the dimmed site).
// inner(pw) → SVG string of popup body content.
function connectPopup(inner, { h = 460 } = {}) {
  const pw = 372, px = (W - pw) / 2, py = Math.max(20, (H - h) / 2);
  const headerH = 60;
  return `<g filter="url(#sh)">` +
    R(px, py, pw, h, { r: 20, fill: C.white }) +
    `</g>` +
    // Teal header bar
    `<rect x="${px}" y="${py}" width="${pw}" height="${headerH}" rx="20" fill="${C.tealBar}"/>` +
    `<rect x="${px}" y="${py + headerH / 2}" width="${pw}" height="${headerH / 2}" fill="${C.tealBar}"/>` +
    Circle(px + 26, py + 30, 9, { fill: C.teal }) +
    T(px + 44, py + 35, 'Impact Connect', { size: 14, fill: C.white, weight: 800 }) +
    // Co-brand pill — the load-bearing trust element
    R(px + pw - 166, py + 16, 152, 28, { r: 14, fill: '#312e81' }) +
    Circle(px + pw - 152, py + 30, 7, { fill: C.ind }) +
    T(px + pw - 138, py + 35, 'From Global.Church', { size: 10.5, fill: C.white, weight: 700 }) +
    // Popup body (translated below the header)
    `<g transform="translate(${px},${py + headerH})">${inner(pw)}</g>`;
}

// Shared SVG wrapper with drop-shadow defs and caption bar.
const defs = `<defs>
  <filter id="sh" x="-25%" y="-25%" width="150%" height="150%">
    <feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000000" flood-opacity="0.42"/>
  </filter>
</defs>`;

const svg = (caption, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 30}" viewBox="0 0 ${W} ${H + 30}">${defs}${body}${R(0, H, W, 30, { r: 0, fill: C.capBar })}${T(W / 2, H + 20, caption, { size: 12.5, fill: C.mute, weight: 700, anchor: 'middle' })}</svg>`;

// ─── Screens ───────────────────────────────────────────────────────────────────

const S = {};

// ── 01 LANDING HOME ────────────────────────────────────────────────────────────
// The signed-out landing. Hero has the SINGLE primary CTA "Continue with Global.Church" in the header
// AND in the hero section. The Landing component's informational GCO/KC cards are present below.
S['01-landing-home'] = svg('01 · Signed-out landing — single primary CTA in hero + header',
  siteChrome() +
  // Hero section
  T(48, 108, 'Find the expertise your mission needs —', { size: 24, fill: C.ink, weight: 800 }) +
  T(48, 138, 'or offer yours.', { size: 24, fill: C.ind, weight: 800 }) +
  T(48, 168, 'Global.Church holds your identity and data. Switchboard brokers', { size: 13.5, fill: C.sub }) +
  T(48, 186, 'explainable matches. You grant scoped access at sign-in and revoke it any time.', { size: 13.5, fill: C.sub }) +
  btn(48, 210, 280, 'Continue with Global.Church', { fill: C.ind }) +
  T(48, 277, 'Connect once, then choose what to do — offer expertise or post needs.', { size: 12, fill: C.mute }) +

  // Informational GCO / KC cards
  R(48, 300, 340, 130, { r: 14, fill: C.white, stroke: C.line }) +
  pill(68, 318, 'DEMAND · GCO', { bg: C.indSub, bd: C.indBd, fg: C.ind }) +
  T(68, 360, 'You have a ministry gap. Declare what skill', { size: 12.5, fill: C.g700 }) +
  T(68, 378, 'or capability you need — Switchboard matches', { size: 12.5, fill: C.g700 }) +
  T(68, 396, 'you with a Kingdom Consultant.', { size: 12.5, fill: C.g700 }) +
  T(68, 416, 'Connect to post a need →', { size: 12, fill: C.ind, weight: 700 }) +

  R(412, 300, 340, 130, { r: 14, fill: C.white, stroke: C.line }) +
  pill(432, 318, 'SUPPLY · KC', { bg: C.indSub, bd: C.indBd, fg: C.ind }) +
  T(432, 360, 'You have a skill to offer. Publish your expertise', { size: 12.5, fill: C.g700 }) +
  T(432, 378, 'profile and Switchboard matches you with', { size: 12.5, fill: C.g700 }) +
  T(432, 396, 'organizations that need exactly what you serve.', { size: 12.5, fill: C.g700 }) +
  T(432, 416, 'Connect to offer a skill →', { size: 12, fill: C.ind, weight: 700 }) +

  // Skill-gap signal bar (simplified)
  R(48, 450, 724, 100, { r: 14, fill: C.white, stroke: C.line }) +
  T(68, 476, 'PUBLIC SKILL-GAP SIGNAL', { size: 10, fill: C.g500, weight: 800 }) +
  T(68, 496, 'Open skill gaps right now', { size: 14.5, fill: C.ink, weight: 700 }) +
  T(68, 514, '6 open needs in the public demand feed. Counts only — never a specific match.', { size: 12, fill: C.mute }) +
  // Mini bar chart hint
  R(480, 468, 260, 12, { r: 6, fill: C.g100 }) + R(480, 468, 210, 12, { r: 6, fill: C.indL }) +
  R(480, 486, 260, 12, { r: 6, fill: C.g100 }) + R(480, 486, 160, 12, { r: 6, fill: C.indL }) +
  R(480, 504, 260, 12, { r: 6, fill: C.g100 }) + R(480, 504, 130, 12, { r: 6, fill: C.indL }) +
  ''
);

// ── 02 CONNECT CARD ────────────────────────────────────────────────────────────
// The redesigned ConnectScreen — credential-first: primary CTA visible immediately, name field hidden
// behind "Use my Impact name instead" secondary link. Trust copy in-card. No HandoffBridge shown.
S['02-connect-card'] = svg('02 · Connect card — credential-first, name secondary, trust in-card',
  siteChrome() +
  // Card (centred)
  R(160, 68, 500, 430, { r: 16, fill: C.white, stroke: C.line }) +
  T(200, 98, 'CONNECT', { size: 10, fill: C.ind, weight: 800 }) +
  T(200, 122, 'Connect with Global.Church', { size: 21, fill: C.ink, weight: 800 }) +
  // Body copy
  T(200, 152, 'Use your Global.Church identity to enter Switchboard.', { size: 13.5, fill: C.sub }) +
  T(200, 170, 'You can offer your expertise or set up an organization', { size: 13.5, fill: C.sub }) +
  T(200, 188, 'after you connect.', { size: 13.5, fill: C.sub }) +

  // Trust badge
  R(200, 200, 420, 44, { r: 10, fill: C.indSub, stroke: C.indBd }) +
  T(220, 221, 'Switchboard receives only what you approve', { size: 12, fill: C.ind, weight: 600 }) +
  T(220, 237, '· your contact stays private until you accept a connection', { size: 11, fill: C.ind }) +

  // Primary CTA
  btn(200, 260, 420, 'Continue with Global.Church', { fill: C.ind }) +

  // Secondary link — name path
  T(200 + 210, 326, 'Use my Impact name instead', { size: 12.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
  // Underline hint (a text link appearance)
  R(285, 329, 190, 1, { r: 0, fill: C.indBd }) +

  // Helper text
  T(200, 356, 'Your Impact name is a public handle people can use to find your agent.', { size: 12, fill: C.mute }) +
  T(200, 373, 'You do not need it to sign back in.', { size: 12, fill: C.mute }) +

  // "← Back" link
  T(200, 400, '← Back to Switchboard', { size: 12, fill: C.ind, weight: 600 }) +

  // Divider + "or" for visual clarity (between CTA zone and bottom)
  divider(200, 384, 420) +
  ''
);

// ── 03 POPUP-OPENING BUSY STATE ────────────────────────────────────────────────
// After clicking "Continue with Global.Church" — the button enters a loading state, the site dims,
// and the popup is opening. No separate bridge/interstitial page; trust reassurance is in-page text.
S['03-popup-opening'] = svg('03 · Popup opening — button busy, site dimmed, reassurance copy',
  siteChrome({ dim: true }) +
  // Card still visible behind dim (reduced opacity)
  R(160, 68, 500, 430, { r: 16, fill: C.white, stroke: C.line, op: 0.92 }) +
  T(200, 98, 'CONNECT', { size: 10, fill: C.ind, weight: 800, op: 0.6 }) +
  T(200, 122, 'Connect with Global.Church', { size: 21, fill: C.ink, weight: 800, op: 0.6 }) +
  T(200, 152, 'Use your Global.Church identity to enter Switchboard.', { size: 13.5, fill: C.sub, op: 0.6 }) +
  T(200, 170, 'You can offer your expertise or set up an organization', { size: 13.5, fill: C.sub, op: 0.6 }) +
  T(200, 188, 'after you connect.', { size: 13.5, fill: C.sub, op: 0.6 }) +
  R(200, 200, 420, 44, { r: 10, fill: C.indSub, stroke: C.indBd, op: 0.5 }) +

  // Busy button — indigo with spinner, label changed
  R(200, 260, 420, 46, { r: 11, fill: C.indD }) +
  spinner(228, 283) +
  T(248, 287, 'Opening your Impact home…', { size: 14.5, fill: C.white, weight: 700 }) +

  // Reassurance text below the button
  T(200 + 210, 330, 'A secure Global.Church window is opening', { size: 12.5, fill: '#c7d2fe', anchor: 'middle' }) +
  T(200 + 210, 348, 'over this page — confirm in that window to continue.', { size: 12.5, fill: '#c7d2fe', anchor: 'middle' }) +

  // Progress text (second state — "Waiting for confirmation...")
  T(200 + 210, 370, 'Waiting for confirmation…', { size: 12, fill: '#a5b4fc', anchor: 'middle' }) +
  ''
);

// ── 04 NAME/HANDLE PANEL (expanded) ───────────────────────────────────────────
// When the user clicks "Use my Impact name instead" — the name panel expands BELOW the CTA, showing
// the name input + .impact / .impact-agent.me preview. The primary CTA label updates to reflect the
// name will be used. This is the secondary (passkey/wallet) path entry.
S['04-name-handle-panel'] = svg('04 · Name/handle panel — expanded secondary path',
  siteChrome() +
  // Taller card to accommodate the name panel
  R(160, 56, 500, 490, { r: 16, fill: C.white, stroke: C.line }) +
  T(200, 84, 'CONNECT', { size: 10, fill: C.ind, weight: 800 }) +
  T(200, 108, 'Connect with Global.Church', { size: 21, fill: C.ink, weight: 800 }) +
  T(200, 136, 'Use your Global.Church identity to enter Switchboard.', { size: 13.5, fill: C.sub }) +
  T(200, 154, 'You can offer your expertise or set up an organization after you connect.', { size: 12.5, fill: C.sub }) +

  // Trust badge
  R(200, 168, 420, 44, { r: 10, fill: C.indSub, stroke: C.indBd }) +
  T(220, 189, 'Switchboard receives only what you approve', { size: 12, fill: C.ind, weight: 600 }) +
  T(220, 205, '· your contact stays private until you accept a connection', { size: 11, fill: C.ind }) +

  // Primary CTA (label updated — now "Continue with Global.Church" still, as name is just a hint)
  btn(200, 228, 420, 'Continue with Global.Church', { fill: C.ind }) +

  // Divider + secondary disclosure panel
  divider(200, 290, 420) +
  T(200, 308, 'YOUR IMPACT NAME', { size: 10, fill: C.g500, weight: 800 }) +
  T(200, 323, 'Your public handle — people can find your agent by this name.', { size: 12, fill: C.sub }) +

  // Name input (active state)
  inputField(200, 332, 420, 'e.g. rich-pedersen', { active: true }) +

  // .impact + .impact-agent.me preview (shown when a name is typed)
  R(200, 384, 420, 48, { r: 10, fill: C.g50, stroke: C.line }) +
  TM(216, 402, 'rich-pedersen', { size: 13, fill: C.ind }) +
  T(216 + 13 * 7.2, 402, '.impact', { size: 13, fill: C.mute, weight: 600 }) +
  T(216, 420, 'Home at rich-pedersen.impact-agent.me', { size: 11, fill: C.mute }) +
  pill(200 + 420 - 114, 390, 'available', { bg: C.okSub, bd: C.okBd, fg: C.ok }) +

  // Helper text below panel
  T(200, 444, 'You do not need a name to sign back in — it is a public handle, not a password.', { size: 11.5, fill: C.mute }) +

  // "Hide" / collapse link
  T(200 + 210, 468, 'Hide — use Google or passkey without a name', { size: 11.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
  ''
);

// ── 05 SUCCESS → ROLE HUB ─────────────────────────────────────────────────────
// Popup closed; connect finished in place (no reload). Identity pill appears in header. Toast fires.
// The RoleHub is shown: two cards (KC / GCO), no name required for the header greeting if nameless.
S['05-success-role-hub'] = svg('05 · Success — connected in place, role hub (GCO vs KC choice)',
  siteChrome({ pill: 'rich-pedersen', toast: 'Connected · welcome' }) +
  T(48, 100, 'Welcome, rich-pedersen', { size: 24, fill: C.ink, weight: 800 }) +
  T(48, 128, "You're connected. Choose what you want to do — you can do both, and switch any time.", { size: 13.5, fill: C.sub }) +
  T(48, 146, 'Roles are workspaces, not separate accounts.', { size: 13.5, fill: C.sub }) +

  // KC card
  R(48, 166, 350, 200, { r: 16, fill: C.white, stroke: C.line }) +
  `<rect x="48" y="166" width="6" height="200" rx="3" fill="${C.ind}"/>` +
  pill(70, 182, 'SUPPLY', { bg: C.indSub, bd: C.indBd, fg: C.ind }) +
  T(70, 226, 'Offer your expertise (KC)', { size: 16.5, fill: C.ink, weight: 800 }) +
  T(70, 248, 'Act as your own individual person agent', { size: 12.5, fill: C.sub }) +
  T(84, 270, '• Publish your expertise offering', { size: 12, fill: C.g700 }) +
  T(84, 288, '• Browse coarsened demand', { size: 12, fill: C.g700 }) +
  T(84, 306, '• Accept requests on your terms', { size: 12, fill: C.g700 }) +
  btn(70, 330, 160, 'Offer your expertise', { fill: C.ind, sm: true }) +

  // GCO card
  R(420, 166, 350, 200, { r: 16, fill: C.white, stroke: C.line }) +
  `<rect x="420" y="166" width="6" height="200" rx="3" fill="${C.indD}"/>` +
  pill(442, 182, 'DEMAND', { bg: C.indSub, bd: C.indBd, fg: C.indD }) +
  T(442, 226, 'Set up an organization (GCO)', { size: 16.5, fill: C.ink, weight: 800 }) +
  T(442, 248, 'An organization you create and sign for', { size: 12.5, fill: C.sub }) +
  T(456, 270, '• Create the org + mint its grant', { size: 12, fill: C.g700 }) +
  T(456, 288, '• Post a skill need', { size: 12, fill: C.g700 }) +
  T(456, 306, '• Review explainable matches', { size: 12, fill: C.g700 }) +
  btn(442, 330, 180, 'Set up an organization', { fill: C.indD, sm: true }) +

  // Open home footer link
  R(48, 390, 722, 52, { r: 12, fill: C.g50, stroke: C.line }) +
  T(72, 410, 'Open Global.Church home', { size: 13, fill: C.ind, weight: 700 }) +
  T(72, 428, 'Your data lives in your Global.Church home; Switchboard reads only what you grant.', { size: 12, fill: C.g500 }) +

  // Nameless variant note (below the hub)
  T(48, 460, 'Note: if you connected without a name, the welcome greeting reads “welcome, you”.', { size: 11, fill: C.mute }) +
  T(48, 476, 'The public handle is optional and claimable later from your Impact home.', { size: 11, fill: C.mute }) +
  ''
);

// ── 06 POPUP BLOCKED ──────────────────────────────────────────────────────────
// Popup blocked → the explicit redirect fallback card. Co-brand pill is the trust anchor.
// CTA = "Continue in this tab" (takes over the current tab for the full-page redirect).
S['06-popup-blocked'] = svg('06 · Popup blocked — explicit redirect fallback card',
  siteChrome() +
  R(210, 120, 400, 310, { r: 18, fill: C.white, stroke: C.line }) +
  // Co-brand pill centred
  R(210 + 200 - 120, 148, 240, 28, { r: 14, fill: C.indSub, stroke: C.indBd }) +
  Circle(210 + 200 - 108, 162, 7, { fill: C.ind }) +
  T(210 + 200 - 94, 167, 'Global.Church  →  Impact', { size: 11.5, fill: C.ind, weight: 700 }) +
  // Heading
  T(410, 202, 'Blocked by your browser', { size: 20, fill: C.ink, weight: 800, anchor: 'middle' }) +
  // Body
  T(240, 232, 'Your browser blocked the secure sign-in window. We can take', { size: 13, fill: C.sub }) +
  T(240, 250, 'you to your Impact home in this tab and bring you back to', { size: 13, fill: C.sub }) +
  T(240, 268, 'Switchboard after you confirm.', { size: 13, fill: C.sub }) +
  // Primary CTA
  btn(240, 292, 340, 'Continue in this tab', { fill: C.ind }) +
  // Cancel link
  T(410, 360, 'Cancel', { size: 12.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
  R(378, 363, 64, 1, { r: 0, fill: C.indBd }) +
  // Fine print
  T(410, 396, 'The page that opens will say impact-agent.me — that is your home, not a new site.', { size: 11.5, fill: C.mute, anchor: 'middle' }) +
  ''
);

// ── 07 CANCELLED → BACK TO CARD ──────────────────────────────────────────────
// User dismissed the popup (pressed Escape or closed the popup window). They land back on the
// connect card, unchanged, with a soft "Cancelled — you can try again" banner.
S['07-cancelled'] = svg('07 · Cancelled — popup dismissed, back to connect card with soft notice',
  siteChrome() +
  R(160, 68, 500, 470, { r: 16, fill: C.white, stroke: C.line }) +
  // Soft cancelled notice at top of card
  R(180, 84, 460, 40, { r: 10, fill: C.warnSub, stroke: C.warnBd }) +
  T(200, 100, 'Sign-in was cancelled — you can try again below.', { size: 12.5, fill: C.warn, weight: 600 }) +

  T(200, 144, 'CONNECT', { size: 10, fill: C.ind, weight: 800 }) +
  T(200, 166, 'Connect with Global.Church', { size: 21, fill: C.ink, weight: 800 }) +
  T(200, 196, 'Use your Global.Church identity to enter Switchboard.', { size: 13.5, fill: C.sub }) +
  T(200, 214, 'You can offer your expertise or set up an organization', { size: 13.5, fill: C.sub }) +
  T(200, 232, 'after you connect.', { size: 13.5, fill: C.sub }) +

  R(200, 244, 420, 44, { r: 10, fill: C.indSub, stroke: C.indBd }) +
  T(220, 265, 'Switchboard receives only what you approve', { size: 12, fill: C.ind, weight: 600 }) +
  T(220, 281, '· your contact stays private until you accept a connection', { size: 11, fill: C.ind }) +

  btn(200, 305, 420, 'Continue with Global.Church', { fill: C.ind }) +
  T(200 + 210, 371, 'Use my Impact name instead', { size: 12.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
  R(285, 374, 190, 1, { r: 0, fill: C.indBd }) +
  T(200, 396, 'Your Impact name is a public handle. You do not need it to sign back in.', { size: 12, fill: C.mute }) +
  T(200, 426, '← Back to Switchboard', { size: 12, fill: C.ind, weight: 600 }) +
  ''
);

// ── 08 RECONNECT ─────────────────────────────────────────────────────────────
// A returning member. The connect card is unchanged — one tap "Continue with Global.Church" resolves
// to their existing home. No name needed. The popup shows "Welcome back" with their identity.
S['08-reconnect'] = svg('08 · Reconnect — returning member, one tap, popup shows “welcome back”',
  siteChrome({ dim: true }) +
  // Connect card dimmed behind popup
  R(160, 68, 500, 390, { r: 16, fill: C.white, stroke: C.line, op: 0.25 }) +
  T(200, 98, 'CONNECT', { size: 10, fill: C.ind, weight: 800, op: 0.25 }) +
  T(200, 122, 'Connect with Global.Church', { size: 21, fill: C.ink, weight: 800, op: 0.25 }) +
  T(200, 152, 'Continue with Global.Church', { size: 14.5, fill: C.white, weight: 700, op: 0.25 }) +

  // Welcome-back popup
  connectPopup((pw) => {
    const av = pw / 2;
    return Circle(av, 60, 28, { fill: C.teal }) +
      T(av, 68, 'R', { size: 22, fill: C.white, weight: 800, anchor: 'middle' }) +
      T(av, 118, 'Welcome back', { size: 22, fill: C.ink, weight: 800, anchor: 'middle' }) +
      T(av, 144, 'rich-pedersen.impact', { size: 14, fill: C.tealD, weight: 700, anchor: 'middle' }) +
      pill(av - 80, 158, 'KC Expert', { bg: C.okSub, bd: C.okBd, fg: C.ok }) +
      pill(av + 12, 158, 'Global Switchboard', { bg: C.indSub, bd: C.indBd, fg: C.ind }) +
      btn(28, 196, pw - 56, 'Continue to Global Switchboard', { fill: C.teal }) +
      T(av, 265, "Not you?  Use a different sign-in", { size: 11.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
      T(av, 285, 'Or enter your Impact name to go to a named home', { size: 11, fill: C.mute, anchor: 'middle' });
  }, { h: 320 }) +
  ''
);

// ── 09 ERROR STATE ────────────────────────────────────────────────────────────
// The exchange failed (network error, grant missing, etc.). The connect card returns with an error
// Banner and the user can retry. No silent fallback — error is shown explicitly.
S['09-error'] = svg('09 · Error state — exchange failed, explicit banner, retry available',
  siteChrome() +
  R(160, 68, 500, 480, { r: 16, fill: C.white, stroke: C.line }) +
  // Error banner
  R(180, 84, 460, 52, { r: 10, fill: C.errSub, stroke: C.errBd }) +
  T(200, 103, 'Sign-in failed', { size: 13, fill: C.err, weight: 700 }) +
  T(200, 121, 'Your home did not return a Switchboard access grant — please try again.', { size: 12, fill: C.err }) +

  T(200, 160, 'CONNECT', { size: 10, fill: C.ind, weight: 800 }) +
  T(200, 182, 'Connect with Global.Church', { size: 21, fill: C.ink, weight: 800 }) +
  T(200, 210, 'Use your Global.Church identity to enter Switchboard.', { size: 13.5, fill: C.sub }) +
  T(200, 228, 'You can offer your expertise or set up an organization after you connect.', { size: 12.5, fill: C.sub }) +

  R(200, 248, 420, 44, { r: 10, fill: C.indSub, stroke: C.indBd }) +
  T(220, 269, 'Switchboard receives only what you approve', { size: 12, fill: C.ind, weight: 600 }) +
  T(220, 285, '· your contact stays private until you accept a connection', { size: 11, fill: C.ind }) +

  btn(200, 308, 420, 'Try again', { fill: C.ind }) +
  T(200 + 210, 374, 'Use my Impact name instead', { size: 12.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
  R(285, 377, 190, 1, { r: 0, fill: C.indBd }) +
  T(200, 398, 'Your Impact name is a public handle. You do not need it to sign back in.', { size: 12, fill: C.mute }) +
  T(200, 426, '← Back to Switchboard', { size: 12, fill: C.ind, weight: 600 }) +
  ''
);

// ── 10 MULTI-HOME / ALREADY CONNECTED ────────────────────────────────────────
// Edge case: a Google account that already has a home, and a different device tries to connect via
// the named path with the same name. The popup shows "You already have a home" with the recognized
// identity and a single "Continue" — no new home created, no silent merge.
S['10-already-have-home'] = svg('10 · Already-have-home — Google resolves existing home (no duplicate)',
  siteChrome({ dim: true }) +
  connectPopup((pw) => {
    const av = pw / 2;
    return T(av, 44, 'Recognised your account', { size: 16.5, fill: C.ink, weight: 800, anchor: 'middle' }) +
      T(av, 66, 'You already have a Global.Church home.', { size: 12.5, fill: C.sub, anchor: 'middle' }) +
      T(av, 84, 'We’re connecting it to Switchboard now.', { size: 12.5, fill: C.sub, anchor: 'middle' }) +

      R(28, 104, pw - 56, 60, { r: 12, fill: C.g50, stroke: C.line }) +
      Circle(54, 134, 14, { fill: C.ind }) +
      T(54, 139, 'R', { size: 13, fill: C.white, weight: 800, anchor: 'middle' }) +
      T(80, 126, 'rich-pedersen', { size: 14.5, fill: C.ink, weight: 700 }) +
      T(80, 144, 'rich-pedersen.impact-agent.me', { size: 11.5, fill: C.mute }) +
      pill(pw - 56 - 100, 116, 'your home', { bg: C.okSub, bd: C.okBd, fg: C.ok }) +

      btn(28, 184, pw - 56, 'Continue to Switchboard', { fill: C.teal }) +
      T(av, 254, 'Not you? Use a different Google account', { size: 11.5, fill: C.ind, weight: 600, anchor: 'middle' }) +
      divider(28, 272, pw - 56) +
      T(av, 292, 'Your data stays at your home. Switchboard', { size: 11, fill: C.mute, anchor: 'middle' }) +
      T(av, 308, 'only receives the access you approve.', { size: 11, fill: C.mute, anchor: 'middle' });
  }, { h: 340 }) +
  ''
);

// ─── Write files ───────────────────────────────────────────────────────────────

for (const [name, svgStr] of Object.entries(S)) {
  validateSvg(svgStr, name);
  writeFileSync(join(OUT, `${name}.svg`), svgStr, 'utf8');
}

// Generate index.html
const order = Object.keys(S);
const screenDescriptions = {
  '01-landing-home': '01 · Landing home — single primary CTA "Continue with Global.Church" in hero + header. Informational GCO/KC cards below are NOT role gates.',
  '02-connect-card': '02 · Connect card — credential-first design. Primary CTA is visible immediately. Name field is hidden behind secondary link "Use my Impact name instead". Trust reassurance in-card.',
  '03-popup-opening': '03 · Popup opening state — button enters busy/loading state, site dims, reassurance copy replaces the bridge interstitial. NO HandoffBridge new-user variant shown.',
  '04-name-handle-panel': '04 · Name/handle panel — expanded when "Use my Impact name instead" is clicked. Shows input field + .impact / .impact-agent.me preview inline below the primary CTA.',
  '05-success-role-hub': '05 · Success → role hub — connected in place (no reload). Identity pill + toast. RoleHub: KC card ("Offer your expertise") + GCO card ("Set up an organization"). Nameless-member note.',
  '06-popup-blocked': '06 · Popup blocked — explicit redirect fallback card. Co-brand pill is trust anchor. CTA "Continue in this tab". Fine print explains impact-agent.me is the user\'s own home.',
  '07-cancelled': '07 · Cancelled — popup dismissed, back to connect card. Soft warn banner. Same card, same secondary link. No state lost.',
  '08-reconnect': '08 · Reconnect — returning member. Same connect card (no changes). Popup shows "Welcome back" with identity + role chips. One-tap flow.',
  '09-error': '09 · Error state — exchange failed. Explicit error banner (no silent fallback). CTA changes to "Try again". Same card layout.',
  '10-already-have-home': '10 · Already-have-home — Google resolves to an existing home. Popup shows recognised identity + single "Continue to Switchboard". No duplicate home created.',
};
const cards = order.map((n) =>
  `<a class="c" href="${n}.svg"><img src="${n}.svg" loading="lazy" alt="${esc(n)}"/><span>${esc(screenDescriptions[n] ?? n)}</span></a>`
).join('\n');

const indexHtml = `<!doctype html>
<meta charset="utf-8">
<title>Spec 258 — demo-gs connect UX redesign</title>
<style>
  body{font:14px/1.6 Inter,system-ui,sans-serif;margin:0;background:#0b1324;color:#e2e8f0;padding:28px}
  h1{font-size:22px;margin:0 0 6px;color:#f1f5f9}
  p{color:#94a3b8;max-width:860px;margin:0 0 24px}
  a{color:#818cf8}
  .grid{display:flex;flex-direction:column;gap:28px}
  .c{display:block;text-decoration:none;color:#cbd5e1}
  .c img{width:100%;max-width:820px;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.45);display:block}
  .c span{display:block;margin-top:8px;font-size:13px;font-weight:600;color:#94a3b8}
</style>
<h1>Spec 258 — demo-gs connect UX redesign</h1>
<p>
  Credential-first connect flow for Global Switchboard (demo-gs). Primary CTA = <b>Continue with Global.Church</b>.
  The name field is hidden behind a secondary link. The <code>HandoffBridge new-user</code> variant is removed from this path —
  the popup opens directly from the CTA with an in-page loading/dim state.
  Variants <code>org-create</code> and <code>reconnect</code> are unchanged.
  See <a href="../../specs/258-demo-gs-connect-ux.md">specs/258</a> (companion spec) and the
  <a href="component-spec.md">component-level implementation spec</a> in this directory.
</p>
<div class="grid">${cards}</div>`;

writeFileSync(join(OUT, 'index.html'), indexHtml, 'utf8');
console.log(`wrote ${order.length} numbered SVG screens + index.html to ${OUT}`);
