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
} from '@agenticprimitives/custody';
import {
  computeDomainSeparator,
  hashScheduleCustodyChange,
  hashApplyCustodyChange,
  encodeScheduleCall,
  encodeApplyCall,
} from './custody-flow';
import { executeCallFromAgent, encodeExecuteCall } from './execute-call';
import {
  readIsCustodian,
  readIsTrustee,
  readScheduledChange,
  readScheduledChangeCount,
} from './chain-reads';
import { config } from '../config';
import { assertWithPasskey, type DemoPasskey } from './passkey';
import { getPasskeyAuth, getSiweAuth, type SeatClaim } from './seats';

/**
 * Wallet's signTypedData callback (provided by the act via wagmi's
 * `useSignTypedData().signTypedDataAsync`). Decoupled from this module
 * so the helper doesn't need to mount a React hook context.
 */
export type SignTypedDataFn = (args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  domain: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  types: any;
  primaryType: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
  /**
   * Pin the signing account to the connection's specific EOA (not the
   * wallet's active selection). MetaMask signs `eth_signTypedData_v4`
   * with the named account when it's permitted on the connection, so a
   * 2-of-2 SIWE ceremony never needs the user to switch active accounts.
   */
  account?: `0x${string}`;
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
    const assertion = await assertWithPasskey(signer.passkey, args.hash);
    return {
      type: 'passkey',
      pia: passkeyAuth.pia,
      x: signer.passkey.pubKeyX,
      y: signer.passkey.pubKeyY,
      assertion,
    };
  }
  const siwe = getSiweAuth(signer.seat);
  if (!siwe || !signer.signTypedDataAsync) {
    throw new Error(
      'Seat has no signing method available — needs either a local DemoPasskey or a connected wallet + signTypedDataAsync callback.',
    );
  }
  // Account pinning (same fix as demo-web-pro, commit "pin SIWE signer
  // account to fix 2-of-2 ceremonies"): pass `siwe.eoa` to
  // signTypedDataAsync so the wallet signs with THAT specific account —
  // the connection's bound EOA — not whichever account is "active" in
  // the MetaMask UI. This removes the manual account-switching dance for
  // 2-of-2 SIWE (Alice's account active when we need Bob's signature).
  // If that account isn't permitted on the connection yet, the call
  // throws; we open the picker once so the user can grant it, then retry.
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
    const msg = e instanceof Error ? e.message : String(e);
    if (/unauthor|permission|not.*found|unknown account/i.test(msg) && signer.promptSwitchWalletAccount) {
      await signer.promptSwitchWalletAccount();
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
  /** The action's abi-encoded args blob (see packages/custody/src/actions.ts). */
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
  /**
   * Called once when the ceremony is about to sleep until eta has
   * elapsed. The argument is the wall-clock Unix-seconds target. UIs
   * can use this to render a countdown.
   */
  onWaitTarget?: (etaUnixSec: number) => void;
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

export async function scheduleAndApply(
  args: ScheduleAndApplyArgs,
): Promise<CeremonyResult | { error: string }> {
  if (!config.custodyPolicy || !config.chainId) {
    return { error: 'custody policy / chain id missing' };
  }
  const { account, action, innerArgs, signers, setPhase, onWaitTarget } = args;

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

  // Pre-flight 2: every signer's identity must be authorized for this
  // action on the target account. Action axis picks the check:
  //   - RecoverAccount (T6) → signer must be a TRUSTEE on CustodyPolicy
  //   - all other admin actions (T1-T5) → signer must be a CUSTODIAN on
  //     the target AgentAccount
  // The pre-flight catches stale SeatClaim state before we walk the
  // user through a passkey ceremony that's going to revert.
  setPhase?.('computing-hash');
  const isRecovery = action === CustodyAction.RecoverAccount;
  for (let i = 0; i < signers.length; i++) {
    const ident = signerIdentity(signers[i]!);
    if (!ident) return { error: `signer #${i + 1} has no enrolled identity` };
    const onTarget = isRecovery
      ? await readIsTrustee({ custodyPolicy: config.custodyPolicy, account, signer: ident })
      : await readIsCustodian({ account, signer: ident });
    if (!onTarget) {
      const role = isRecovery ? 'trustee' : 'custodian';
      return {
        error:
          `Stale state: signer #${i + 1}'s identity (${ident}) isn't a ${role} of ` +
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

  // CustodyPolicy enforces block.timestamp >= eta on apply. With short
  // safety delays (1-3s for demo accounts) the wall-clock often beats
  // the chain's block timestamp on the bundler's simulation, which
  // reverts with ProposalNotReady. Wait wall-clock-time past eta + a
  // ~3s buffer covering Base Sepolia's ~2s block cadence.
  const ETA_BUFFER_SEC = 3;
  const nowSec = Math.floor(Date.now() / 1000);
  const waitTargetSec = Number(resolvedEta) + ETA_BUFFER_SEC;
  if (nowSec < waitTargetSec) {
    const waitMs = (waitTargetSec - nowSec) * 1000;
    setPhase?.('reading-eta');
    onWaitTarget?.(waitTargetSec);
    await new Promise((r) => setTimeout(r, waitMs));
  }

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
