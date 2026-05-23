/**
 * Act 5 — Issue the demo's full delegation surface (phase 6f.5+ LIVE).
 *
 * One ceremony issues five Variant A delegations:
 *
 *   1. Alice.PSA → Bob.PSA     · scope: read Alice's PII (Person MCP)
 *   2. Bob.PSA   → Alice.PSA   · scope: read Bob's PII   (Person MCP)
 *   3. Org       → Alice.PSA   · scope: read Org sensitive data
 *   4. Org       → Bob.PSA     · scope: read Org sensitive data
 *   5. Treasury  → Alice.PSA   · scope: spend (target=Treasury, max 0.05 ETH, transfer)
 *   6. Treasury  → Bob.PSA     · same as #5
 *
 * Each envelope is signed by the delegator smart account (passkey v=2
 * or wallet ECDSA v=27/28 quorum slot — same `signCeremonyHash`
 * machinery as Acts 3/4). The Person MCP / Org MCP / Treasury redeem
 * paths verify these via ERC-1271 on the delegator address.
 *
 * Phase 6f.7 will add a 7th `usdc-quorum` delegation requiring a
 * QuorumCaveat (Bob co-signature). That ships in the next slice.
 */

import { useEffect, useState } from 'react';
import { keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';
import { useAccount, useConnect, useConnectors, useDisconnect, useSignTypedData } from 'wagmi';
import { orgConfig } from '../../org-config';
import { getPasskeyAuth, getSiweAuth, loadSeats } from '../../lib/seats';
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
import { encodeWebAuthnSignature } from '@agenticprimitives/agent-account';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import {
  saveDelegation,
  loadAllDelegations,
  type DelegationKind,
  type StoredDelegation,
} from '../../lib/delegations';
import { config } from '../../config';
import { shortAddress } from '../../components';

type WorkingPhase = 'building' | 'signing' | 'persisting';
const PHASE_LABEL: Record<WorkingPhase, string> = {
  building: 'Building delegation envelopes…',
  signing: 'Signing each delegation…',
  persisting: 'Persisting permission cards…',
};

// Window for every delegation.
const VALID_SECONDS = 90 * 24 * 60 * 60;
// Per-tx ETH cap (spend delegations only).
const MAX_VALUE_WEI = 50_000_000_000_000_000n;
// ERC-20 transfer selector — included on spend delegations so the
// allowed-methods enforcer would accept exactly that call.
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
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  // Only count delegations issued against the CURRENT Alice / Bob / Org
  // / Treasury addresses. Anything else is stranded state from an
  // earlier contract redeploy or salt bump — it'd pile up to 8+ but
  // none would actually validate, leaving the user stuck. Re-counting
  // against the live addresses lets the button re-enable automatically
  // when state goes stale.
  const currentAddresses = new Set(
    [aliceClaim?.personAgent, bobClaim?.personAgent, org?.address, treasury?.address]
      .filter((a): a is `0x${string}` => !!a)
      .map((a) => a.toLowerCase()),
  );
  const countFreshDelegations = (): number =>
    loadAllDelegations().filter(
      (d) =>
        currentAddresses.has(d.delegator.toLowerCase()) &&
        currentAddresses.has(d.delegate.toLowerCase()),
    ).length;

  const [alreadyIssued, setAlreadyIssued] = useState(() => countFreshDelegations() >= 8);

  const { signTypedDataAsync } = useSignTypedData();
  const { address: walletAddress } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const connectors = useConnectors();

  useEffect(() => {
    setAlreadyIssued(countFreshDelegations() >= 8);
    // Recompute when the current account set changes (e.g., after a
    // Reset demo + re-deploy lands new addresses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliceClaim?.personAgent, bobClaim?.personAgent, org?.address, treasury?.address]);

  if (!org || !treasury || !aliceClaim || !bobClaim) {
    return (
      <section className="card">
        <h2>Act 5 prerequisites missing</h2>
        <p className="muted">Need Org, Treasury, and both seats claimed.</p>
        <a href="#/" className="primary">← Back</a>
      </section>
    );
  }

  // ─── Caveat builders ────────────────────────────────────────────
  const issuedAt = Math.floor(Date.now() / 1000);
  const validUntil = issuedAt + VALID_SECONDS;
  const expiryHuman = new Date(validUntil * 1000).toISOString().slice(0, 10);

  const timestampCaveat = (): Caveat =>
    buildCaveat(
      (config.timestampEnforcer ?? ('0x' + '00'.repeat(20))) as Address,
      encodeTimestampTerms(issuedAt, validUntil),
    );
  const readScopeCaveats = (): Caveat[] => [timestampCaveat()];
  const treasurySpendCaveats = (): Caveat[] => [
    timestampCaveat(),
    buildCaveat(
      (config.valueEnforcer ?? ('0x' + '00'.repeat(20))) as Address,
      encodeValueTerms(MAX_VALUE_WEI),
    ),
    buildCaveat(
      (config.allowedTargetsEnforcer ?? ('0x' + '00'.repeat(20))) as Address,
      encodeAllowedTargetsTerms([treasury.address]),
    ),
    buildCaveat(
      (config.allowedMethodsEnforcer ?? ('0x' + '00'.repeat(20))) as Address,
      encodeAllowedMethodsTerms([TRANSFER_SELECTOR]),
    ),
  ];

  // ─── Signing path (passkey OR SIWE) ─────────────────────────────
  /**
   * Sign a delegation hash on behalf of an arbitrary `signerSeat` —
   * the seat whose authority is being delegated FROM. Used when the
   * delegator is Alice/Bob's PSA (PII delegations). For Org/Treasury
   * delegators we use whichever seat is currently active (since the
   * Org's quorum is 1-of-N by default, any single custodian's signature
   * suffices).
   */
  const signForSeat = async (
    signerSeat: typeof aliceClaim,
    delegation: Delegation,
    delegationHash: Hex,
  ): Promise<Hex> => {
    if (!signerSeat) throw new Error('signer seat missing');
    const passkeyAuth = getPasskeyAuth(signerSeat);
    const siweAuth = getSiweAuth(signerSeat);
    if (passkeyAuth) {
      // Delegation signatures are consumed by `AgentAccount.isValidSignature`
      // (ERC-1271), which expects ONE of:
      //   - raw 65-byte ECDSA (legacy fast path),
      //   - `0x00 || ECDSA` (type-prefixed ECDSA),
      //   - `0x01 || abi.encode(WebAuthnLib.Assertion)` (passkey).
      // The Safe-style `packQuorumSigs` shape is for the multi-slot
      // CustodyPolicy quorum surface, which is a DIFFERENT entry point
      // — using it here makes Alice's isValidSignature return 0xffffffff.
      const passkey = getPasskeyForSeat(signerSeat.seatId);
      if (!passkey) throw new Error(`Passkey for seat ${signerSeat.seatId} missing on this device.`);
      const assertion = await assertWithPasskey(passkey, delegationHash);
      return encodeWebAuthnSignature(assertion);
    }
    if (siweAuth) {
      // Wallet-account guard with auto-switch.
      let active = walletAddress;
      if (!active || active.toLowerCase() !== siweAuth.eoa.toLowerCase()) {
        const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
        if (injected) {
          await disconnectAsync().catch(() => undefined);
          const provider = (await injected.getProvider()) as
            | { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
            | undefined;
          if (provider?.request) {
            await provider
              .request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
              .catch(() => undefined);
          }
          const result = await connectAsync({ connector: injected });
          active = result.accounts[0];
        }
      }
      if (!active || active.toLowerCase() !== siweAuth.eoa.toLowerCase()) {
        throw new Error(
          `Wrong wallet account for seat ${signerSeat.seatId}: need ${siweAuth.eoa}, got ${active ?? '(none)'}.`,
        );
      }
      if (!config.delegationManager || !config.chainId) {
        throw new Error('delegationManager / chainId not configured');
      }
      const sig = (await signTypedDataAsync({
        domain: delegationDomain(config.chainId, config.delegationManager),
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
      // Raw 65-byte ECDSA matches the legacy fast path of
      // `AgentAccount._validateSig` — no extra wrapping needed.
      return sig;
    }
    throw new Error(`Seat ${signerSeat.seatId} has no enrolled signing method.`);
  };

  const saltFor = (delegator: Address, delegate: Address, kind: string): bigint => {
    const packed = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'string' }],
      [delegator, delegate, `act-5/${kind}/v1`],
    );
    return BigInt(keccak256(packed));
  };

  const issueOne = async (args: {
    kind: DelegationKind;
    delegator: Address;
    delegatorLabel: string;
    delegate: Address;
    delegateLabel: string;
    signerSeat: typeof aliceClaim;
    caveats: Caveat[];
    summary: StoredDelegation['summary'];
  }): Promise<void> => {
    if (!config.delegationManager || !config.chainId) {
      throw new Error('delegationManager / chainId not configured');
    }
    setStepLabel(`${args.delegatorLabel} → ${args.delegateLabel} (${args.kind})`);
    const delegation: Delegation = {
      delegator: args.delegator,
      delegate: args.delegate,
      authority: ROOT_AUTHORITY,
      caveats: args.caveats,
      salt: saltFor(args.delegator, args.delegate, args.kind),
      signature: '0x' as Hex,
    };
    setPhase('signing');
    const dHash = hashDelegation(delegation, config.chainId, config.delegationManager);
    delegation.signature = await signForSeat(args.signerSeat, delegation, dHash);
    saveDelegation({
      kind: args.kind,
      delegator: args.delegator,
      delegatorLabel: args.delegatorLabel,
      delegate: args.delegate,
      delegateLabel: args.delegateLabel,
      delegation,
      delegationHash: dHash,
      issuedAt: new Date().toISOString(),
      summary: args.summary,
    });
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
      const readSummary = (subjectLabel: string): StoredDelegation['summary'] => ({
        actions: [
          `Read ${subjectLabel} via the Person/Org MCP endpoint (delegate must present this token).`,
        ],
        limits: [
          `Window: now → ${expiryHuman} (90 days).`,
          'Read-only — the MCP server enforces no mutations.',
        ],
        notPermitted: [
          'Move funds.',
          'Add or remove custodians.',
          'Re-delegate this authority to a third party.',
        ],
        expiry: expiryHuman,
      });
      const spendSummary = (): StoredDelegation['summary'] => ({
        actions: ['ERC-20 transfer call against Treasury (selector 0xa9059cbb).'],
        limits: [
          `Per-call value cap: 0.05 ETH equivalent.`,
          `Target restricted to Treasury ${shortAddress(treasury.address)}.`,
          `Window: now → ${expiryHuman}.`,
        ],
        notPermitted: [
          'Change Treasury custody.',
          'Issue further delegations.',
          'Hit any target outside the Treasury contract.',
        ],
        expiry: expiryHuman,
      });

      // 1 + 2. Self-delegations — each Person Smart Agent issues an
      //        Alice→Alice / Bob→Bob delegation. Per spec 212 every
      //        data access flows through a delegation; for self-access
      //        the delegator and delegate are the same agent. Demos
      //        the "I authorize my agent to fetch my own data" path.
      await issueOne({
        kind: 'pii-read',
        delegator: aliceClaim.personAgent,
        delegatorLabel: `${aliceSeat.name}\'s Person Smart Agent`,
        delegate: aliceClaim.personAgent,
        delegateLabel: `${aliceSeat.name}\'s Person Smart Agent (self)`,
        signerSeat: aliceClaim,
        caveats: readScopeCaveats(),
        summary: readSummary(`${aliceSeat.name}\'s own PII`),
      });
      await issueOne({
        kind: 'pii-read',
        delegator: bobClaim.personAgent,
        delegatorLabel: `${bobSeat.name}\'s Person Smart Agent`,
        delegate: bobClaim.personAgent,
        delegateLabel: `${bobSeat.name}\'s Person Smart Agent (self)`,
        signerSeat: bobClaim,
        caveats: readScopeCaveats(),
        summary: readSummary(`${bobSeat.name}\'s own PII`),
      });

      // 3 + 4. Cross-person PII delegations — Alice signs Alice→Bob,
      //        Bob signs Bob→Alice. Each opens a Person MCP read scope
      //        on a peer's data through the same MCP tool.
      await issueOne({
        kind: 'pii-read',
        delegator: aliceClaim.personAgent,
        delegatorLabel: `${aliceSeat.name}\'s Person Smart Agent`,
        delegate: bobClaim.personAgent,
        delegateLabel: `${bobSeat.name}\'s Person Smart Agent`,
        signerSeat: aliceClaim,
        caveats: readScopeCaveats(),
        summary: readSummary(`${aliceSeat.name}\'s PII`),
      });
      await issueOne({
        kind: 'pii-read',
        delegator: bobClaim.personAgent,
        delegatorLabel: `${bobSeat.name}\'s Person Smart Agent`,
        delegate: aliceClaim.personAgent,
        delegateLabel: `${aliceSeat.name}\'s Person Smart Agent`,
        signerSeat: bobClaim,
        caveats: readScopeCaveats(),
        summary: readSummary(`${bobSeat.name}\'s PII`),
      });

      // 3 + 4. Org sensitive-data delegations — Org signs (any custodian
      //        suffices since T4=1-of-N by default). Active seat signs.
      const orgSigner = aliceClaim; // active seat — Alice was the founder
      await issueOne({
        kind: 'org-sensitive',
        delegator: org.address,
        delegatorLabel: orgConfig.name,
        delegate: aliceClaim.personAgent,
        delegateLabel: `${aliceSeat.name}\'s Person Smart Agent`,
        signerSeat: orgSigner,
        caveats: readScopeCaveats(),
        summary: readSummary(`${orgConfig.name}\'s sensitive data`),
      });
      await issueOne({
        kind: 'org-sensitive',
        delegator: org.address,
        delegatorLabel: orgConfig.name,
        delegate: bobClaim.personAgent,
        delegateLabel: `${bobSeat.name}\'s Person Smart Agent`,
        signerSeat: orgSigner,
        caveats: readScopeCaveats(),
        summary: readSummary(`${orgConfig.name}\'s sensitive data`),
      });

      // 5 + 6. Treasury spend delegations — single-signer issuance
      //        against Treasury's default 1-of-N quorum. Phase 6f.7 will
      //        upgrade these to QuorumCaveat-gated 2-of-2 redemption.
      const treasurySigner = aliceClaim;
      await issueOne({
        kind: 'treasury-spend',
        delegator: treasury.address,
        delegatorLabel: 'Acme Treasury',
        delegate: aliceClaim.personAgent,
        delegateLabel: `${aliceSeat.name}\'s Person Smart Agent`,
        signerSeat: treasurySigner,
        caveats: treasurySpendCaveats(),
        summary: spendSummary(),
      });
      await issueOne({
        kind: 'treasury-spend',
        delegator: treasury.address,
        delegatorLabel: 'Acme Treasury',
        delegate: bobClaim.personAgent,
        delegateLabel: `${bobSeat.name}\'s Person Smart Agent`,
        signerSeat: treasurySigner,
        caveats: treasurySpendCaveats(),
        summary: spendSummary(),
      });

      setPhase('persisting');
      setAlreadyIssued(true);
      setStepLabel(null);
      setStage('success');
    } catch (e) {
      setStage('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Act 5 · Admin · <LiveStatusBadge status="live" /></p>
        <h1>Issue the demo\'s delegation surface.</h1>
        <p>
          Eight Variant A delegations get signed in one ceremony:
        </p>
        <ul>
          <li>
            <strong>{aliceSeat.name}\'s PSA → {aliceSeat.name}\'s PSA</strong> and{' '}
            <strong>{bobSeat.name}\'s → {bobSeat.name}\'s</strong> — self-delegations
            so each Person Smart Agent can fetch its own PII through the same
            delegation-token path peers use.
          </li>
          <li>
            <strong>{aliceSeat.name}\'s PSA → {bobSeat.name}\'s PSA</strong> and reverse —
            cross-person read-PII on the Person MCP. Each Person Smart Agent grants
            the other access to their own PII record.
          </li>
          <li>
            <strong>{orgConfig.name} → {aliceSeat.name}/{bobSeat.name}\'s PSAs</strong> —
            read-sensitive-data on the Org MCP.
          </li>
          <li>
            <strong>Acme Treasury → {aliceSeat.name}/{bobSeat.name}\'s PSAs</strong> —
            ERC-20 transfer scope on Treasury (0.05 ETH per-call cap, 90-day window).
          </li>
        </ul>
        <p>
          Every envelope is signed via the same EIP-712 path the on-chain
          DelegationManager uses; the Person/Org MCP endpoints verify each
          via ERC-1271 on the delegator smart account.
        </p>
      </div>

      {alreadyIssued && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">Already complete</p>
          <h2>All six delegations issued.</h2>
          <p className="muted">
            Open the Org Dashboard to exercise them — fetch PII, fetch Org sensitive data,
            see the permission cards.
          </p>
          <a href="#/acts/dashboard" className="primary">Open Org Dashboard (Act 6) →</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title="Issue delegation surface"
        scopeList={[
          `Sign delegations from ${aliceSeat.name}\'s PSA, ${bobSeat.name}\'s PSA, ${orgConfig.name}, and Treasury.`,
          'Each delegation is EIP-712 hashed and verifiable via ERC-1271.',
          'Stored locally; the worker verifies them on every MCP call.',
          'No funds move during issuance — these are signed permission slips.',
        ]}
        grantee={`${aliceSeat.name} + ${bobSeat.name}\'s Person Smart Agents`}
        duration="90 days from now"
        limits={[
          'Move funds during issuance (this ceremony is metadata-only).',
          'Bypass the per-call value cap on spend delegations.',
          'Re-delegate authority outside this exchange.',
        ]}
        revokeNote="Any delegator can revoke via AgentDelegationManager.revokeDelegationByOwner. UI for that ships in 6f.7."
        onAccept={() => {
          if (!alreadyIssued) void runCeremony();
        }}
        onDecline={() => {
          setDialogOpen(false);
          onComplete();
        }}
        acceptLabel={alreadyIssued ? 'Already issued' : 'Sign all eight'}
        acceptDisabled={alreadyIssued}
        phaseLabel={`${PHASE_LABEL[phase]}${stepLabel ? ` — ${stepLabel}` : ''}`}
        successExtra={
          stage === 'success' ? (
            <p className="muted">
              All six delegations signed and stored. Continue to the dashboard to exercise them.
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
