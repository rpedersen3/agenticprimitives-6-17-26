// Step 2: user authorizes the a2a agent by issuing a Delegation.
//   1. POST /a2a/session/init      → { sessionId, sessionKeyAddress }
//   2. Use DelegationClient (browser) to build + sign the Delegation,
//      with the demo EOA acting as the owner of the smart account.
//   3. POST /a2a/session/package   → { delegationHash, erc1271Verified }

import {
  DelegationClient,
  buildCaveat,
  buildMcpToolScopeCaveat,
  encodeTimestampTerms,
  type Delegation,
} from '@agenticprimitives/delegation';
import type { Address, Hex } from '@agenticprimitives/types';
import type { DemoUser } from './test-user';

export interface AuthorizeFlowOk {
  ok: true;
  sessionId: string;
  sessionKeyAddress: Address;
  delegationHash: Hex;
  erc1271Verified: boolean;
}

export interface AuthorizeFlowError {
  ok: false;
  error: string;
  reason?: string;
}

export interface AuthorizeFlowConfig {
  smartAccountAddress: Address;
  delegationManager: Address;
  timestampEnforcer: Address;
  chainId: number;
}

const DELEGATION_TTL_SECONDS = 86400; // 24h
const ALLOWED_TOOLS = ['get_profile', 'update_profile'];

export async function authorizeAgent(
  user: DemoUser,
  config: AuthorizeFlowConfig,
): Promise<AuthorizeFlowOk | AuthorizeFlowError> {
  // 1. session/init
  const initRes = await fetch('/a2a/session/init', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountAddress: config.smartAccountAddress }),
  });
  const initBody = (await initRes.json()) as Record<string, unknown>;
  if (!initRes.ok || initBody.ok !== true) {
    return { ok: false, error: typeof initBody.error === 'string' ? initBody.error : `HTTP ${initRes.status}` };
  }
  const sessionId = String(initBody.sessionId);
  const sessionKeyAddress = String(initBody.sessionKeyAddress) as Address;

  // 2. Build the Delegation, sign via the user's EOA (viem account).
  // The user's EOA is the owner of the smart account; signing the EIP-712
  // hash here produces a signature the smart account's ERC-1271 accepts.
  const now = Math.floor(Date.now() / 1000);
  const caveats = [
    buildCaveat(config.timestampEnforcer, encodeTimestampTerms(now, now + DELEGATION_TTL_SECONDS)),
    buildMcpToolScopeCaveat(ALLOWED_TOOLS),
  ];

  const client = new DelegationClient({
    signer: {
      address: user.address as Address,
      signTypedData: async (args) => (await user.account.signTypedData({
        domain: args.domain,
        types: args.types as Record<string, Array<{ name: string; type: string }>>,
        primaryType: args.primaryType,
        message: args.message,
      })) as Hex,
    },
    smartAccount: config.smartAccountAddress,
    chainId: config.chainId,
    delegationManager: config.delegationManager,
  });

  let delegation: Delegation;
  try {
    delegation = await client.issueDelegation({ delegate: sessionKeyAddress, caveats });
  } catch (e) {
    return { ok: false, error: 'sign delegation failed', reason: e instanceof Error ? e.message : String(e) };
  }

  // 3. session/package — BigInt salt over the wire as a string
  const packageRes = await fetch('/a2a/session/package', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      delegation: { ...delegation, salt: delegation.salt.toString() },
    }),
  });
  const pkgBody = (await packageRes.json()) as Record<string, unknown>;
  if (!packageRes.ok || pkgBody.ok !== true) {
    return {
      ok: false,
      error: typeof pkgBody.error === 'string' ? pkgBody.error : `HTTP ${packageRes.status}`,
      reason: typeof pkgBody.detail === 'string' ? pkgBody.detail : undefined,
    };
  }

  return {
    ok: true,
    sessionId,
    sessionKeyAddress,
    delegationHash: String(pkgBody.delegationHash) as Hex,
    erc1271Verified: Boolean(pkgBody.erc1271Verified),
  };
}
