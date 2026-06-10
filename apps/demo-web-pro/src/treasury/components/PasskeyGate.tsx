/**
 * One-tap gate for chained passkey signatures (WebAuthn transient-activation fix).
 *
 * Mounted once by TreasuryShell. A custody ceremony fires several passkey
 * assertions (schedule + apply, and a 2-of-2 step signs with both signers
 * back-to-back); all but the first lose the original click's user activation, so
 * WebKit/Safari reject or hang `navigator.credentials.get()`. The ceremony routes
 * every assertion through `runWithPasskeyGesture`, which shows this gate; the
 * user's tap runs the assertion INSIDE the click handler with fresh activation.
 *
 * Styling is inline (position:fixed, full-screen, high z-index) so the gate can
 * never be hidden behind the act UI — if it didn't show, the ceremony would stall.
 */
import { usePendingPasskeyGesture } from '../../lib/passkey-gate';

export function PasskeyGate() {
  const gesture = usePendingPasskeyGesture();
  if (!gesture) return null;
  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="passkey-gate-title"
        data-testid="passkey-gate"
        style={{
          background: '#fff',
          borderRadius: '14px',
          maxWidth: '420px',
          width: '100%',
          padding: '28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}
      >
        <h2 id="passkey-gate-title" style={{ margin: '0 0 10px', fontSize: '1.25rem' }}>
          Tap to sign
        </h2>
        <p style={{ margin: '0 0 8px', color: '#0f172a' }}>{gesture.label}</p>
        <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: '0.9rem' }}>
          Each on-chain custody step is its own signature, and your browser needs a fresh tap before
          each passkey prompt. Tap below, then approve with your passkey.
        </p>
        <button
          type="button"
          className="primary"
          autoFocus
          onClick={gesture.run}
          data-testid="passkey-gate-continue"
          style={{
            fontSize: '1rem',
            padding: '12px 24px',
            borderRadius: '10px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Continue with passkey
        </button>
      </div>
    </div>
  );
}
