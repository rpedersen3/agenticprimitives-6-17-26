/**
 * ConnectionDialog — ERC-7715-style permission disclosure + live
 * connection status, in one progressive modal.
 *
 * Ports two patterns from smart-agent:
 *   - DelegationConsentCard (apps/web/src/components/auth/DelegationConsentCard.tsx)
 *     plain-language "agent will be able to / granted to / limits / revoke"
 *   - AuthGate's overlay (apps/web/src/components/auth/AuthGate.tsx)
 *     spinner + phase label during the ceremony
 *
 * Stages, driven by the parent\'s `stage` prop:
 *   - 'consent'  — explicit Allow / Decline. Backdrop click = Decline.
 *   - 'working'  — spinner + phase label. Not dismissable (mid-ceremony).
 *   - 'success'  — checkmark + address + Continue.
 *   - 'error'    — error message + Retry / Cancel.
 *
 * The parent owns state; this component is presentational.
 */

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { shortAddress } from '../../components';

export type ConnectionStage = 'consent' | 'working' | 'success' | 'error';

export interface ConnectionDialogProps {
  /** Open/closed. When false, the dialog renders nothing. */
  open: boolean;
  /** Current stage of the connection. Drives which body renders. */
  stage: ConnectionStage;
  /** Dialog title shown in all stages. */
  title: string;

  // ─── Consent stage ─────────────────────────────────────────────────
  /** Plain-language list of what the user is authorizing. */
  scopeList?: string[];
  /** Who/what receives the authority. e.g. "Alice\'s Person Smart Agent". */
  grantee?: string;
  /** Duration phrase. e.g. "as long as the passkey exists". */
  duration?: string;
  /** Limits / explicit non-permissions. */
  limits?: string[];
  /** Revoke-instruction text shown above the buttons. */
  revokeNote?: string;
  /** Called when the user clicks Allow on the consent screen. */
  onAccept?: () => void;
  /** Called when the user declines or clicks the backdrop. */
  onDecline?: () => void;
  /** Label for the accept button. Defaults to "Allow". */
  acceptLabel?: string;
  /** When true, the accept button is disabled (e.g. waiting for wallet connection). */
  acceptDisabled?: boolean;
  /** Optional content rendered above the scope/limits — used by Act 1 for the auth-method picker. */
  preConsentSlot?: ReactNode;
  /**
   * Credential family being granted in this ceremony. Drives the scope
   * heading label so SIWE flows don't read "This passkey will be able
   * to". Default 'credential' — neutral, works for either path.
   */
  credentialKind?: 'passkey' | 'wallet' | 'credential';

  // ─── Working stage ─────────────────────────────────────────────────
  /** One-line phase label. e.g. "Registering Alice\'s passkey…". */
  phaseLabel?: string;
  /** Optional supplementary hint shown below the spinner. */
  phaseHint?: string;

  // ─── Success stage ─────────────────────────────────────────────────
  /** The deployed address (or any address-shaped success artifact). */
  successAddress?: `0x${string}`;
  /** Optional tx hash to show alongside the address. */
  successTxHash?: `0x${string}`;
  /** Optional extra detail rendered below the address. */
  successExtra?: ReactNode;
  /** Called on the Continue button in success stage. */
  onContinue?: () => void;

  // ─── Error stage ───────────────────────────────────────────────────
  /** Human-readable error message. */
  errorMessage?: string;
  /** Called on Retry. If omitted, button hidden. */
  onRetry?: () => void;
  /** Called on Cancel. */
  onCancel?: () => void;
  /**
   * Optional helper: when the error message indicates the user is on
   * the wrong MetaMask account, this callback triggers MetaMask's
   * account picker and then immediately re-runs `onRetry`. Surfaced
   * as a "Switch MetaMask account" button alongside Try again.
   */
  onSwitchWallet?: () => Promise<void>;
}

export function ConnectionDialog(props: ConnectionDialogProps) {
  const { open, stage } = props;
  const closeFn = useRef<(() => void) | null>(null);
  closeFn.current = stage === 'consent' ? props.onDecline ?? null : null;

  // ESC key closes when dismissable (consent only).
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeFn.current) closeFn.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="connection-dialog__backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && stage === 'consent' && props.onDecline) {
          props.onDecline();
        }
      }}
    >
      <div className="connection-dialog" data-testid="connection-dialog" data-stage={stage}>
        <header className="connection-dialog__header">
          <h2 id="connection-dialog-title">{props.title}</h2>
        </header>

        {stage === 'consent' && <ConsentBody {...props} />}
        {stage === 'working' && <WorkingBody {...props} />}
        {stage === 'success' && <SuccessBody {...props} />}
        {stage === 'error' && <ErrorBody {...props} />}
      </div>
    </div>
  );
}

function ConsentBody({
  scopeList = [],
  grantee = 'this Smart Agent',
  duration = 'as long as your credential exists',
  limits = [],
  revokeNote,
  onAccept,
  onDecline,
  acceptLabel = 'Allow',
  acceptDisabled = false,
  preConsentSlot,
  credentialKind = 'credential',
}: ConnectionDialogProps) {
  const scopeHeading =
    credentialKind === 'passkey' ? 'This passkey will be able to'
      : credentialKind === 'wallet' ? 'This wallet will be able to'
      : 'This authority will be able to';
  return (
    <div className="connection-dialog__body">
      {preConsentSlot}
      <p className="connection-dialog__lead">
        Granted to <strong>{grantee}</strong> · {duration}.
      </p>
      {scopeList.length > 0 && (
        <section aria-label="What this permits">
          <h3>{scopeHeading}</h3>
          <ul className="connection-dialog__scope">
            {scopeList.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}
      {limits.length > 0 && (
        <section className="connection-dialog__limits" aria-label="Limits">
          <h3>It cannot</h3>
          <ul>
            {limits.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {revokeNote && (
        <p className="connection-dialog__revoke muted">{revokeNote}</p>
      )}
      <div className="connection-dialog__actions">
        {onDecline && (
          <button
            type="button"
            className="secondary"
            onClick={onDecline}
            data-testid="connection-dialog-decline"
          >
            Decline
          </button>
        )}
        {onAccept && (
          <button
            type="button"
            className="primary"
            onClick={onAccept}
            data-testid="connection-dialog-accept"
            autoFocus
            disabled={acceptDisabled}
          >
            {acceptLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function WorkingBody({ phaseLabel, phaseHint }: ConnectionDialogProps) {
  return (
    <div className="connection-dialog__body connection-dialog__body--center">
      <div className="connection-dialog__spinner" aria-hidden />
      <p className="connection-dialog__phase" role="status" aria-live="polite">
        {phaseLabel ?? 'Working…'}
      </p>
      {phaseHint && <p className="connection-dialog__hint muted">{phaseHint}</p>}
    </div>
  );
}

function SuccessBody({
  successAddress,
  successTxHash,
  successExtra,
  onContinue,
}: ConnectionDialogProps) {
  return (
    <div className="connection-dialog__body">
      <div className="connection-dialog__success-icon" aria-hidden>
        ✓
      </div>
      {successAddress && (
        <dl className="kv">
          <dt>Smart Agent</dt>
          <dd>
            <code>{shortAddress(successAddress)}</code>
          </dd>
          {successTxHash && (
            <>
              <dt>Deploy tx</dt>
              <dd>
                <code>{shortAddress(successTxHash)}</code>
              </dd>
            </>
          )}
        </dl>
      )}
      {successExtra}
      {onContinue && (
        <div className="connection-dialog__actions">
          <button
            type="button"
            className="primary"
            onClick={onContinue}
            data-testid="connection-dialog-continue"
            autoFocus
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

function ErrorBody({ errorMessage, onRetry, onCancel, onSwitchWallet }: ConnectionDialogProps) {
  // Wallet-mismatch UX: when the error spells out "Wrong MetaMask
  // account" the user shouldn't have to leave the page. Pull the
  // target address out of the message so the button + hint can name
  // it explicitly — pasting hex is error-prone.
  const isWalletMismatch =
    !!errorMessage && /wrong metamask account/i.test(errorMessage);
  // Match "switch to 0x<40 hex>" — case-insensitive.
  const targetMatch = errorMessage?.match(/switch to (0x[0-9a-fA-F]{40})/);
  const targetAddr = targetMatch?.[1];
  const shortTarget = targetAddr ? `${targetAddr.slice(0, 6)}…${targetAddr.slice(-4)}` : '';

  const copyTarget = () => {
    if (!targetAddr) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(targetAddr);
    }
  };

  return (
    <div className="connection-dialog__body">
      <p className="connection-dialog__error" role="alert">
        <strong>Couldn\'t complete.</strong> {errorMessage ?? 'Unknown error.'}
      </p>
      {isWalletMismatch && targetAddr && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            fontSize: 12,
            color: '#78350f',
          }}
        >
          <div>
            <strong>You need MetaMask on:</strong>{' '}
            <code style={{ fontSize: 11 }}>{targetAddr}</code>
            <button
              type="button"
              onClick={copyTarget}
              style={{
                marginLeft: 6,
                padding: '1px 6px',
                fontSize: 10,
                background: 'transparent',
                border: '1px solid #92400e',
                borderRadius: 3,
                cursor: 'pointer',
              }}
              title="Copy address"
            >
              copy
            </button>
          </div>
          <div style={{ marginTop: 4, opacity: 0.85 }}>
            If MetaMask doesn't show this account, you may need to import
            it (its private key) into MetaMask first.
          </div>
        </div>
      )}
      <div className="connection-dialog__actions">
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        {isWalletMismatch && onSwitchWallet && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              void onSwitchWallet().then(() => onRetry?.());
            }}
            autoFocus
            data-testid="connection-dialog-switch-wallet"
          >
            {targetAddr ? `Switch to ${shortTarget}` : 'Switch MetaMask account'}
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            className={isWalletMismatch && onSwitchWallet ? 'secondary' : 'primary'}
            onClick={onRetry}
            autoFocus={!(isWalletMismatch && onSwitchWallet)}
            data-testid="connection-dialog-retry"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
