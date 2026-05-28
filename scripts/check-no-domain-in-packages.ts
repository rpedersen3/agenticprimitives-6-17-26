/**
 * check-no-domain-in-packages.ts
 *
 * Enforces (the automatable subset of) the "packages are generic; white-label /
 * vertical / deployment code lives in apps" rule (root CLAUDE.md / ADR-0021):
 * the reusable `packages/*` are generic + vertical-agnostic. Concrete hostnames
 * (impact-agent.me/.io), the demo `.agent` subregistry, hosting providers
 * (pages.dev / workers.dev / vercel), and white-label/faith-vertical CONTENT
 * (church/ministry/discipleship/…) belong ONLY at the app level (apps/*), as an
 * app-level white-label config the generic core consumes — never embedded here.
 *
 * The `.agent` TLD itself is the naming PROTOCOL (owned by agent-naming) and is
 * allowed; `demo.agent` (a deployment's permissionless subregistry) is not.
 *
 * Scans shipped package source (`packages/<pkg>/src/**`), skipping dist/tests.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const PACKAGES = join(ROOT, 'packages');

const FORBIDDEN: { re: RegExp; what: string }[] = [
  // Deployment specifics (hostnames / subregistry / hosting providers).
  { re: /impact-agent\.(me|io)/i, what: 'deployment domain impact-agent.me/.io' },
  { re: /\bdemo\.agent\b/i, what: 'demo `.agent` subregistry (deployment-specific)' },
  { re: /\.pages\.dev/i, what: 'Cloudflare Pages hostname' },
  { re: /\.workers\.dev/i, what: 'Cloudflare Workers hostname' },
  { re: /\bvercel(-dns)?\b/i, what: 'Vercel hostname/provider' },
  { re: /agentictrust\.io/i, what: 'agentictrust.io domain' },
  { re: /agenticprimitives\.local/i, what: 'agenticprimitives.local dev domain' },
  // White-label / vertical CONTENT (faith vocabulary) — belongs in apps, never the
  // generic core (ADR-0021). These nouns don't occur in generic agent primitives.
  {
    re: /\b(church|ministry|ministries|congregation|discipleship|parish|denomination|gospel|scripture|sermon|missionary|evangelism)\b/i,
    what: 'faith-vertical content (white-label — apps only)',
  },
];

const SKIP_DIRS = new Set(['dist', 'node_modules', 'coverage', 'test', 'tests', '__tests__']);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const findings: string[] = [];
for (const pkg of readdirSync(PACKAGES)) {
  const src = join(PACKAGES, pkg, 'src');
  if (!existsSync(src)) continue;
  for (const file of tsFiles(src)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { re, what } of FORBIDDEN) {
        if (re.test(line)) {
          findings.push(`  ${file.replace(ROOT + '/', '')}:${i + 1}  [${what}]\n      ${line.trim().slice(0, 100)}`);
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error('✘ check-no-domain-in-packages — deployment-domain code leaked into packages/:\n');
  console.error(findings.join('\n'));
  console.error(
    '\nDeployment domains belong ONLY in apps/* (config/env), never in reusable packages.\n' +
      'Move the literal to the app layer and pass it in. See the rule in CLAUDE.md / ADR-0020.',
  );
  process.exit(1);
}
console.log('✓ check-no-domain-in-packages passed — packages are domain-agnostic.');
