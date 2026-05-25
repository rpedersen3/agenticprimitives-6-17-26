/**
 * Shared seat-enrollment helper — supports BOTH credential kinds:
 *   - passkey: WebAuthn credential on this device → PIA custodian.
 *   - SIWE/EOA: a connected wallet's EOA → owner custodian.
 *
 * Used by Act 0 (Alice/Bob trustees) and Act 1 (Sam) so every role in
 * the recovery demo can be a passkey OR a wallet. The recovery ceremony
 * (Act 4) then signs with whichever method each trustee enrolled — the
 * custody-ceremony helper already handles passkey + SIWE quorum slots.
 */

import { keccak256, encodeAbiParameters, type Address } from 'viem';
import { config } from '../config';
import { registerPasskeyForSeat, savePasskeyForSeat, type DemoPasskey } from './passkey';
import { loadSeats, type AuthMethod, type SeatClaim } from './seats';
import { getSessionSalt } from './session-salt';

export type EnrollChoice = 'passkey' | 'siwe';

export interface EnrolledCredential {
  authMethod: AuthMethod;
  /** On-chain identity: PIA (passkey) or EOA (wallet). */
  identity: Address;
  /** Present only for the passkey path — needed to sign in Act 4. */
  passkey?: DemoPasskey;
}

/** keccak256(abi.encode(x,y)) → PIA, mirrors @agenticprimitives/account-custody. */
export function passkeyIdentity(x: bigint, y: bigint): Address {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [x, y]));
  return ('0x' + h.slice(-40)) as Address;
}

/**
 * Returns the seatId already bound to `eoa` (other than `exceptSeatId`),
 * or null. Each seat MUST use a DISTINCT wallet: the Smart Agent address
 * is CREATE2-deterministic from (custodian, trustees, salt), so two
 * seats sharing an EOA would deploy to the SAME address — Alice's PSA
 * would equal Bob's. Callers block the claim and prompt an account switch.
 */
export function seatBoundToEoa(eoa: Address, exceptSeatId?: string): string | null {
  const lower = eoa.toLowerCase();
  for (const [id, claim] of Object.entries(loadSeats())) {
    if (id === exceptSeatId) continue;
    if (claim.authMethods.some((m) => m.kind === 'siwe' && m.eoa.toLowerCase() === lower)) {
      return id;
    }
  }
  return null;
}

/** Primary on-chain identity bound to a claimed seat (PIA or EOA). */
export function primaryIdentity(seat: SeatClaim): Address {
  const m = seat.authMethods[0];
  if (!m) throw new Error(`seat ${seat.seatId} has no auth method`);
  return m.kind === 'passkey' ? m.pia : m.eoa;
}

/**
 * Register the chosen credential WITHOUT deploying. For passkey this
 * runs the WebAuthn ceremony + saves the local mirror; for SIWE it just
 * wraps the already-connected EOA. Returns the auth method + identity.
 */
export async function enrollCredential(args: {
  seatId: string;
  name: string;
  choice: EnrollChoice;
  /** Required for the SIWE path — the connected wallet address. */
  eoa?: Address;
}): Promise<EnrolledCredential> {
  if (args.choice === 'siwe') {
    if (!args.eoa) throw new Error('Connect a wallet before enrolling via SIWE.');
    return { authMethod: { kind: 'siwe', eoa: args.eoa }, identity: args.eoa };
  }
  const passkey = await registerPasskeyForSeat(args.seatId, args.name);
  savePasskeyForSeat(args.seatId, passkey);
  const pia = passkeyIdentity(passkey.pubKeyX, passkey.pubKeyY);
  return {
    authMethod: {
      kind: 'passkey',
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX,
      pubKeyY: passkey.pubKeyY,
      pia,
    },
    identity: pia,
    passkey,
  };
}

/**
 * Worker-direct deploy of an AgentAccount. The custodian is the enrolled
 * credential: an EOA owner (SIWE) or the initial passkey (passkey path).
 * Passkey fields are omitted for the EOA path — the worker zero-defaults
 * them, giving an owner-only account.
 */
export async function directDeploy(args: {
  credential: EnrolledCredential;
  trustees: Address[];
  /** 7-tuple per RiskTier; demo uses short T4/T6 delays. */
  timelockOverrides: number[];
  mode?: number;
  salt?: string;
}): Promise<Address> {
  if (!config.demoA2aUrl) throw new Error('demo-a2a URL not configured');
  const { ensureCsrfToken, csrfHeaders } = await import('./csrf');
  await ensureCsrfToken();
  const base = config.demoA2aUrl.replace(/\/$/, '');

  const isPasskey = args.credential.authMethod.kind === 'passkey';
  const pk = args.credential.passkey;
  const res = await fetch(`${base}/session/direct-deploy`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      mode: args.mode ?? 1,
      // EOA path → the wallet is the custodian. Passkey path → custodians
      // stays empty and the initialPasskey* fields ARE the custodian.
      custodians: isPasskey ? [] : [args.credential.identity],
      trustees: args.trustees,
      ...(isPasskey && pk
        ? {
            initialPasskeyCredentialIdDigest: pk.credentialIdDigest,
            initialPasskeyX: pk.pubKeyX.toString(),
            initialPasskeyY: pk.pubKeyY.toString(),
          }
        : {}),
      timelockOverrides: args.timelockOverrides,
      // Session-scoped salt: stable within a demo session (so reloads
      // don't drift the address) but fresh after Reset — each new run
      // deploys NEW Smart Agents and claims the next unique name
      // (sam → sam2 → …), matching demo-web-pro.
      salt: args.salt ?? getSessionSalt(),
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.ok !== true) {
    throw new Error(typeof body.error === 'string' ? body.error : `deploy HTTP ${res.status}`);
  }
  return body.deployedAddress as Address;
}
