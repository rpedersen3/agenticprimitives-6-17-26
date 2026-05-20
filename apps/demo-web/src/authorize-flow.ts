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
import type { PasskeySigner } from './passkey-signer';

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
  // EOA path: the delegator is the user's EOA, smart account is derived.
  return authorizeWithSigner(
    {
      address: user.address as Address,
      signTypedData: async (args) =>
        (await user.account.signTypedData({
          domain: args.domain,
          types: args.types as Record<string, Array<{ name: string; type: string }>>,
          primaryType: args.primaryType,
          message: args.message,
        })) as Hex,
    },
    config,
  );
}

export async function authorizeAgentWithPasskey(
  passkey: PasskeySigner,
  config: AuthorizeFlowConfig,
): Promise<AuthorizeFlowOk | AuthorizeFlowError> {
  // Passkey path: the delegator IS the smart-account address (no EOA in
  // the trust chain). The PasskeySigner produces 0x01-prefixed WebAuthn
  // blobs that AgentAccount's ERC-1271 routes through `_verifyWebAuthn`.
  return authorizeWithSigner(
    {
      address: passkey.address,
      signTypedData: async (args) =>
        passkey.signTypedData({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          domain: args.domain as any,
          types: args.types as Record<string, Array<{ name: string; type: string }>>,
          primaryType: args.primaryType,
          message: args.message,
        }),
    },
    config,
  );
}

// ─── Shared authorize machinery ──────────────────────────────────────

interface AbstractSigner {
  address: Address;
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: unknown;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

async function authorizeWithSigner(
  signer: AbstractSigner,
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

  // 2. Build the Delegation, sign the EIP-712 hash via the supplied signer.
  //    DelegationClient produces the digest; the signer wire-formats the
  //    signature (raw ECDSA for EOA, 0x01-prefixed WebAuthn assertion for
  //    passkey). AgentAccount's ERC-1271 dispatches on the leading byte.
  const now = Math.floor(Date.now() / 1000);
  const caveats = [
    buildCaveat(config.timestampEnforcer, encodeTimestampTerms(now, now + DELEGATION_TTL_SECONDS)),
    buildMcpToolScopeCaveat(ALLOWED_TOOLS),
  ];

  const client = new DelegationClient({
    signer,
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
