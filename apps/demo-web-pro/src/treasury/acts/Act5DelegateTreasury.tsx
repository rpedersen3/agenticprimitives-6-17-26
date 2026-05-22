/**
 * Act 5 — Delegate Treasury Management (spec 211 § Act 5 / phase 6f.5).
 *
 * 🟡 LIVE object construction + signing · SIMULATED runtime enforcement.
 *
 * What lands:
 *   - Two Delegation envelopes are constructed (delegator = Treasury,
 *     delegate = Alice's PSA, Bob's PSA).
 *   - Each carries caveats: a 90-day timestamp window, a 0.05 ETH
 *     per-tx value cap, allowed-targets restricted to the Treasury
 *     itself, allowed-methods restricted to ERC-20 transfer.
 *   - The EIP-712 hash is computed (live, against the deployed
 *     AgentDelegationManager).
 *   - Each delegation is signed by Alice's enrolled method (passkey
 *     v=2 slot or SIWE v=27/28 slot) — single-signer for the demo
 *     since the Treasury's T4 quorum defaults to 1 of 2.
 *   - The signed delegations are stored in localStorage and rendered
 *     as Permission Cards in Act 6.
 *
 * What's deferred (📋 phase 6f.7):
 *   - On-chain registration via DelegationManager.
 *   - Runtime enforcement (the caveats are just data here; the
 *     enforcers don't actually gate calls until Treasury starts
 *     redeeming delegations via the DelegationManager).
 *   - Org's 2-of-2 quorum signing (today only Alice signs since the
 *     Treasury's T4 approvalsRequired stays at the n=2 default = 1
 *     after Act 4).
 */

import { useEffect, useState } from 'react';
import { keccak256, toHex, encodeAbiParameters, type Address, type Hex } from 'viem';
import { useAccount, useConnect, useConnectors, useDisconnect, useSignTypedData } from 'wagmi';
import { orgConfig } from '../../org-config';
import {
  getPasskeyAuth,
  getSiweAuth,
  loadSeats,
} from '../../lib/seats';
import { loadOrg, loadTreasury } from '../../lib/demo-state';
import { getPasskeyForSeat, assertWithPasskey } from '../../lib/passkey';
import {
  ROOT_AUTHORITY,
  buildCaveat,
  encodeAllowedMethodsTerms,
  encodeAllowedTargetsTerms,
  encodeTimestampTerms,
  encodeValueTerms,
  hashDelegation,
  delegationDomain,
  DELEGATION_EIP712_TYPES,
  type Caveat,
  type Delegation,
} from '@agenticprimitives/delegation';
import { packQuorumSigs } from '@agenticprimitives/custody';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { saveTreasuryDelegation, loadTreasuryDelegations } from '../../lib/treasury-delegations';
import { config } from '../../config';
import { shortAddress } from '../../components';

type WorkingPhase =
  | 'building'
  | 'hashing-alice'
  | 'signing-alice'
  | 'hashing-bob'
  | 'signing-bob'
  | 'persisting';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'building': 'Building delegation envelopes…',
  'hashing-alice': 'Hashing Alice\'s delegation (EIP-712)…',
  'signing-alice': 'Signing Alice\'s delegation…',
  'hashing-bob': 'Hashing Bob\'s delegation (EIP-712)…',
  'signing-bob': 'Signing Bob\'s delegation…',
  'persisting': 'Persisting permission cards…',
};

// 90-day window for the delegation.
const VALID_SECONDS = 90 * 24 * 60 * 60;
// Per-tx cap: 0.05 ETH (Base Sepolia funny-money).
const MAX_VALUE_WEI = 50_000_000_000_000_000n;
// ERC-20 transfer selector — handy default for a "Treasury can pay
// stewards" delegation. Real production usage would pick selectors
// matching the actual tokens involved.
const TRANSFER_SELECTOR: Hex = '0xa9059cbb';

export function Act5DelegateTreasury({ onComplete }: { onComplete: () => void }) {
  const seats = loadSeats();
  const org = loadOrg();
  const treasury = loadTreasury();
  const aliceSeat = orgConfig.seats[0]!;
  const bobSeat = orgConfig.seats[1]!;
  const aliceClaim = seats[aliceSeat.id];
  const bobClaim = seats[bobSeat.id];

  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [phase, setPhase] = useState<WorkingPhase>('building');
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);
  const [alreadyIssued, setAlreadyIssued] = useState(loadTreasuryDelegations().length >= 2);

  const { signTypedDataAsync } = useSignTypedData();
  const { address: walletAddress } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const connectors = useConnectors();

  useEffect(() => {
    setAlreadyIssued(loadTreasuryDelegations().length >= 2);
  }, []);

  if (!org || !treasury || !aliceClaim || !bobClaim) {
    return (
      <section className="card">
        <h2>Act 5 prerequisites missing</h2>
        <p className="muted">
          Need Org, Treasury, and both seats claimed. Go back through Acts 1 → 4 first.
        </p>
        <a href="#/" className="primary">← Back</a>
      </section>
    );
  }
  const alicePsa = aliceClaim.personAgent;
  const bobPsa = bobClaim.personAgent;

  // ── Build caveats (shared shape; only the delegate differs) ──────
  const issuedAt = Math.floor(Date.now() / 1000);
  const validUntil = issuedAt + VALID_SECONDS;

  const buildCaveats = (): Caveat[] => [
    buildCaveat(
      (config.timestampEnforcer ?? ('0x' + '00'.repeat(20)) as Address),
      encodeTimestampTerms(issuedAt, validUntil),
    ),
    buildCaveat(
      (config.valueEnforcer ?? ('0x' + '00'.repeat(20)) as Address),
      encodeValueTerms(MAX_VALUE_WEI),
    ),
    buildCaveat(
      (config.allowedTargetsEnforcer ?? ('0x' + '00'.repeat(20)) as Address),
      encodeAllowedTargetsTerms([treasury.address]),
    ),
    buildCaveat(
      (config.allowedMethodsEnforcer ?? ('0x' + '00'.repeat(20)) as Address),
      encodeAllowedMethodsTerms([TRANSFER_SELECTOR]),
    ),
  ];

  /**
   * Sign the delegation hash with Alice's enrolled method. Pack as a
   * single-slot quorum sig — Treasury's T4 defaults to 1-of-2 for n=2
   * custodians, so one signer is enough to issue. Future hardening
   * could require both Alice + Bob to sign.
   */
  const signDelegation = async (delegation: Delegation, delegationHash: Hex): Promise<Hex> => {
    const alicePasskeyAuth = getPasskeyAuth(aliceClaim);
    const aliceSiweAuth = getSiweAuth(aliceClaim);
    if (alicePasskeyAuth) {
      const alicePasskey = getPasskeyForSeat(aliceSeat.id);
      if (!alicePasskey) throw new Error('Alice\'s passkey is missing on this device.');
      const assertion = await assertWithPasskey(alicePasskey, delegationHash);
      return packQuorumSigs([
        {
          type: 'passkey',
          pia: alicePasskeyAuth.pia,
          x: alicePasskey.pubKeyX,
          y: alicePasskey.pubKeyY,
          assertion,
        },
      ]);
    }
    if (aliceSiweAuth) {
      if (!walletAddress) {
        // Auto-prompt MetaMask account picker.
        const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
        if (injected) {
          await disconnectAsync().catch(() => undefined);
          await connectAsync({ connector: injected });
        }
      }
      const active = walletAddress?.toLowerCase();
      if (!active || active !== aliceSiweAuth.eoa.toLowerCase()) {
        throw new Error(
          `MetaMask is on ${walletAddress ?? '(none)'} but Alice\'s seat expects ${aliceSiweAuth.eoa}. Switch accounts and retry.`,
        );
      }
      if (!config.delegationManager) throw new Error('delegationManager not configured');
      const sig = (await signTypedDataAsync({
        domain: delegationDomain(config.chainId ?? 84532, config.delegationManager),
        types: DELEGATION_EIP712_TYPES,
        primaryType: 'Delegation',
        message: {
          delegator: delegation.delegator,
          delegate: delegation.delegate,
          authority: delegation.authority,
          caveats: delegation.caveats.map((c) => ({
            enforcer: c.enforcer,
            terms: c.terms,
            args: c.args ?? '0x',
          })),
          salt: delegation.salt,
        },
      })) as Hex;
      return packQuorumSigs([{ type: 'ecdsa', signer: aliceSiweAuth.eoa, signature: sig }]);
    }
    throw new Error('Alice has no enrolled auth method to sign the delegation.');
  };

  const runCeremony = async () => {
    setStage('working');
    setError(null);
    if (!config.delegationManager || !config.chainId) {
      setStage('error');
      setError('delegationManager / chainId env not configured.');
      return;
    }

    try {
      setPhase('building');
      // Salt distinguishes Alice's delegation from Bob's so they hash
      // to distinct slots; use a deterministic value bound to (treasury, delegate).
      const saltFor = (delegate: Address): bigint => {
        const packed = encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'string' }],
          [treasury.address, delegate, 'act-5/v1'],
        );
        return BigInt(keccak256(packed));
      };

      const aliceCaveats = buildCaveats();
      const aliceDelegation: Delegation = {
        delegator: treasury.address,
        delegate: alicePsa,
        authority: ROOT_AUTHORITY,
        caveats: aliceCaveats,
        salt: saltFor(alicePsa),
        signature: ('0x' as Hex),
      };

      setPhase('hashing-alice');
      const aliceHash = hashDelegation(aliceDelegation, config.chainId, config.delegationManager);

      setPhase('signing-alice');
      aliceDelegation.signature = await signDelegation(aliceDelegation, aliceHash);

      const bobCaveats = buildCaveats();
      const bobDelegation: Delegation = {
        delegator: treasury.address,
        delegate: bobPsa,
        authority: ROOT_AUTHORITY,
        caveats: bobCaveats,
        salt: saltFor(bobPsa),
        signature: ('0x' as Hex),
      };

      setPhase('hashing-bob');
      const bobHash = hashDelegation(bobDelegation, config.chainId, config.delegationManager);

      setPhase('signing-bob');
      bobDelegation.signature = await signDelegation(bobDelegation, bobHash);

      setPhase('persisting');
      const expiryHuman = new Date(validUntil * 1000).toISOString().slice(0, 10);
      const summary = {
        actions: [
          'Initiate ERC-20 transfer calls from the Treasury (selector 0xa9059cbb).',
          'Read Treasury state via view calls.',
        ],
        limits: [
          'Per-call value cap: 0.05 ETH equivalent.',
          `Target restricted to Treasury ${shortAddress(treasury.address)}.`,
          `Window: now → ${expiryHuman} (90 days).`,
        ],
        notPermitted: [
          'Add or remove custodians.',
          'Change approvals required (admin-tier action).',
          'Issue further delegations on behalf of the Treasury.',
          'Move funds to addresses outside the Treasury contract\'s own transfer surface.',
        ],
        expiry: expiryHuman,
      };
      saveTreasuryDelegation({
        delegate: alicePsa,
        delegateLabel: `${aliceSeat.name}\'s Person Smart Agent`,
        delegation: aliceDelegation,
        delegationHash: aliceHash,
        issuedAt: new Date().toISOString(),
        summary,
      });
      saveTreasuryDelegation({
        delegate: bobPsa,
        delegateLabel: `${bobSeat.name}\'s Person Smart Agent`,
        delegation: bobDelegation,
        delegationHash: bobHash,
        issuedAt: new Date().toISOString(),
        summary,
      });
      setAlreadyIssued(true);
      setStage('success');
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Act 5 · Admin · <LiveStatusBadge status="simulated" /></p>
        <h1>Delegate Treasury management to {aliceSeat.name} + {bobSeat.name}.</h1>
        <p>
          Treasury issues two stewardship delegations — one for each Person Smart
          Agent — bounded by caveats: a 90-day window, a 0.05 ETH per-call cap, a
          target allowlist restricted to the Treasury itself, and a method
          allowlist restricted to ERC-20 <code>transfer</code>. Construction +
          hashing + signing all happen for real; runtime enforcement against
          on-chain enforcers lights up in phase 6f.7.
        </p>
      </div>

      {alreadyIssued && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">Already complete</p>
          <h2>Stewardship delegations issued.</h2>
          <p className="muted">
            Two delegations sit in local state, each signed by {aliceSeat.name}\'s enrolled
            method. The Org Dashboard (Act 6) renders them as permission cards.
          </p>
          <a href="#/acts/dashboard" className="primary">Open Org Dashboard (Act 6) →</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Issue Treasury delegations`}
        scopeList={[
          `Build two Delegation envelopes — one for ${aliceSeat.name}\'s PSA, one for ${bobSeat.name}\'s PSA.`,
          `Hash each via AgentDelegationManager EIP-712 domain.`,
          `${aliceSeat.name} signs both (single-slot quorum — Treasury T4=1).`,
          `Store the signed envelopes locally so Act 6 can render permission cards.`,
        ]}
        grantee={`${aliceSeat.name}\'s + ${bobSeat.name}\'s Person Smart Agents`}
        duration={`90 days from now`}
        limits={[
          'Move funds outside the Treasury contract\'s transfer surface.',
          'Add or remove custodians on Treasury or Org (those are admin-tier).',
          'Bypass the per-call value cap (0.05 ETH).',
          'Cross the target allowlist (only the Treasury itself).',
        ]}
        revokeNote={`Each delegation can be revoked by the Treasury via AgentDelegationManager.revokeDelegation. Phase 6f.7 wires the on-chain path.`}
        onAccept={() => {
          if (!alreadyIssued) void runCeremony();
        }}
        onDecline={() => {
          setDialogOpen(false);
          onComplete();
        }}
        acceptLabel={alreadyIssued ? 'Already issued' : 'Allow'}
        acceptDisabled={alreadyIssued}
        phaseLabel={PHASE_LABEL[phase]}
        successExtra={
          stage === 'success' ? (
            <p className="muted">
              Two Delegation envelopes signed and stored. Continue to the dashboard.
            </p>
          ) : undefined
        }
        onContinue={() => {
          setDialogOpen(false);
          onComplete();
        }}
        errorMessage={error ?? undefined}
        onRetry={() => {
          setStage('consent');
          setError(null);
        }}
        onCancel={() => {
          setDialogOpen(false);
          onComplete();
        }}
      />
    </section>
  );
}

// Suppress unused-import warning for `toHex` if vite-tree-shaker keeps it.
void toHex;
