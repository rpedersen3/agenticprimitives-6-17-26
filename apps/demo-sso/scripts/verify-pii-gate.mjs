// One-off: verify the AgentSession-grade PII gate (spec 227 §7 / M4).
// Mints a login-grade + a custody-grade session, verifies each against the JWKS,
// and asserts the gate. No browser/chain needed.
//   pnpm exec tsx apps/demo-sso/scripts/verify-pii-gate.mjs
import {
  generateBrokerKeypair,
  publishJwks,
  importJwks,
  mintAgentSession,
  verifyAgentSession,
} from '@agenticprimitives/connect';
import { canReadSensitivePii } from '../src/lib/pii.ts';

const ISS = 'https://connect.test';
const AUD = 'demo-sso';
const SUB = 'eip155:84532:0x1111111111111111111111111111111111111111';

const signer = await generateBrokerKeypair('ES256');
const jwks = await publishJwks([signer]);
const keys = await importJwks(jwks);

async function mintAndVerify(assurance, role) {
  const token = await mintAgentSession(
    { sub: SUB, principal: { kind: 'passkey', id: 'pk-1', assurance, role }, assurance, aud: AUD, iss: ISS, ttlSeconds: 300 },
    signer,
  );
  const v = await verifyAgentSession(token, { keys, expectedIss: ISS, expectedAud: AUD });
  if (!v.ok) throw new Error(`verify failed: ${v.reason}`);
  return v.session;
}

const login = await mintAndVerify('asserted', 'login-grade');
const custody = await mintAndVerify('onchain-confirmed', 'custody-grade');

console.log('login-grade   -> canReadSensitivePii =', canReadSensitivePii(login), '(expect false)');
console.log('custody-grade -> canReadSensitivePii =', canReadSensitivePii(custody), '(expect true)');

// aud mismatch must fail closed (P1-F).
const wrongAud = await verifyAgentSession(
  await mintAgentSession(
    { sub: SUB, principal: { kind: 'passkey', id: 'pk-1', assurance: 'onchain-confirmed', role: 'custody-grade' }, assurance: 'onchain-confirmed', aud: 'other-site', iss: ISS, ttlSeconds: 300 },
    signer,
  ),
  { keys, expectedIss: ISS, expectedAud: AUD },
);
console.log('aud=other-site verified against aud=demo-sso ->', wrongAud.ok, '(expect false)');

if (canReadSensitivePii(login) !== false || canReadSensitivePii(custody) !== true || wrongAud.ok !== false) {
  console.error('GATE FAILED');
  process.exit(1);
}
console.log('OK — PII step-up gate enforced: login-grade denied sensitive, custody-grade allowed, cross-aud rejected.');
