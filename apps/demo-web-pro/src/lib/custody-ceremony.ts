/**
 * Shared schedule+apply ceremony helper.
 *
 * Acts 3 and 4 both run "schedule a custody change → wait the timelock
 * → apply it" loops against the CustodyPolicy module. The flow is
 * identical regardless of which CustodyAction is being applied
 * (AddPasskeyCredential, AddCustodian, ChangeApprovalsRequired, …) so
 * we keep one canonical implementation here and call it from both acts.
 *
 * Caller responsibilities:
 *   - Provide the SeatClaim of the signer (e.g. Alice — must have a
 *     passkey method to sign quorum slots; SIWE-only signing for admin
 *     actions ships in a later phase).
 *   - Provide the DemoPasskey for that signer (passkey enrolment data
 *     lives in local-only passkey.ts, separate from SeatClaim).
 *   - Provide the action + its abi-encoded innerArgs (see
 *     packages/custody/src/actions.ts for builders).
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
import { readIsCustodian, readScheduledChange, readScheduledChangeCount } from './chain-reads';
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
 * Sign a CustodyPolicy schedule/apply payload using whichever method
 * the seat has enrolled. Passkey preferred (gasless UX); SIWE used
 * only when no passkey method exists. Returns a packed quorum slot
 * the caller can hand to `packQuorumSigs`.
 */
async function signCeremonyHash(args: {
  seat: SeatClaim;
  seatPasskey?: DemoPasskey;
  /** Witness for the wallet path. Must be supplied if no passkey. */
  signTypedDataAsync?: SignTypedDataFn;
  /** Returns the wallet's current active address — for the safety guard. */
  getWalletAddress?: GetWalletAddressFn;
  /** Auto-opens MetaMask's account picker on wallet/seat mismatch. */
  promptSwitchWalletAccount?: PromptSwitchWalletAccountFn;
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
  const passkeyAuth = getPasskeyAuth(args.seat);
  if (passkeyAuth && args.seatPasskey) {
    const assertion = await assertWithPasskey(args.seatPasskey, args.hash);
    return {
      type: 'passkey',
      pia: passkeyAuth.pia,
      x: args.seatPasskey.pubKeyX,
      y: args.seatPasskey.pubKeyY,
      assertion,
    };
  }
  const siwe = getSiweAuth(args.seat);
  if (!siwe || !args.signTypedDataAsync) {
    throw new Error(
      'Seat has no signing method available — needs either a local DemoPasskey or a connected wallet + signTypedDataAsync callback.',
    );
  }
  // Guard: every signTypedData call uses the wallet's CURRENT active
  // address, not the address bound to this seat. If the user switched
  // MetaMask accounts (e.g. to claim Bob), the signature will recover
  // to the wrong address and the quorum check will revert with
  // `AdminUnauthorizedSigner`. On mismatch we trigger MetaMask's
  // account picker so the user can switch with one click; if they
  // still pick the wrong account (or dismiss), we throw a clear error.
  if (args.getWalletAddress) {
    let active = args.getWalletAddress();
    if (!active && args.promptSwitchWalletAccount) {
      active = await args.promptSwitchWalletAccount();
    }
    if (!active) {
      throw new Error(
        'No wallet account connected. Connect MetaMask + select the account bound to this seat, then retry.',
      );
    }
    if (active.toLowerCase() !== siwe.eoa.toLowerCase() && args.promptSwitchWalletAccount) {
      // Prompt for switch automatically.
      const after = await args.promptSwitchWalletAccount();
      if (after) active = after;
    }
    if (active.toLowerCase() !== siwe.eoa.toLowerCase()) {
      throw new Error(
        `Wrong MetaMask account active: wallet is on ${active} but this seat was claimed with ${siwe.eoa}. Open MetaMask → switch to ${siwe.eoa}, then retry the action.`,
      );
    }
  }
  const domainForWallet = custodyDomain({
    chainId: args.domain.chainId,
    verifyingContract: args.domain.verifyingContract,
  });
  const signature = await args.signTypedDataAsync({
    domain: domainForWallet,
    types: args.types,
    primaryType: args.primaryType,
    message: args.message,
  });
  return { type: 'ecdsa', signer: siwe.eoa, signature };
}

export interface CeremonyResult {
  scheduleTx: Hex;
  /** Apply transaction hash. May be 0x00…00 for resumed/already-applied paths. */
  applyTx: Hex;
}

export interface ScheduleAndApplyArgs {
  /** The account whose custody is being modified (Org or Treasury). */
  account: Address;
  /** Which CustodyPolicy action to schedule + apply. */
  action: CustodyAction;
  /** The action's abi-encoded args blob (see packages/custody/src/actions.ts). */
  innerArgs: Hex;
  /** The signer's SeatClaim — at least one auth method enrolled. */
  signer: SeatClaim;
  /** The signer's local passkey credential, if they have one. */
  signerPasskey?: DemoPasskey;
  /**
   * wagmi's `useSignTypedData().signTypedDataAsync` — only used if the
   * signer has no passkey method.
   */
  signTypedDataAsync?: SignTypedDataFn;
  /**
   * Returns wagmi's `useAccount().address`. When the signer is SIWE-only,
   * we verify the wallet's active account matches the seat's EOA before
   * prompting signTypedData; otherwise the signature recovers to a
   * different address and the on-chain quorum check reverts with
   * `AdminUnauthorizedSigner`.
   */
  getWalletAddress?: GetWalletAddressFn;
  /**
   * Opens MetaMask's account picker (via `wallet_requestPermissions`) so
   * the user can switch in one click when the wallet's active account
   * doesn't match the seat. Resolves to the post-switch address.
   */
  promptSwitchWalletAccount?: PromptSwitchWalletAccountFn;
  /**
   * Optional phase notifier. The set of phases is:
   *   - 'computing-hash' | 'signing-schedule' | 'submitting-schedule'
   *   - 'reading-eta' | 'signing-apply' | 'submitting-apply'
   * Callers can map these to UI affordances or ignore them.
   */
  setPhase?: (p: CeremonyPhase) => void;
}

export type CeremonyPhase =
  | 'computing-hash'
  | 'signing-schedule'
  | 'submitting-schedule'
  | 'reading-eta'
  | 'signing-apply'
  | 'submitting-apply';

export async function scheduleAndApply(
  args: ScheduleAndApplyArgs,
): Promise<CeremonyResult | { error: string }> {
  if (!config.custodyPolicy || !config.chainId) {
    return { error: 'custody policy / chain id missing' };
  }
  const { account, action, innerArgs, signer, signerPasskey, signTypedDataAsync, getWalletAddress, promptSwitchWalletAccount, setPhase } = args;
  const signerPasskeyAuth = getPasskeyAuth(signer);
  const signerSiweAuth = getSiweAuth(signer);
  if (!signerPasskeyAuth && !signerSiweAuth) {
    return { error: 'signer has no enrolled auth method' };
  }
  if (!signerPasskeyAuth && !signTypedDataAsync) {
    return { error: 'SIWE-only signer requires signTypedDataAsync callback' };
  }
  if (signerPasskeyAuth && !signerPasskey) {
    return { error: 'signer has a passkey identity but no local DemoPasskey in storage' };
  }
  const argsHash = keccak256(innerArgs);

  // Pre-flight: verify the signer's seat-bound identity (PIA or EOA)
  // is actually a custodian of the target account on chain. Mismatch
  // means the local SeatClaim was re-claimed after the target was
  // deployed (the target has the OLD identity, the seat has a NEW one).
  // Fail loudly so the user knows to reset state rather than chase
  // an opaque `AdminUnauthorizedSigner` revert from the relay endpoint.
  setPhase?.('computing-hash');
  const signerIdentity = signerPasskeyAuth?.pia ?? signerSiweAuth?.eoa;
  if (!signerIdentity) {
    return { error: 'signer has no enrolled identity' };
  }
  const signerOnTarget = await readIsCustodian({
    account,
    signer: signerIdentity,
  });
  if (!signerOnTarget) {
    return {
      error:
        `Stale state: the signer's identity (${signerIdentity}) isn't a custodian of ` +
        `${account}. The seat was re-claimed after this account was deployed, so the local ` +
        `record points at a stale Smart Agent. Click "Reset demo" in the top bar (or clear ` +
        `localStorage) and re-deploy the Org / Treasury with the current seat.`,
    };
  }
  const lastChangeId = await readScheduledChangeCount({
    custodyPolicy: config.custodyPolicy,
    account,
  });
  let expectedChangeId = lastChangeId + 1n;
  let skipSchedule = false;
  let existingEta: bigint | null = null;
  // Resume: scan recent un-executed matching changes (last 5).
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
    const scheduleSlot = await signCeremonyHash({
      seat: signer,
      seatPasskey: signerPasskey,
      signTypedDataAsync,
      getWalletAddress,
      promptSwitchWalletAccount,
      domain: { chainId: config.chainId, verifyingContract: config.custodyPolicy },
      types: ScheduleCustodyChangeRequest,
      primaryType: 'ScheduleCustodyChangeRequest',
      message: { account, action, argsHash, changeId: expectedChangeId },
      hash: scheduleHash,
    });
    const scheduleSigs = packQuorumSigs([scheduleSlot]);

    setPhase?.('submitting-schedule');
    // Branch on whether the signer has a passkey:
    //   - Passkey → dispatch via Alice.PSA.execute(...) userOp (paymaster pays gas)
    //   - SIWE-only → relay the call through demo-a2a's /session/custody-schedule
    //     endpoint (worker pays gas with the deployer EOA). CustodyPolicy's
    //     schedule/apply don't constrain msg.sender, so direct relay is safe.
    let scheduleResult: { ok: boolean; transactionHash?: Hex; reason?: string; error?: string };
    if (signerPasskey) {
      const scheduleCallData = encodeScheduleCall({
        account,
        action,
        innerArgs,
        quorumSigs: scheduleSigs,
      });
      const scheduleOuter = encodeExecuteCall({
        target: config.custodyPolicy,
        value: 0n,
        innerData: scheduleCallData,
      });
      scheduleResult = await executeCallFromAgent({
        sender: signer.personAgent,
        passkey: signerPasskey,
        callData: scheduleOuter,
      });
    } else {
      scheduleResult = await relayCustodyCall({
        path: '/session/custody-schedule',
        body: {
          custodyPolicy: config.custodyPolicy,
          account,
          action,
          args: innerArgs,
          quorumSigs: scheduleSigs,
        },
      });
    }
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
  const applySlot = await signCeremonyHash({
    seat: signer,
    seatPasskey: signerPasskey,
    signTypedDataAsync,
    domain: { chainId: config.chainId, verifyingContract: config.custodyPolicy },
    types: ApplyCustodyChangeRequest,
    primaryType: 'ApplyCustodyChangeRequest',
    message: { account, action, argsHash, changeId: expectedChangeId, eta: resolvedEta },
    hash: applyHash,
  });
  const applySigs = packQuorumSigs([applySlot]);

  setPhase?.('submitting-apply');
  let applyResult: { ok: boolean; transactionHash?: Hex; reason?: string; error?: string };
  if (signerPasskey) {
    const applyCallData = encodeApplyCall({
      account,
      changeId: expectedChangeId,
      quorumSigs: applySigs,
    });
    const applyOuter = encodeExecuteCall({
      target: config.custodyPolicy,
      value: 0n,
      innerData: applyCallData,
    });
    applyResult = await executeCallFromAgent({
      sender: signer.personAgent,
      passkey: signerPasskey,
      callData: applyOuter,
    });
  } else {
    applyResult = await relayCustodyCall({
      path: '/session/custody-apply',
      body: {
        custodyPolicy: config.custodyPolicy,
        account,
        changeId: expectedChangeId.toString(),
        quorumSigs: applySigs,
      },
    });
  }
  if (!applyResult.ok || !applyResult.transactionHash) {
    return { error: applyResult.reason || applyResult.error || 'apply failed' };
  }
  return { scheduleTx, applyTx: applyResult.transactionHash };
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
