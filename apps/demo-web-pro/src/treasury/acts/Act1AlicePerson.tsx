/**
 * Act 1 — Create a Person Smart Agent for a seat (spec 211 § 5 / 6f.1).
 *
 * Flow:
 *   1. Land on the act page — context card explains what\'s about to happen.
 *   2. Open ConnectionDialog (modal). Stage 'consent' disclosure:
 *      grantee / scope / limits / revoke note. ERC-7715-style.
 *   3. User clicks Allow. Stage 'working' — passkey ceremony, then deploy
 *      via demo-a2a / paymaster. Phase label updates as we progress.
 *   4. Stage 'success' — show deployed Person Smart Agent address + tx.
 *   5. User clicks Continue → claim seat + return to seat picker.
 *
 * The dialog stays mounted across the consent/working/success/error
 * stages so the visitor sees a single focused surface, mirroring
 * smart-agent\'s DelegationConsentCard + AuthGate overlay pattern.
 */

import { useEffect, useState } from 'react';
import { orgConfig, type SeatDef } from '../../org-config';
import {
  registerPasskeyForSeat,
  savePasskeyForSeat,
  getPasskeyForSeat,
} from '../../lib/passkey';
import { claimSeat, setActiveSeat } from '../../lib/seats';
import { deployPersonAgent } from '../../lib/deploy-person';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { ConnectionDialog, type ConnectionStage } from '../components/ConnectionDialog';
import { config } from '../../config';

type WorkingPhase = 'registering-passkey' | 'building-userop' | 'awaiting-receipt';

const PHASE_LABEL: Record<WorkingPhase, string> = {
  'registering-passkey': 'Registering passkey…',
  'building-userop': 'Building gasless deploy request…',
  'awaiting-receipt': 'Awaiting paymaster + chain confirmation…',
};

const PHASE_HINT: Record<WorkingPhase, string | undefined> = {
  'registering-passkey':
    'Your browser will prompt you with TouchID / FaceID / a security key. The credential never leaves your device.',
  'building-userop':
    'demo-a2a is composing the ERC-4337 user operation. You will be asked to sign one more time with the same passkey.',
  'awaiting-receipt':
    'The smart-agent paymaster sponsors the gas. No ETH needed.',
};

export function Act1AlicePerson({
  seatId,
  onComplete,
}: {
  seatId: string;
  onComplete: () => void;
}) {
  const seat = orgConfig.seats.find((s) => s.id === seatId);
  if (!seat) {
    return (
      <section className="card">
        <h2>Unknown seat: {seatId}</h2>
        <a href="#/">← Back to seat picker</a>
      </section>
    );
  }

  return <Act1Body seat={seat} onComplete={onComplete} />;
}

function Act1Body({ seat, onComplete }: { seat: SeatDef; onComplete: () => void }) {
  const [stage, setStage] = useState<ConnectionStage>('consent');
  const [workingPhase, setWorkingPhase] = useState<WorkingPhase>('registering-passkey');
  const [error, setError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<`0x${string}` | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [dialogOpen, setDialogOpen] = useState(true);

  const demoA2aReady = !!config.demoA2aUrl;
  const wrongChain = config.chainId !== undefined && config.chainId !== 84532;

  // If the visitor lands here for a seat they already claimed, skip the
  // dialog and let them switch context via the principal chip.
  useEffect(() => {
    const existing = getPasskeyForSeat(seat.id);
    if (existing?.account) {
      setDialogOpen(false);
    }
  }, [seat.id]);

  const runCeremony = async () => {
    setStage('working');
    setError(null);

    let passkey = getPasskeyForSeat(seat.id);
    if (!passkey) {
      setWorkingPhase('registering-passkey');
      try {
        passkey = await registerPasskeyForSeat(seat.id, seat.name);
        savePasskeyForSeat(seat.id, passkey);
      } catch (e) {
        setStage('error');
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    setWorkingPhase('building-userop');
    // brief tick so the new label shows even on very fast paths
    await new Promise((r) => setTimeout(r, 50));

    setWorkingPhase('awaiting-receipt');
    const result = await deployPersonAgent(passkey);
    if (!result.ok) {
      setStage('error');
      setError(result.reason || result.error);
      return;
    }

    claimSeat({
      seatId: seat.id,
      personAgent: result.deployedAddress,
      credentialIdDigest: passkey.credentialIdDigest,
      claimedAt: new Date().toISOString(),
    });
    setActiveSeat(seat.id);

    setDeployedAddress(result.deployedAddress);
    setTxHash(result.transactionHash);
    setStage('success');
  };

  const handleAccept = () => {
    if (!demoA2aReady || wrongChain) return;
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

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">
          Act 1 · Bootstrap · <LiveStatusBadge status="live" />
        </p>
        <h1>
          Claim the <strong>{seat.name}</strong> seat.
        </h1>
        <p>
          Register a passkey for {seat.name} and deploy {seat.name}\'s Person Smart Agent on
          Base Sepolia. The smart-agent paymaster sponsors the deploy — you don\'t need any
          ETH. Once deployed, {seat.name}\'s passkey is the only thing that can sign for
          {seat.name}\'s Person Smart Agent.
        </p>
      </div>

      {!demoA2aReady && (
        <p className="err" data-testid="act1-no-a2a">
          <strong>VITE_DEMO_A2A_URL</strong> is not set in this build. Act 1 needs the
          demo-a2a relayer to sponsor the gasless userOp.
        </p>
      )}

      {wrongChain && (
        <p className="err" data-testid="act1-wrong-chain">
          This demo targets <strong>Base Sepolia</strong>. Chain {config.chainId} is configured.
        </p>
      )}

      {!dialogOpen && (
        <section className="card">
          <p className="muted">
            This seat is already claimed. Use the <strong>Acting as ▾</strong> chip in the top
            bar to switch.
          </p>
          <button type="button" className="primary" onClick={onComplete}>
            ← Back to seat picker
          </button>
        </section>
      )}

      <ConnectionDialog
        open={dialogOpen}
        stage={stage}
        title={`Connect as ${seat.name}`}
        // Consent stage props
        scopeList={[
          `Sign every action taken by ${seat.name}\'s Person Smart Agent on Base Sepolia.`,
          `Authorize gasless transactions via the paymaster on ${seat.name}\'s behalf.`,
          `Be replaced via the Custody Council in Act 4 if this device is lost.`,
        ]}
        grantee={`${seat.name}\'s Person Smart Agent`}
        duration="as long as the passkey exists on this device"
        limits={[
          'Sign for the Organization or the Treasury — those have their own Smart Agents.',
          `Move ${orgConfig.name}\'s treasury funds directly — that requires stewardship from the Treasury (Acts 4–5).`,
          'Roam to another browser without re-enrollment — the passkey is bound to this device.',
        ]}
        revokeNote={`The Custody Council (Act 4) can rotate ${seat.name}\'s passkey at any time. No recovery seed needed.`}
        onAccept={handleAccept}
        onDecline={handleDecline}
        // Working stage props
        phaseLabel={PHASE_LABEL[workingPhase]}
        phaseHint={PHASE_HINT[workingPhase]}
        // Success stage props
        successAddress={deployedAddress ?? undefined}
        successTxHash={txHash ?? undefined}
        successExtra={
          stage === 'success' && deployedAddress ? (
            <p className="muted">
              {seat.name}\'s Person Smart Agent is live on Base Sepolia. Only {seat.name}\'s
              passkey can sign for it.
            </p>
          ) : undefined
        }
        onContinue={() => {
          setDialogOpen(false);
          onComplete();
        }}
        // Error stage props
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
