import { useEffect, useState } from 'react';
import { Act0Prereqs } from './acts/Act0Prereqs';
import { Act1SamOnboard } from './acts/Act1SamOnboard';
import { Act2DeclareLoss } from './acts/Act2DeclareLoss';
import { Act3ReplacePasskey } from './acts/Act3ReplacePasskey';
import { Act4Recovery } from './acts/Act4Recovery';
import { Act5Verify } from './acts/Act5Verify';
import { config } from './config';
import { loadSeats } from './lib/seats';
import { loadRecoveryState } from './lib/recovery-state';
import { useNamingClaimListener, useAgentNamingClient } from './lib/use-agent-naming';
import { getCachedName, setCachedName } from './lib/name-cache';
import type { Address } from 'viem';

type ActId = 'act0' | 'act1' | 'act2' | 'act3' | 'act4' | 'act5';

interface Step {
  id: ActId;
  number: number;
  title: string;
  blurb: string;
}

const STEPS: Step[] = [
  { id: 'act0', number: 0, title: 'Trustees', blurb: 'Enroll Alice + Bob' },
  { id: 'act1', number: 1, title: 'Onboard Sam', blurb: 'Recovery-capable Smart Agent' },
  { id: 'act2', number: 2, title: 'Credential lost', blurb: 'Mark passkey unusable' },
  { id: 'act3', number: 3, title: 'Replacement credential', blurb: 'Register new passkey' },
  { id: 'act4', number: 4, title: 'Rotate credential', blurb: 'Trustee-quorum custody op' },
  { id: 'act5', number: 5, title: 'Verify', blurb: 'Same SA, new credential' },
];

export function App() {
  const [activeAct, setActiveAct] = useState<ActId>(() => detectStartingAct());
  const [progress, setProgress] = useState<Set<ActId>>(() => detectProgress());

  // Refresh cached NameDisplay reads the moment a claim propagates.
  useNamingClaimListener();
  const namingClient = useAgentNamingClient();

  // Boot prime: for every enrolled seat's SA not already cached, do ONE
  // `reverseResolveString` (no log walk) so names render without each
  // NameDisplay firing its own read.
  useEffect(() => {
    if (!namingClient) return;
    const addrs: Address[] = [];
    for (const claim of Object.values(loadSeats())) {
      if (claim?.personAgent && !getCachedName(claim.personAgent)) {
        addrs.push(claim.personAgent);
      }
    }
    let cancelled = false;
    void (async () => {
      for (const addr of addrs) {
        if (cancelled) return;
        try {
          const name = await namingClient.reverseResolve(addr);
          if (!cancelled && name) setCachedName(addr, name);
        } catch { /* single miss doesn't block the others */ }
      }
    })();
    return () => { cancelled = true; };
  }, [namingClient]);

  useEffect(() => {
    const onUpdate = () => {
      setProgress(detectProgress());
      // Don't auto-advance the active tab — user navigates with
      // step rail or Continue buttons.
    };
    window.addEventListener('seats:update', onUpdate);
    window.addEventListener('recovery-state:update', onUpdate);
    return () => {
      window.removeEventListener('seats:update', onUpdate);
      window.removeEventListener('recovery-state:update', onUpdate);
    };
  }, []);

  const advance = (next: ActId) => {
    setActiveAct(next);
    setProgress(detectProgress());
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          agenticprimitives
          <span>credential recovery demo</span>
        </a>
        <div className="topbar-right">
          <ChainPill />
          <ResetButton />
        </div>
      </header>

      <DoctrineBanner />

      <div className="layout">
        <nav className="step-rail" aria-label="Acts">
          <ol>
            {STEPS.map((s) => {
              const unlocked = isUnlocked(s.id, progress);
              const stateClass = activeAct === s.id
                ? 'active'
                : progress.has(s.id)
                ? 'done'
                : unlocked
                ? ''
                : 'locked';
              return (
                <li key={s.id} className={stateClass}>
                  <button
                    type="button"
                    className="step-rail-link"
                    onClick={() => unlocked && setActiveAct(s.id)}
                    disabled={!unlocked}
                    aria-current={activeAct === s.id ? 'step' : undefined}
                    title={
                      !unlocked
                        ? `Complete the earlier acts first.`
                        : undefined
                    }
                  >
                    <span>
                      {progress.has(s.id) && activeAct !== s.id
                        ? '✓'
                        : !unlocked
                        ? '🔒'
                        : s.number}
                    </span>
                    <div className="step-rail-text">
                      <div className="step-rail-title">{s.title}</div>
                      <div className="step-rail-blurb">{s.blurb}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="main">
          {activeAct === 'act0' && <Act0Prereqs onComplete={() => advance('act1')} />}
          {activeAct === 'act1' && <Act1SamOnboard onComplete={() => advance('act2')} />}
          {activeAct === 'act2' && <Act2DeclareLoss onComplete={() => advance('act3')} />}
          {activeAct === 'act3' && <Act3ReplacePasskey onComplete={() => advance('act4')} />}
          {activeAct === 'act4' && <Act4Recovery onComplete={() => advance('act5')} />}
          {activeAct === 'act5' && <Act5Verify />}
        </main>
      </div>
    </div>
  );
}

/**
 * Doctrine banner — surfaces ADR-0011 / spec 221 framing directly in
 * the UI so the user reads the rule before the flow starts:
 *
 *   Canonical identity persists. Credentials rotate.
 *
 * The demo does not "recover an identity" — the Smart Agent's address
 * stays put. Recovery is a custody-policy-governed credential-set
 * change, not a delegation.
 */
function DoctrineBanner() {
  return (
    <div
      style={{
        background: '#eff6ff',
        borderBottom: '1px solid #bfdbfe',
        padding: '10px 16px',
        fontSize: 13,
        color: '#1e3a8a',
        lineHeight: 1.45,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <strong>Canonical identity persists. Credentials rotate.</strong>{' '}
        Your Smart Agent's address stays the same. Recovery binds a new
        control credential (passkey / EOA / hardware wallet) to that
        existing Smart Agent through its custody policy — it does
        <em> not </em>
        create a new agent, and it is <em>not</em> a delegation.{' '}
        <span style={{ opacity: 0.75 }}>
          (Doctrine: ADR-0011 · spec 221)
        </span>
      </div>
    </div>
  );
}

function ChainPill() {
  const ok = config.chainId === 84532;
  const label = ok ? 'Base Sepolia' : `chain ${config.chainId ?? '?'}`;
  return (
    <span className={`chain-pill ${ok ? 'ok' : 'danger'}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

function ResetButton() {
  const handleReset = () => {
    const ok = confirm(
      'Reset demo state? This clears all local seats, passkey mirrors, and recovery flow state. ' +
        'WebAuthn credentials in your OS keychain stay (you can ignore them).',
    );
    if (!ok) return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('agenticprimitives:demo-web-recovery:')) {
        localStorage.removeItem(key);
      }
    }
    location.reload();
  };
  return (
    <button type="button" className="btn-reset" onClick={handleReset} title="Clear local state">
      Reset demo
    </button>
  );
}

function detectStartingAct(): ActId {
  const seats = loadSeats();
  const recovery = loadRecoveryState();
  if (recovery.recoveredAt) return 'act5';
  if (recovery.applyTx) return 'act5';
  if (recovery.replacementCredential) return 'act4';
  if (recovery.declaredLostAt) return 'act3';
  if (seats['sam']) return 'act2';
  if (seats['alice'] && seats['bob']) return 'act1';
  return 'act0';
}

/**
 * An act is "unlocked" if itself or any earlier act has been completed,
 * OR if all earlier acts have been completed (so you can run THIS one
 * next). Locked acts are not navigable from the rail.
 */
function isUnlocked(id: ActId, progress: Set<ActId>): boolean {
  const order: ActId[] = ['act0', 'act1', 'act2', 'act3', 'act4', 'act5'];
  const idx = order.indexOf(id);
  if (idx === 0) return true; // Act 0 always available
  if (progress.has(id)) return true; // revisitable once done
  // Unlocked iff every prior act is done.
  for (let i = 0; i < idx; i++) {
    if (!progress.has(order[i]!)) return false;
  }
  return true;
}

function detectProgress(): Set<ActId> {
  const out = new Set<ActId>();
  const seats = loadSeats();
  const recovery = loadRecoveryState();
  if (seats['alice'] && seats['bob']) out.add('act0');
  if (seats['sam']) out.add('act1');
  if (recovery.declaredLostAt) out.add('act2');
  if (recovery.replacementCredential) out.add('act3');
  if (recovery.applyTx) out.add('act4');
  if (recovery.recoveredAt) out.add('act5');
  return out;
}
