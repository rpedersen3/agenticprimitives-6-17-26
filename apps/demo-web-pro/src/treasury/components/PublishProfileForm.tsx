import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import {
  buildRegisterProfileCall,
  buildSetProfileMetadataCall,
  canonicalProfileJson,
  profileContentHash,
  type AgentCard,
} from '@agenticprimitives/agent-identity';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import { config } from '../../config';
import { loadActiveSeat, loadSeats } from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { executeCallFromAgent } from '../../lib/execute-call';
import { NameDisplay } from './NameDisplay';

/**
 * "Publish profile for your PSA" form — exercises the full Phase 4
 * write path through the user's Smart Agent (PSA) authority:
 *
 *   1. Build AgentCard from form fields → canonical JSON → content hash.
 *   2. Encode JSON as a data: URI (no off-chain storage needed for the demo).
 *   3. Build register (first time) + setMetadata call builders from
 *      @agenticprimitives/agent-identity.
 *   4. Wrap each via buildExecuteCallData (@agenticprimitives/agent-account).
 *   5. Submit each via executeCallFromAgent → demo-a2a relay → passkey
 *      WebAuthn sign → on-chain.
 *   6. Refresh the agent-profile query to pick up the new state.
 */
export function PublishProfileForm() {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [agentKind, setAgentKind] = useState<'person' | 'org' | 'service' | 'treasury'>('person');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [registerTxHash, setRegisterTxHash] = useState<string | null>(null);
  const [metadataTxHash, setMetadataTxHash] = useState<string | null>(null);

  const psaInfo = useMemo(() => {
    const seatId = loadActiveSeat();
    if (!seatId) return null;
    const seats = loadSeats();
    const seat = seats[seatId];
    if (!seat) return null;
    const passkey = getPasskeyForSeat(seatId);
    if (!passkey) return null;
    return { seatId, personAgent: seat.personAgent, passkey };
  }, []);

  const profileAvailable = !!config.agentProfileResolver;
  const canSubmit =
    profileAvailable &&
    !!psaInfo &&
    displayName.trim().length > 0 &&
    state !== 'submitting';

  const submit = async () => {
    setError(null);
    setRegisterTxHash(null);
    setMetadataTxHash(null);
    if (!psaInfo || !config.agentProfileResolver) return;
    setState('submitting');
    try {
      const profile: AgentCard = {
        type: agentKind,
        displayName: displayName.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      const canonical = canonicalProfileJson(profile);
      const contentHash = profileContentHash(profile);
      // data: URI keeps storage out of the demo loop. fetchProfile
      // uses globalThis.fetch which supports data:// in browsers.
      const metadataURI = `data:application/json;base64,${btoa(canonical)}`;

      // Step 1: register (first-time only). We just call it
      // unconditionally — if the agent's already registered, register
      // reverts with AlreadyRegistered and we catch it.
      const registerCall = buildRegisterProfileCall({
        profileResolver: config.agentProfileResolver,
        agent: psaInfo.personAgent,
        displayName: displayName.trim(),
        description: description.trim(),
        agentKind: keccak256(toHex(agentKind)),
        profileSchemaURI: '',
      });
      const registerCalldata = buildExecuteCallData({
        to: registerCall.to as Address,
        value: registerCall.value,
        data: registerCall.data as Hex,
      });
      const registerResult = await executeCallFromAgent({
        sender: psaInfo.personAgent,
        passkey: psaInfo.passkey,
        callData: registerCalldata,
      });
      if (!registerResult.ok) {
        // If AlreadyRegistered, that's fine — proceed to setMetadata.
        // For everything else, fail.
        const isAlreadyRegistered =
          (registerResult.reason ?? '').toLowerCase().includes('alreadyregistered') ||
          (registerResult.reason ?? '').includes('0x3a81d6fc');
        if (!isAlreadyRegistered) {
          throw new Error(registerResult.reason ?? registerResult.error);
        }
      } else {
        setRegisterTxHash(registerResult.transactionHash);
      }

      // Step 2: setMetadata with the data: URI + computed hash.
      const metadataCall = buildSetProfileMetadataCall({
        profileResolver: config.agentProfileResolver,
        agent: psaInfo.personAgent,
        metadataURI,
        metadataHash: contentHash,
      });
      const metadataCalldata = buildExecuteCallData({
        to: metadataCall.to as Address,
        value: metadataCall.value,
        data: metadataCall.data as Hex,
      });
      const metadataResult = await executeCallFromAgent({
        sender: psaInfo.personAgent,
        passkey: psaInfo.passkey,
        callData: metadataCalldata,
      });
      if (!metadataResult.ok) {
        throw new Error(metadataResult.reason ?? metadataResult.error);
      }
      setMetadataTxHash(metadataResult.transactionHash);
      setState('done');
      queryClient.invalidateQueries({ queryKey: ['agent-profile', psaInfo.personAgent.toLowerCase()] });
    } catch (err) {
      setError((err as Error).message ?? String(err));
      setState('error');
    }
  };

  if (!profileAvailable) return null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: '1px solid #d1d5db',
        borderRadius: 8,
        background: '#ffffff',
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 14 }}>Publish your PSA's profile</strong>
        <code style={{ fontSize: 11, color: '#6b7280' }}>
          {config.agentProfileResolver?.slice(0, 8)}…
        </code>
      </div>

      {!psaInfo ? (
        <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
          Sign in + claim a seat (Act 1) first. The profile gets published from your PSA.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
            Active PSA:{' '}
            <code>
              <NameDisplay address={psaInfo.personAgent} />
            </code>{' '}
            (seat {psaInfo.seatId}). Profile is anchored on chain via{' '}
            <code>AgentProfileResolver.setMetadata</code>; the JSON is encoded as a{' '}
            <code>data:</code> URI so no off-chain storage is needed for the demo.
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            <input
              type="text"
              placeholder="display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={state === 'submitting'}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <input
              type="text"
              placeholder="description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={state === 'submitting'}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <select
              value={agentKind}
              onChange={(e) => setAgentKind(e.target.value as typeof agentKind)}
              disabled={state === 'submitting'}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            >
              <option value="person">person</option>
              <option value="org">org</option>
              <option value="service">service</option>
              <option value="treasury">treasury</option>
            </select>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: canSubmit ? '#3b82f6' : '#9ca3af',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {state === 'submitting' ? 'publishing…' : 'publish profile'}
            </button>
          </div>
          {(registerTxHash || metadataTxHash) && state === 'done' ? (
            <div style={{ marginTop: 8, fontSize: 11, color: '#059669' }}>
              ✓ profile published
              {registerTxHash ? (
                <> · register tx <code>{registerTxHash.slice(0, 10)}…</code></>
              ) : (
                <> · (already registered)</>
              )}
              {metadataTxHash ? (
                <> · metadata tx <code>{metadataTxHash.slice(0, 10)}…</code></>
              ) : null}
            </div>
          ) : null}
          {state === 'error' && error ? (
            <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626' }}>error: {error}</div>
          ) : null}
        </>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af' }}>
        Phase 4 SDK end-to-end: AgentCard → canonical JSON → keccak hash → data: URI →{' '}
        <code>buildRegisterProfileCall</code> + <code>buildSetProfileMetadataCall</code> →{' '}
        <code>buildExecuteCallData</code> (wraps in AgentAccount.execute) →{' '}
        <code>executeCallFromAgent</code> (demo-a2a relay + WebAuthn passkey sign).
      </div>
    </div>
  );
}
