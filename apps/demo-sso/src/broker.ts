// The demo Connect broker — wires the real packages end-to-end:
//   connect (token + convergence + issuance)
//   + identity-directory (resolution: indexer proposes, on-chain confirms)
//   + identity-directory-adapters (NamingPort / OnChainReadPort / IndexerPort).
//
// ⚠️ DEMO SIMPLIFICATION: the broker private key is generated in the browser so
// this demo is self-contained + runnable with no backend. In PRODUCTION the key
// lives server-side at the Connect origin (a Cloudflare Pages Function / Worker);
// the browser only ever sees the JWKS. Credential verification (passkey/OIDC) is
// also simulated here — connect-auth owns the real ceremonies; this demo's focus
// is the SSO flow + package integration + the security gates.

import {
  generateBrokerKeypair,
  issueForResolution,
  verifyAgentSession,
  publishJwks,
  importJwks,
  requiresStepUp,
  type BrokerSigner,
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

const ALICE_ADDR = '0x1111111111111111111111111111111111111111' as Address;
const BOB_ADDR = '0x2222222222222222222222222222222222222222' as Address;
export const ALICE: CanonicalAgentId = toCanonicalAgentId(CHAIN, ALICE_ADDR);
export const BOB: CanonicalAgentId = toCanonicalAgentId(CHAIN, BOB_ADDR);

// Credential facets. passkey = custody-grade; GitHub OIDC = login-grade (ADR-0017).
export const ALICE_PASSKEY: CredentialPrincipal = { kind: 'passkey', id: 'alice-passkey-01', assurance: 'onchain-confirmed', role: 'custody-grade' };
export const ALICE_OIDC: CredentialPrincipal = { kind: 'oidc', id: 'https://github.com#1001', assurance: 'asserted', role: 'login-grade' };
export const BOB_PASSKEY: CredentialPrincipal = { kind: 'passkey', id: 'bob-passkey-01', assurance: 'onchain-confirmed', role: 'custody-grade' };

function memberKey(agent: CanonicalAgentId, p: CredentialPrincipal): string {
  return `${agent}|${p.kind}|${p.id}`;
}

// The on-chain CURRENT custody set — what OnChainReadPort.confirmsCredential checks
// (demo: a Set; production: a readContract isCustodian/isTrustee call). A credential
// removed here (e.g. revoked) would no longer confirm → the directory drops it.
const onChainMembership = new Set<string>([
  memberKey(ALICE, ALICE_PASSKEY),
  memberKey(ALICE, ALICE_OIDC),
  memberKey(BOB, BOB_PASSKEY),
]);

// The (non-authoritative) index: credential → candidate agents.
const indexEntries: IndexerEntry[] = [
  { agent: ALICE, principalKind: 'passkey', principalId: ALICE_PASSKEY.id, assurance: 'asserted', ref: 'demo-index' },
  { agent: ALICE, principalKind: 'oidc', principalId: ALICE_OIDC.id, assurance: 'asserted', ref: 'demo-index' },
  { agent: BOB, principalKind: 'passkey', principalId: BOB_PASSKEY.id, assurance: 'asserted', ref: 'demo-index' },
];

const NAMES: Record<string, Address> = { 'alice.agent': ALICE_ADDR, 'bob.agent': BOB_ADDR };
// Keyed on the lowercased EVM address — the NamingPort adapter calls
// reverseResolve(Address) (it parses the address out of the CanonicalAgentId first).
const reverseNames: Record<string, string> = {
  [ALICE_ADDR.toLowerCase()]: 'alice.agent',
  [BOB_ADDR.toLowerCase()]: 'bob.agent',
};

export type Jwks = Awaited<ReturnType<typeof publishJwks>>;

export interface DemoBroker {
  readonly kid: string;
  readonly jwks: Jwks;
  readonly directory: IdentityDirectory;
  /** Authenticate (simulated) + resolve + issue an aud-bound AgentSession. */
  login(principal: CredentialPrincipal, aud: string): Promise<IssueOutcome>;
  /** Relying-site side: verify a delivered token against the published JWKS. */
  verifyForRelyingSite(token: string, aud: string): Promise<VerifyResult>;
  /** Step-up gate: can this session perform `action`? (custody-class needs custody-grade.) */
  canPerform(session: AgentSession, action: string): { ok: boolean; reason?: string };
}

export async function createDemoBroker(): Promise<DemoBroker> {
  const signer: BrokerSigner = await generateBrokerKeypair('EdDSA');
  const jwks = await publishJwks([signer]);

  const directory = createDirectory({
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

  return {
    kid: signer.kid,
    jwks,
    directory,

    async login(principal, aud) {
      // Resolve the (simulated-)verified credential → agent(s), then issue.
      const resolution = await directory.resolveByCredential(principal);
      return issueForResolution({ resolution, principal, signer, aud, iss: CONNECT_ORIGIN, ttlSeconds: 600 });
    },

    async verifyForRelyingSite(token, aud) {
      const keys = await importJwks(jwks);
      return verifyAgentSession(token, { keys, expectedIss: CONNECT_ORIGIN, expectedAud: aud });
    },

    canPerform(session, action) {
      if (!requiresStepUp(action)) return { ok: true };
      if (session.principal.role === 'custody-grade') return { ok: true };
      return {
        ok: false,
        reason: `"${action}" is a custody-class action; this session is ${session.principal.role ?? 'login-grade'}. Step up with a custody-grade credential (ADR-0017 / CN-2).`,
      };
    },
  };
}
