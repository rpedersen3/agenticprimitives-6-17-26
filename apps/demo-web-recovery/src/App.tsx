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

type ActId = 'act0' | 'act1' | 'act2' | 'act3' | 'act4' | 'act5';

interface Step {
  id: ActId;
  number: number;
  title: string;
  blurb: string;
}

const STEPS: Step[] = [
  { id: 'act0', number: 0, title: 'Prereqs', blurb: 'Enroll Alice + Bob' },
  { id: 'act1', number: 1, title: 'Sam joins', blurb: 'Recovery-capable PSA' },
  { id: 'act2', number: 2, title: 'Lost passkey', blurb: 'Mark Sam locked out' },
  { id: 'act3', number: 3, title: 'New passkey', blurb: 'Register replacement' },
  { id: 'act4', number: 4, title: 'Recover', blurb: 'Alice + Bob 2-of-2' },
  { id: 'act5', number: 5, title: 'Verify', blurb: 'New key authoritative' },
];

export function App() {
  const [activeAct, setActiveAct] = useState<ActId>(() => detectStartingAct());
  const [progress, setProgress] = useState<Set<ActId>>(() => detectProgress());

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
          <span>recovery demo</span>
        </a>
        <div className="topbar-right">
          <ChainPill />
          <ResetButton />
        </div>
      </header>

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
  if (recovery.replacementCredentialIdDigest) return 'act4';
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
  if (recovery.replacementCredentialIdDigest) out.add('act3');
  if (recovery.applyTx) out.add('act4');
  if (recovery.recoveredAt) out.add('act5');
  return out;
}
