/**
 * Shared schedule+apply ceremony helper — NATIVE MULTI-SIGNER.
 *
 * Wave R1 collapsed the old single-signer + planned-multi-signer split
 * into one helper: `scheduleAndApply({ signers: [...] })` where the
 * trivial `signers.length === 1` case is what every demo-web-pro Act
 * 3/4/5/etc. already uses, and `signers.length === 2+` is what the
 * recovery demo needs (Alice + Bob 2-of-2 on T6 RecoverAccount).
 *
 * Each signer signs both the schedule hash and the apply hash. The
 * collected `QuorumSlot[]` is sorted-ascending-by-signer-address inside
 * `packQuorumSigs` and submitted in one tx. CustodyPolicy verifies all
 * slots against the bound payload hash + the account's custodian set.
 *
 * Submission account choice doesn't affect security (CustodyPolicy
 * validates quorum sigs, not msg.sender). We prefer the first signer's
 * PSA when they have a passkey (gasless userOp + paymaster), falling
 * back to the demo-a2a worker relay (worker pays gas with deployer EOA).
 */

import { keccak256, type Address, type Hex } from 'viem';
import {
  CustodyAction,
  ScheduleCustodyChangeRequest,
  ApplyCustodyChangeRequest,
  custodyDomain,
  packQuorumSigs,
  type QuorumSlot,
} from '@agenticprimitives/account-custody';
import {
  computeDomainSeparator,
  hashScheduleCustodyChange,
  hashApplyCustodyChange,
  encodeScheduleCall,
  encodeApplyCall,
} from './custody-flow';
import { executeCallFromAgent, encodeExecuteCall } from './execute-call';
import { readIsCustodian, readScheduledChange, readScheduledChangeCount, derivePasskeyRpIdHash } from './chain-reads';
import { config } from '../config';
import { assertWithPasskey, type DemoPasskey } from './passkey';
import { getPasskeyAuth, getSiweAuth, type SeatClaim } from './seats';

/**
 * Wallet's signTypedData callback (provided by the act via wagmi's
 * `useSignTypedData().signTypedDataAsync`). Decoupled from this module
 * so the helper doesn't need to mount a React hook context.
 *
 * `account` pins which EOA MetaMask signs with — without it, MetaMask
 * silently uses the currently-active account in the wallet UI, which
 * is the wrong identity in the 2-of-2 case (Alice's active when we
 * need Bob's sig). With `account` set, MetaMask pops a signature
 * dialog for that specific account regardless of which is "active"
 * in its dropdown, as long as the dapp has permission for it.
 */
export type SignTypedDataFn = (args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  domain: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  types: any;
  primaryType: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
  account?: Address;
}) => Promise<Hex>;

/**
 * Returns the connected wallet's current address, or null if no wallet
 * is connected. Used to guard against signing with the wrong MetaMask
 * account — e.g. user claimed Bob's seat with a different EOA but is
 * now trying to sign as Alice; if the wallet is still set to Bob's
 * account, every signature recovers to Bob and fails the quorum.
 */
export type GetWalletAddressFn = () => `0x${string}` | undefined;

/**
 * Opens MetaMask's account picker via `wallet_requestPermissions`. After
 * the user picks, resolves to the wagmi-reported active address. Used to
 * auto-recover from "wrong wallet account active" mismatches without
 * forcing the user to navigate MetaMask manually.
 */
export type PromptSwitchWalletAccountFn = () => Promise<`0x${string}` | undefined>;

/**
 * One participant in a multi-sig ceremony. Carries the seat (which
 * exposes the auth method) + the local-only passkey credential (if any)
 * + the SIWE callbacks (if no passkey). For a single-signer ceremony
 * the caller passes one of these; for 2-of-2 recovery they pass two.
 */
export interface CeremonySigner {
  seat: SeatClaim;
  /** Required when the seat has passkey auth. */
  passkey?: DemoPasskey;
  /** Required when the seat is SIWE-only. */
  signTypedDataAsync?: SignTypedDataFn;
  /** Required when SIWE-only — wagmi `useAccount().address` accessor. */
  getWalletAddress?: GetWalletAddressFn;
  /** Required when SIWE-only — wallet account-picker prompt. */
  promptSwitchWalletAccount?: PromptSwitchWalletAccountFn;
}

/**
 * Sign a CustodyPolicy schedule/apply payload using whichever method
 * the signer has enrolled. Passkey preferred (gasless UX); SIWE used
 * only when no passkey method exists. Returns a packed quorum slot
 * the caller can hand to `packQuorumSigs`.
 */
async function signCeremonyHash(args: {
  signer: CeremonySigner;
  /** Domain + typed-data fragments for the SIWE path. */
  domain: { chainId: number; verifyingContract: Address };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  types: any;
  primaryType: 'ScheduleCustodyChangeRequest' | 'ApplyCustodyChangeRequest';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
  /** Pre-computed EIP-712 hash. Passkey signs this directly. */
  hash: Hex;
}): Promise<QuorumSlot> {
  const { signer } = args;
  const passkeyAuth = getPasskeyAuth(signer.seat);
  if (passkeyAuth && signer.passkey) {
    const pk = signer.passkey;
    // A ceremony fires SEVERAL passkey assertions (schedule + apply, and a 2-of-2
    // step signs the same hash with both signers back-to-back), so all but the first
    // lose the click's transient activation → WebKit rejects or hangs the prompt.
    // assertWithPasskey now routes through the gesture gate at the source (every
    // assertion runs inside its own tap), so we just call it with a descriptive
    // label — no per-call gate wiring needed here.
    const stepLabel = args.primaryType === 'ScheduleCustodyChangeRequest' ? 'schedule' : 'apply';
    const assertion = await assertWithPasskey(
      pk,
      args.hash,
      `Approve the ${stepLabel} signature with your passkey.`,
    );
    // H7-C.1 / CON-WEBAUTHN-001: v=2 quorum slot tail body now includes
    // rpIdHash (PR after #94, 2026-06-01). The on-chain decoder at
    // SignatureSlotRecovery.sol:172 expects 4 fields; encoding 3 caused
    // empty-revert AdminUnauthorizedSigner-class failures on every passkey-
    // signed custody schedule.
    const rpIdHash = await derivePasskeyRpIdHash();
    return {
      type: 'passkey',
      pia: passkeyAuth.pia,
      x: signer.passkey.pubKeyX,
      y: signer.passkey.pubKeyY,
      rpIdHash,
      assertion,
    };
  }
  const siwe = getSiweAuth(signer.seat);
  if (!siwe || !signer.signTypedDataAsync) {
    throw new Error(
      'Seat has no signing method available — needs either a local DemoPasskey or a connected wallet + signTypedDataAsync callback.',
    );
  }
  // Account pinning: pass `siwe.eoa` to signTypedDataAsync so MetaMask
  // signs with THAT specific account, not whichever happens to be the
  // active selection in MetaMask's UI. This eliminates the "Wrong
  // MetaMask account active" failure mode for the 2-of-2 case
  // (Alice's wallet active when we need Bob's sig). MetaMask will
  // pop a signature dialog for the pinned account as long as the dapp
  // has permission for it. If it doesn't have permission, the call
  // throws — we fall through to the picker prompt so the user can grant.
  const domainForWallet = custodyDomain({
    chainId: args.domain.chainId,
    verifyingContract: args.domain.verifyingContract,
  });
  let signature: Hex;
  try {
    signature = await signer.signTypedDataAsync({
      domain: domainForWallet,
      types: args.types,
      primaryType: args.primaryType,
      message: args.message,
      account: siwe.eoa,
    });
  } catch (e) {
    // If MetaMask refused because the account isn't permitted (or
    // doesn't exist in the wallet), give the user a one-click path
    // to grant permission via the standard picker.
    const msg = e instanceof Error ? e.message : String(e);
    const looksLikeMissingPermission =
      /unauthor|permission|not.*found|unknown account/i.test(msg);
    if (looksLikeMissingPermission && signer.promptSwitchWalletAccount) {
      await signer.promptSwitchWalletAccount();
      // Retry once with the pinned account.
      signature = await signer.signTypedDataAsync({
        domain: domainForWallet,
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
        account: siwe.eoa,
      });
    } else {
      throw e;
    }
  }
  return { type: 'ecdsa', signer: siwe.eoa, signature };
}

export interface CeremonyResult {
  scheduleTx: Hex;
  /** Apply transaction hash. May be 0x00…00 for resumed/already-applied paths. */
  applyTx: Hex;
}

export interface ScheduleAndApplyArgs {
  /** The account whose custody is being modified (Org, Treasury, PSA). */
  account: Address;
  /** Which CustodyPolicy action to schedule + apply. */
  action: CustodyAction;
  /** The action's abi-encoded args blob (see packages/account-custody/src/actions.ts). */
  innerArgs: Hex;
  /**
   * One or more signers. Each contributes one QuorumSlot to both the
   * schedule and apply payloads. Order doesn't matter — `packQuorumSigs`
   * sorts ascending by signer address.
   */
  signers: CeremonySigner[];
  /**
   * Optional phase notifier. The set of phases is:
   *   - 'computing-hash' | 'signing-schedule' | 'submitting-schedule'
   *   - 'reading-eta' | 'signing-apply' | 'submitting-apply'
   * Callers can map these to UI affordances or ignore them.
   */
  setPhase?: (p: CeremonyPhase, signerIndex?: number) => void;
}

export type CeremonyPhase =
  | 'computing-hash'
  | 'signing-schedule'
  | 'submitting-schedule'
  | 'reading-eta'
  | 'signing-apply'
  | 'submitting-apply';

/** Identity (PIA or EOA) the seat will sign as. */
function signerIdentity(signer: CeremonySigner): Address | null {
  const passkeyAuth = getPasskeyAuth(signer.seat);
  if (passkeyAuth) return passkeyAuth.pia;
  const siwe = getSiweAuth(signer.seat);
  return siwe?.eoa ?? null;
}

/**
 * Reorder signers so that the one whose EOA matches the currently-
 * active wallet goes first. Cuts the number of MetaMask account
 * switches per ceremony in half for the common 2-of-2 SIWE case
 * (was 4: switch→sign→switch→sign per phase; now 2: sign→switch→sign).
 * Passkey signers don't trigger picker prompts so order doesn't
 * matter for them — we leave them where they are.
 */
function orderSignersByActiveWallet(signers: CeremonySigner[]): CeremonySigner[] {
  if (signers.length < 2) return signers;
  // Find the first signer that has a `getWalletAddress` returning the
  // currently-active EOA AND whose seat is SIWE-controlled (i.e. that
  // active EOA actually IS this signer's identity).
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i]!;
    const siwe = getSiweAuth(s.seat);
    if (!siwe) continue; // passkey signer, no switch needed
    const active = s.getWalletAddress?.();
    if (active && active.toLowerCase() === siwe.eoa.toLowerCase() && i > 0) {
      // Move this signer to the front.
      const reordered = [s, ...signers.filter((_, idx) => idx !== i)];
      return reordered;
    }
  }
  return signers;
}

export async function scheduleAndApply(
  args: ScheduleAndApplyArgs,
): Promise<CeremonyResult | { error: string }> {
  if (!config.custodyPolicy || !config.chainId) {
    return { error: 'custody policy / chain id missing' };
  }
  const { account, action, innerArgs, setPhase } = args;
  // Adaptive signer order — see orderSignersByActiveWallet doc.
  const signers = orderSignersByActiveWallet(args.signers);

  if (signers.length === 0) {
    return { error: 'at least one signer required' };
  }

  // Pre-flight 1: validate every signer's enrolment + sig method.
  for (let i = 0; i < signers.length; i++) {
    const s = signers[i]!;
    const passkeyAuth = getPasskeyAuth(s.seat);
    const siweAuth = getSiweAuth(s.seat);
    if (!passkeyAuth && !siweAuth) {
      return { error: `signer #${i + 1} has no enrolled auth method` };
    }
    if (passkeyAuth && !s.passkey) {
      return { error: `signer #${i + 1} has a passkey identity but no local DemoPasskey in storage` };
    }
    if (!passkeyAuth && !s.signTypedDataAsync) {
      return { error: `signer #${i + 1} is SIWE-only but no signTypedDataAsync was supplied` };
    }
  }

  // Pre-flight 2: every signer's identity must be a custodian of the
  // target account. Mismatch usually means a stale SeatClaim — fail
  // loudly so the user can reset state rather than chase an opaque
  // `AdminUnauthorizedSigner` revert from the relay endpoint.
  setPhase?.('computing-hash');
  for (let i = 0; i < signers.length; i++) {
    const ident = signerIdentity(signers[i]!);
    if (!ident) return { error: `signer #${i + 1} has no enrolled identity` };
    const onTarget = await readIsCustodian({ account, signer: ident });
    if (!onTarget) {
      return {
        error:
          `Stale state: signer #${i + 1}'s identity (${ident}) isn't a custodian of ` +
          `${account}. The seat was re-claimed after this account was deployed, so the local ` +
          `record points at a stale Smart Agent. Click "Reset demo" in the top bar (or clear ` +
          `localStorage) and re-deploy with the current seats.`,
      };
    }
  }

  const argsHash = keccak256(innerArgs);

  // Resume detection: if a matching un-executed scheduled change
  // already exists, skip the schedule step and apply against it.
  const lastChangeId = await readScheduledChangeCount({
    custodyPolicy: config.custodyPolicy,
    account,
  });
  let expectedChangeId = lastChangeId + 1n;
  let skipSchedule = false;
  let existingEta: bigint | null = null;
  const scanTo = lastChangeId > 5n ? lastChangeId - 5n : 0n;
  for (let id = lastChangeId; id > scanTo; id--) {
    const sc = await readScheduledChange({
      custodyPolicy: config.custodyPolicy,
      account,
      changeId: id,
    });
    if (
      sc.action === action &&
      sc.args.toLowerCase() === innerArgs.toLowerCase() &&
      !sc.executed &&
      !sc.cancelled
    ) {
      expectedChangeId = id;
      existingEta = sc.eta;
      skipSchedule = true;
      break;
    }
  }

  const domainSeparator = computeDomainSeparator({
    custodyPolicy: config.custodyPolicy,
    chainId: config.chainId,
  });
  const scheduleHash = hashScheduleCustodyChange({
    domainSeparator,
    message: { account, action, argsHash, changeId: expectedChangeId },
  });

  let resolvedEta: bigint;
  let scheduleTx: Hex;
  if (skipSchedule && existingEta !== null) {
    resolvedEta = existingEta;
    scheduleTx = ('0x' + '00'.repeat(32)) as Hex; // resumed; no fresh tx
  } else {
    setPhase?.('signing-schedule');
    const scheduleSlots: QuorumSlot[] = [];
    for (let i = 0; i < signers.length; i++) {
      setPhase?.('signing-schedule', i);
      const slot = await signCeremonyHash({
        signer: signers[i]!,
        domain: { chainId: config.chainId, verifyingContract: config.custodyPolicy },
        types: ScheduleCustodyChangeRequest,
        primaryType: 'ScheduleCustodyChangeRequest',
        message: { account, action, argsHash, changeId: expectedChangeId },
        hash: scheduleHash,
      });
      scheduleSlots.push(slot);
    }
    const scheduleSigs = packQuorumSigs(scheduleSlots);

    setPhase?.('submitting-schedule');
    const scheduleResult = await submitCeremonyTx({
      payload: encodeScheduleCall({ account, action, innerArgs, quorumSigs: scheduleSigs }),
      relayPath: '/session/custody-schedule',
      relayBody: {
        custodyPolicy: config.custodyPolicy,
        account,
        action,
        args: innerArgs,
        quorumSigs: scheduleSigs,
      },
      signers,
    });
    if (!scheduleResult.ok || !scheduleResult.transactionHash) {
      return { error: scheduleResult.reason || scheduleResult.error || 'schedule failed' };
    }
    scheduleTx = scheduleResult.transactionHash;

    setPhase?.('reading-eta');
    const scheduledChange = await readScheduledChange({
      custodyPolicy: config.custodyPolicy,
      account,
      changeId: expectedChangeId,
      waitForExistence: true,
    });
    if (scheduledChange.eta === 0n) {
      return { error: 'schedule landed but the change is not visible to the read-RPC yet — refresh + retry' };
    }
    resolvedEta = scheduledChange.eta;
  }

  const applyHash = hashApplyCustodyChange({
    domainSeparator,
    message: { account, action, argsHash, changeId: expectedChangeId, eta: resolvedEta },
  });

  setPhase?.('signing-apply');
  const applySlots: QuorumSlot[] = [];
  for (let i = 0; i < signers.length; i++) {
    setPhase?.('signing-apply', i);
    const slot = await signCeremonyHash({
      signer: signers[i]!,
      domain: { chainId: config.chainId, verifyingContract: config.custodyPolicy },
      types: ApplyCustodyChangeRequest,
      primaryType: 'ApplyCustodyChangeRequest',
      message: { account, action, argsHash, changeId: expectedChangeId, eta: resolvedEta },
      hash: applyHash,
    });
    applySlots.push(slot);
  }
  const applySigs = packQuorumSigs(applySlots);

  setPhase?.('submitting-apply');
  const applyResult = await submitCeremonyTx({
    payload: encodeApplyCall({ account, changeId: expectedChangeId, quorumSigs: applySigs }),
    relayPath: '/session/custody-apply',
    relayBody: {
      custodyPolicy: config.custodyPolicy,
      account,
      changeId: expectedChangeId.toString(),
      quorumSigs: applySigs,
    },
    signers,
  });
  if (!applyResult.ok || !applyResult.transactionHash) {
    return { error: applyResult.reason || applyResult.error || 'apply failed' };
  }
  return { scheduleTx, applyTx: applyResult.transactionHash };
}

/**
 * Submit a custody-policy call. Picks the first signer with a passkey
 * as the userOp dispatcher (gasless via paymaster); falls back to the
 * worker relay if no signer has a passkey. Either way the on-chain
 * authority is the packed `quorumSigs` blob — msg.sender doesn't
 * affect CustodyPolicy's check.
 */
async function submitCeremonyTx(args: {
  payload: Hex;
  relayPath: '/session/custody-schedule' | '/session/custody-apply';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  relayBody: any;
  signers: CeremonySigner[];
}): Promise<{ ok: boolean; transactionHash?: Hex; reason?: string; error?: string }> {
  if (!config.custodyPolicy) return { ok: false, error: 'custodyPolicy missing' };
  const passkeySigner = args.signers.find((s) => getPasskeyAuth(s.seat) && s.passkey);
  if (passkeySigner) {
    const outer = encodeExecuteCall({
      target: config.custodyPolicy,
      value: 0n,
      innerData: args.payload,
    });
    return executeCallFromAgent({
      sender: passkeySigner.seat.personAgent,
      passkey: passkeySigner.passkey!,
      callData: outer,
    });
  }
  return relayCustodyCall({ path: args.relayPath, body: args.relayBody });
}

/**
 * Generic relay helper — POSTs a CustodyPolicy schedule/apply call to
 * the demo-a2a worker, which submits via its deployer EOA.
 */
async function relayCustodyCall(args: {
  path: '/session/custody-schedule' | '/session/custody-apply';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}): Promise<{ ok: boolean; transactionHash?: Hex; reason?: string; error?: string }> {
  const baseUrl = config.demoA2aUrl;
  if (!baseUrl) return { ok: false, error: 'demo-a2a URL not configured' };
  const { ensureCsrfToken, csrfHeaders } = await import('./csrf');
  await ensureCsrfToken();
  const baseTrimmed = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${baseTrimmed}${args.path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(args.body),
  });
  const raw = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `relay HTTP ${res.status}`, reason: raw.slice(0, 120) };
  }
  if (!res.ok || body.ok !== true) {
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
      reason: typeof body.detail === 'string' ? body.detail : undefined,
    };
  }
  return { ok: true, transactionHash: body.transactionHash as Hex };
}
