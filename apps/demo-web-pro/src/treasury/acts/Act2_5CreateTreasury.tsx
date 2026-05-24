/**
 * Act 2.5 — Create Acme Treasury (Service Smart Agent).
 *
 * Per spec 211 § 5 Act 2.5 + the 2026-05-22 mode-choice round:
 *   - Sender: the founder\'s Person Smart Agent (Alice\'s PSA).
 *     This is a transitional shape — Acme Construction\'s custodian set is
 *     just {Alice.PIA} at this point, so Alice\'s passkey can sign the
 *     required custody slot directly. Phase 6f.4 adds Bob\'s passkey and
 *     raises approvals required.
 *   - Calls factory.createAccountWithMode for the Treasury with:
 *       mode       = 1 (hybrid)        — Alice passkey identity as initial custodian
 *       custodians = [Alice.PIA]       — passkey-derived identity, not Org address
 *       trustees   = []                — added later by custody policy acts
 *   - Paymaster sponsors gas.
 *   - On success the Treasury address is saved in demo-state.
 *
 * The Org→Treasury delegation referenced in the spec is SIMULATED in
 * this phase — the delegation OBJECT is rendered in the success card
 * as a permission-style summary; the actual on-chain enforcement
 * pipeline lights up in phase 6f.7-6f.8.
 */

import { useEffect, useState } from 'react';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { getPasskeyAuth, getSiweAuth } from '../../lib/seats';
import { orgConfig } from '../../org-config';
import { loadActiveSeat, loadSeats, setActiveSeat } from '../../lib/seats';
import { loadOrg, loadTreasury, saveTreasury } from '../../lib/demo-state';
import { getPasskeyForSeat } from '../../lib/passkey';
import { claimPsaName } from '../../lib/claim-psa-name';
import {
  executeCallFromAgent,
  encodeExecuteCall,
} from '../../lib/execute-call';
import { predictAccountAddress, waitForCode } from '../../lib/chain-reads';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { shortAddress } from '../../components';
import { config } from '../../config';
import { getSessionSalt } from '../../lib/session-salt';

const TREASURY_NAME = 'Acme Treasury';

type WorkingPhase = 'preflight' | 'building-userop' | 'signing' | 'awaiting-receipt';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'preflight': 'Computing counterfactual Treasury address…',
  'building-userop': 'Building gasless deploy request…',
  'signing': 'Confirming with your passkey…',
  'awaiting-receipt': 'Awaiting paymaster + chain confirmation…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'preflight': 'The factory computes Treasury\'s deterministic address from Org + a stable salt.',
  'building-userop': 'demo-a2a composes the ERC-4337 user operation.',
  'signing': 'Your passkey authorizes the founder\'s Person Smart Agent to dispatch the Treasury deploy on Acme Construction\'s behalf.',
  'awaiting-receipt': 'The smart-agent paymaster sponsors the gas. No ETH needed.',
};

export function Act2_5CreateTreasury({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [phase, setPhase] = useState<WorkingPhase>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);
  const [treasuryName, setTreasuryName] = useState<string | null>(null);
  const [treasuryNameError, setTreasuryNameError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  const org = loadOrg();
  const activeSeatId = loadActiveSeat();
  const seats = loadSeats();
  // Same Alice-is-founder discipline as Act 2 — keeps the Treasury\'s
  // "deployed by" attribution aligned with the founder narrative even
  // though the deployer doesn\'t enter the Treasury custodian set.
  const aliceSeat = orgConfig.seats[0]!;
  const founder = seats[aliceSeat.id] ?? null;
  const founderName = aliceSeat.name;
  const aliceIsActive = activeSeatId === aliceSeat.id;

  const factoryAddress = config.factoryAddress;
  const custodyPolicyAddress = config.custodyPolicy;
  const demoA2aReady = !!config.demoA2aUrl;

  useEffect(() => {
    if (loadTreasury()) setDialogOpen(false);
  }, []);

  const runCeremony = async () => {
    if (!org || !founder || !factoryAddress || !custodyPolicyAddress) {
      setStage('error');
      setError('Preconditions missing — need Act 2 complete (Org deployed), an active seat, factory + custody policy addresses.');
      return;
    }
    const passkey = getPasskeyForSeat(aliceSeat.id);
    const alicePasskey = getPasskeyAuth(founder);
    const aliceSiwe = getSiweAuth(founder);
    if (alicePasskey && !passkey) {
      setStage('error');
      setError(`${founderName}\'s passkey enrolment is missing from this device. Try disconnecting + reclaiming the seat.`);
      return;
    }
    if (!alicePasskey && !aliceSiwe) {
      setStage('error');
      setError(`${founderName} has no enrolled auth method — re-claim her seat.`);
      return;
    }

    setStage('working');
    setError(null);
    setPhase('preflight');

    // Phase 6f.4 — Treasury's initial custodian set mirrors the Org's
    // shape: Alice's enrolled methods (passkey AND/OR wallet) become
    // the human-signer authorities. Per spec 212/213 the Treasury is
    // owned by Alice's identities, not by the Org's address; Org→Treasury
    // is a delegation relationship issued in Act 5.
    const custodians = aliceSiwe ? ([aliceSiwe.eoa] as Address[]) : ([] as Address[]);
    const aliceIdentityForSalt = alicePasskey?.pia ?? aliceSiwe?.eoa;
    if (!aliceIdentityForSalt) {
      setStage('error');
      setError('Founder has no enrolled identity — re-claim her seat.');
      return;
    }
    // Wave R0 — mode>0 requires ≥1 trustee at deploy. Self-trustee
    // bootstrap; Bob's identity is added via T6 admin in later acts.
    const initParams = {
      mode: 1, // hybrid — same shape as Org; threshold bumps to 2 in Act 4
      custodians: custodians,
      trustees: [aliceIdentityForSalt] as Address[],
      initialPasskeyCredentialIdDigest: alicePasskey?.credentialIdDigest ?? (('0x' + '00'.repeat(32)) as Hex),
      initialPasskeyX: alicePasskey?.pubKeyX ?? 0n,
      initialPasskeyY: alicePasskey?.pubKeyY ?? 0n,
    } as const;

    // Salt includes the Org address (so Treasury can't collide
    // across Orgs) AND the session salt (so Reset → re-deploy gets
    // a fresh Treasury even when the user reuses the same EOA).
    // See lib/session-salt.ts.
    const SALT_VERSION = 'v9-session-scoped';
    const sessionSalt = getSessionSalt();
    const salt = BigInt(
      '0x' +
        [...new TextEncoder().encode(
          `${TREASURY_NAME}:${org.address}:${aliceIdentityForSalt}:${SALT_VERSION}:${sessionSalt}`,
        )]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 16),
    );

    // 1-second T4 safety delay — same demo override as Act 2.
    // Wave R0 — the validator is factory-immutable; no per-call override.
    const factoryCallData = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAgentAccount',
      args: [initParams, [0, 0, 0, 0, 1, 0, 0] as const, salt],
    });

    // For now Alice\'s PSA dispatches directly. Once Acts 3-4 give the
    // Org real co-custody, the Org Smart Agent itself dispatches via a
    // proposeCustodyChange flow.
    const outerCallData = encodeExecuteCall({
      target: factoryAddress,
      value: 0n,
      innerData: factoryCallData,
    });

    setPhase('building-userop');
    await new Promise((r) => setTimeout(r, 30));
    setPhase('signing');

    let result: { ok: boolean; transactionHash?: `0x${string}`; reason?: string; error?: string };
    if (passkey && alicePasskey) {
      result = await executeCallFromAgent({
        sender: founder.personAgent,
        passkey,
        callData: outerCallData,
      });
    } else {
      const base = config.demoA2aUrl?.replace(/\/$/, '');
      if (!base) {
        setStage('error');
        setError('demo-a2a URL not configured');
        return;
      }
      const { ensureCsrfToken, csrfHeaders } = await import('../../lib/csrf');
      await ensureCsrfToken();
      const res = await fetch(`${base}/session/direct-deploy`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          mode: initParams.mode,
          custodians: initParams.custodians,
          trustees: initParams.trustees,
          initialPasskeyCredentialIdDigest: initParams.initialPasskeyCredentialIdDigest,
          initialPasskeyX: initParams.initialPasskeyX.toString(),
          initialPasskeyY: initParams.initialPasskeyY.toString(),
          timelockOverrides: [0, 0, 0, 0, 1, 0, 0],
          salt: salt.toString(),
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      result = {
        ok: res.ok && body.ok === true,
        transactionHash: body.transactionHash as `0x${string}` | undefined,
        error: typeof body.error === 'string' ? body.error : undefined,
        reason: typeof body.detail === 'string' ? body.detail : undefined,
      };
    }
    if (!result.ok) {
      setStage('error');
      setError(result.reason || result.error || 'deploy failed');
      return;
    }

    setPhase('awaiting-receipt');

    const treasuryAddress = await predictAccountAddress({
      factoryAddress,
      initParams,
      salt,
    });
    const deployed = await waitForCode(treasuryAddress);
    if (!deployed) {
      setStage('error');
      setError(
        `The submit tx succeeded (${result.transactionHash}) but the Treasury address ` +
          `${treasuryAddress} still has no code after polling. Refresh the page.`,
      );
      setTxHash((result.transactionHash ?? ('0x' + '00'.repeat(32))) as `0x${string}`);
      saveTreasury({
        address: treasuryAddress,
        txHash: (result.transactionHash ?? ('0x' + '00'.repeat(32))) as `0x${string}`,
        mode: 1,
        custodians: [
          ...(alicePasskey ? [alicePasskey.pia] : []),
          ...(aliceSiwe ? [aliceSiwe.eoa] : []),
        ],
        createdAt: new Date().toISOString(),
      });
      return;
    }

    saveTreasury({
      address: treasuryAddress,
      txHash: (result.transactionHash ?? ('0x' + '00'.repeat(32))) as `0x${string}`,
      mode: 1,
      custodians: [
        ...(alicePasskey ? [alicePasskey.pia] : []),
        ...(aliceSiwe ? [aliceSiwe.eoa] : []),
      ],
      createdAt: new Date().toISOString(),
    });

    setDeployedAddress(treasuryAddress);
    setTxHash((result.transactionHash ?? ('0x' + '00'.repeat(32))) as `0x${string}`);
    setStage('success');

    // Best-effort: auto-claim treasury.demo.agent for the new Treasury
    // PSA. Same passkey path as Act 2 (Alice's passkey is the founding
    // custodian). Non-blocking — failures surface inline.
    if (passkey) {
      // Number-suffix uniqueness per spec 220 § 5: treasury → treasury2 → …
      void (async () => {
        const claim = await claimPsaName({
          baseLabel: 'treasury',
          personAgent: treasuryAddress,
          passkey,
        });
        if (claim.ok) {
          setTreasuryName(claim.name);
        } else {
          setTreasuryNameError(claim.reason);
        }
      })();
    }
  };

  const handleAccept = () => {
    if (!demoA2aReady) return;
    void runCeremony();
  };

  const handleDecline = () => {
    setDialogOpen(false);
    onComplete();
  };

  const handleRetry = () => {
    setStage('consent');
    setError(null);
  };

  if (!org) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2.5 · Admin</p>
        <h1>Create the Organization first.</h1>
        <p>The Treasury is authorized by {orgConfig.name}. Run Act 2 before Act 2.5.</p>
        <a href="#/acts/create-org" className="primary">Go to Act 2 →</a>
      </section>
    );
  }

  if (!founder) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2.5 · Admin</p>
        <h1>No active seat.</h1>
        <p>Switch to a claimed seat in the top bar before continuing.</p>
        <a href="#/">← Back to seat picker</a>
      </section>
    );
  }

  const unclaimedSeats = orgConfig.seats.filter((s) => !seats[s.id]);
  if (unclaimedSeats.length > 0) {
    return (
      <section className="card">
        <p className="eyebrow">Act 2.5 · Admin</p>
        <h1>Claim every seat first.</h1>
        <p>
          Treasury deploys only when both admin seats are on board. Still open:{' '}
          <strong>{unclaimedSeats.map((s) => s.name).join(', ')}</strong>.
        </p>
        <a href="#/" className="primary">← Back to seat picker</a>
      </section>
    );
  }

  if (!aliceIsActive) {
    return (
      <section>
        <div className="hero">
          <p className="eyebrow">Act 2.5 · Admin · <LiveStatusBadge status="live" /></p>
          <h1>Switch to {founderName} to deploy the Treasury.</h1>
          <p>
            The Treasury is authorized by {orgConfig.name}, but custody still bottoms out at
            passkey identities. Right now only {founderName}'s passkey identity is available.
          </p>
        </div>
        <section className="card">
          <button
            type="button"
            className="primary"
            onClick={() => setActiveSeat(aliceSeat.id)}
            data-testid="act2_5-switch-to-alice"
          >
            Act as {founderName} →
          </button>
        </section>
      </section>
    );
  }

  const existing = loadTreasury();

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">
          Act 2.5 · Admin · <LiveStatusBadge status="live" />
        </p>
        <h1>
          Create <strong>{TREASURY_NAME}</strong>.
        </h1>
        <p>
          {orgConfig.name} deploys a separate Smart Agent to hold and disburse funds.
          {' '}{orgConfig.name} will be the Treasury\'s sole admin. The Treasury never holds
          its own keys — it acts on behalf of {orgConfig.name} (per spec 210\'s
          PROV-O <code>actedOnBehalfOf</code> relationship).
        </p>
      </div>

      {existing && !dialogOpen && (
        <section className="card">
          <p className="eyebrow">{TREASURY_NAME} · live</p>
          <h2>Already deployed.</h2>
          <dl className="kv">
            <dt>Treasury address</dt>
            <dd><code>{shortAddress(existing.address)}</code></dd>
            <dt>Owned by</dt>
            <dd><code>{shortAddress(org.address)}</code> · {orgConfig.name}</dd>
            <dt>Deploy tx</dt>
            <dd><code>{shortAddress(existing.txHash)}</code></dd>
          </dl>
          <p className="muted">
            Use <strong>Reset demo</strong> in the top bar to wipe and re-deploy.
          </p>
          <a href="#/" className="primary">← Back to seat picker</a>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Create ${TREASURY_NAME}`}
        scopeList={[
          `Deploy a new AgentAccount named "${TREASURY_NAME}" on Base Sepolia.`,
          `Set ${founderName}'s passkey identity as the initial Treasury custodian.`,
          `Establish the prov:actedOnBehalfOf link from the Treasury to ${orgConfig.name} in the audit trail.`,
        ]}
        grantee={`${TREASURY_NAME} (Service Smart Agent)`}
        duration="permanent on-chain identity, authorized by the Org"
        limits={[
          'Put any Smart Agent address in the Treasury custodian set — custody bottoms out at passkey identities.',
          `Issue payments yet — Acts 4 and 5 set up the stewardship pattern that lets Person Agents draft payments under caveats.`,
          `Treat ${orgConfig.name} as the literal custodian — the Org→Treasury relationship is stewardship/provenance, not custody.`,
        ]}
        revokeNote={`Act 4 adds Bob's passkey identity to Treasury custody and raises approvals required where needed.`}
        onAccept={handleAccept}
        onDecline={handleDecline}
        phaseLabel={PHASE_LABEL[phase]}
        phaseHint={PHASE_HINT[phase]}
        successAddress={deployedAddress ?? undefined}
        successTxHash={txHash ?? undefined}
        successExtra={
          stage === 'success' && deployedAddress ? (
            <>
              <p className="muted">
                {TREASURY_NAME} is live on Base Sepolia. It is authorized by {orgConfig.name}
                in the product model and initially custodied by {founderName}'s passkey identity.
              </p>
              <p className="muted small">
                The Org→Treasury "actedOnBehalfOf" delegation will be enforceable in
                phase 6f.7. For now this relationship is{' '}
                <strong>simulated</strong> at the runtime layer — the object exists
                on chain, the enforcement pipe is queued.
              </p>
              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#f9fafb',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <div>
                  <span style={{ color: '#6b7280' }}>Canonical Treasury Smart Agent:</span>{' '}
                  <code style={{ fontSize: 12 }}>{deployedAddress}</code>
                </div>
                <div style={{ marginTop: 4 }}>
                  <span style={{ color: '#6b7280' }}>Name (facet):</span>{' '}
                  {treasuryName ? (
                    <strong style={{ color: '#059669' }}>{treasuryName}</strong>
                  ) : treasuryNameError ? (
                    <span style={{ color: '#b45309' }}>
                      ⚠ auto-claim skipped — {treasuryNameError}
                    </span>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>
                      claiming treasury.demo.agent…
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : undefined
        }
        onContinue={() => {
          setDialogOpen(false);
          onComplete();
        }}
        errorMessage={error ?? undefined}
        onRetry={handleRetry}
        onCancel={() => {
          setDialogOpen(false);
          onComplete();
        }}
      />
    </section>
  );
}
