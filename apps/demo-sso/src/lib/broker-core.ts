// Shared broker core — the directory wiring + issuance/verification logic, with
// the signing key INJECTED. Used by both the in-browser demo broker
// (src/broker.ts, key generated in-page) and the server-side Pages Function
// broker (functions/*, key from an env secret). Pure Web Crypto — browser- AND
// Workers-safe (no node:url; ontology's main entry is browser-safe).

import {
  issueForResolution,
  verifyAgentSession,
  importJwks,
  requiresStepUp,
  type BrokerSigner,
  type BrokerAlg,
  type IssueOutcome,
  type VerifyResult,
} from '@agenticprimitives/connect';
import { createDirectory, type IdentityDirectory } from '@agenticprimitives/identity-directory';
import {
  makeNamingPort,
  makeOnChainReadPort,
  createInMemoryIndexer,
  toCanonicalAgentId,
  type IndexerEntry,
} from '@agenticprimitives/identity-directory-adapters';
import type { Address, CanonicalAgentId, CredentialPrincipal, AgentSession } from '@agenticprimitives/types';

export const CHAIN = 8453;
export const CONNECT_ORIGIN = 'https://connect.demo.local';
const SESSION_TTL_SECONDS = 600;

const ALICE_ADDR = '0x1111111111111111111111111111111111111111' as Address;
const BOB_ADDR = '0x2222222222222222222222222222222222222222' as Address;
export const ALICE: CanonicalAgentId = toCanonicalAgentId(CHAIN, ALICE_ADDR);
export const BOB: CanonicalAgentId = toCanonicalAgentId(CHAIN, BOB_ADDR);

// passkey = custody-grade; GitHub OIDC = login-grade (ADR-0017).
export const ALICE_PASSKEY: CredentialPrincipal = { kind: 'passkey', id: 'alice-passkey-01', assurance: 'onchain-confirmed', role: 'custody-grade' };
export const ALICE_OIDC: CredentialPrincipal = { kind: 'oidc', id: 'https://github.com#1001', assurance: 'asserted', role: 'login-grade' };
export const BOB_PASSKEY: CredentialPrincipal = { kind: 'passkey', id: 'bob-passkey-01', assurance: 'onchain-confirmed', role: 'custody-grade' };

function memberKey(agent: CanonicalAgentId, p: CredentialPrincipal): string {
  return `${agent}|${p.kind}|${p.id}`;
}

// The on-chain CURRENT custody set (demo: a Set; production: readContract).
const onChainMembership = new Set<string>([
  memberKey(ALICE, ALICE_PASSKEY),
  memberKey(ALICE, ALICE_OIDC),
  memberKey(BOB, BOB_PASSKEY),
]);

const indexEntries: IndexerEntry[] = [
  { agent: ALICE, principalKind: 'passkey', principalId: ALICE_PASSKEY.id, assurance: 'asserted', ref: 'demo-index' },
  { agent: ALICE, principalKind: 'oidc', principalId: ALICE_OIDC.id, assurance: 'asserted', ref: 'demo-index' },
  { agent: BOB, principalKind: 'passkey', principalId: BOB_PASSKEY.id, assurance: 'asserted', ref: 'demo-index' },
];

const NAMES: Record<string, Address> = { 'alice.agent': ALICE_ADDR, 'bob.agent': BOB_ADDR };
const reverseNames: Record<string, string> = {
  [ALICE_ADDR.toLowerCase()]: 'alice.agent',
  [BOB_ADDR.toLowerCase()]: 'bob.agent',
};

/** Build the demo directory (mock ports + seeds). Shared by both broker variants. */
export function buildDemoDirectory(): IdentityDirectory {
  return createDirectory({
    naming: makeNamingPort({
      client: {
        resolveName: async (name: string) => NAMES[name] ?? null,
        reverseResolve: async (addr: Address) => reverseNames[addr.toLowerCase()] ?? null,
      },
      chainId: CHAIN,
    }),
    onChain: makeOnChainReadPort({
      exists: async (id) => id === ALICE || id === BOB,
      confirmsCredential: async (id, p) => onChainMembership.has(memberKey(id, p)),
    }),
    indexer: createInMemoryIndexer(indexEntries),
  });
}

/** Resolve a (verified) credential → agent(s) and issue an aud-bound AgentSession. */
export async function issueForRelyingSite(
  directory: IdentityDirectory,
  signer: BrokerSigner,
  principal: CredentialPrincipal,
  aud: string,
): Promise<IssueOutcome> {
  const resolution = await directory.resolveByCredential(principal);
  return issueForResolution({ resolution, principal, signer, aud, iss: CONNECT_ORIGIN, ttlSeconds: SESSION_TTL_SECONDS });
}

/** Relying-site side: verify a delivered token against a published JWKS. */
export async function verifyTokenWithJwks(
  jwks: Parameters<typeof importJwks>[0],
  token: string,
  aud: string,
): Promise<VerifyResult> {
  const keys = await importJwks(jwks);
  return verifyAgentSession(token, { keys, expectedIss: CONNECT_ORIGIN, expectedAud: aud });
}

/** Step-up gate: custody-class actions need a custody-grade credential. */
export function canPerform(session: AgentSession, action: string): { ok: boolean; reason?: string } {
  if (!requiresStepUp(action)) return { ok: true };
  if (session.principal.role === 'custody-grade') return { ok: true };
  return {
    ok: false,
    reason: `"${action}" is a custody-class action; this session is ${session.principal.role ?? 'login-grade'}. Step up with a custody-grade credential (ADR-0017 / CN-2).`,
  };
}

/**
 * Build a BrokerSigner from a stored Ed25519 PRIVATE JWK (the server path — the
 * key lives in an env secret, not in the browser). Derives the public key from
 * the JWK's `x`. Web Crypto, so it runs in the Workers/Pages runtime.
 */
export async function signerFromPrivateJwk(jwk: JsonWebKey & { x?: string }, kid: string): Promise<BrokerSigner> {
  const alg: BrokerAlg = 'EdDSA';
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  const publicKey = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x } as JsonWebKey, { name: 'Ed25519' }, true, ['verify']);
  return { kid, alg, privateKey, publicKey };
}
