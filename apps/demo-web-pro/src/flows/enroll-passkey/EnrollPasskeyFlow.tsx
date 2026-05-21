/**
 * Enroll backup passkey — adds a WebAuthn passkey as a second
 * authority on an existing AgentAccount, gaslessly.
 *
 * Sequence:
 *   1. User pastes the account address + names the passkey.
 *   2. Browser WebAuthn ceremony (`navigator.credentials.create`) —
 *      TouchID / FaceID / security-key prompt. The platform stores
 *      the private key; we capture the public key + credentialId.
 *   3. Build calldata: account.execute(account, 0, addPasskey(cid, x, y)).
 *      Inner addPasskey is `onlySelf` on AgentAccount; the outer
 *      execute self-call satisfies that gate when routed via UserOp.
 *   4. useGaslessTx submits via demo-a2a relayer + paymaster sponsorship.
 *      User signs the userOp hash; pays NO gas.
 *
 * After enrollment the passkey lives in localStorage + on-chain in
 * AgentAccount._passkeys mapping. Future flows (sign typed data,
 * recover account, etc.) can use it as a second authority.
 */

import { useMemo, useState } from 'react';
import { useAccount, useChainId, useReadContract, useSwitchChain } from 'wagmi';
import { encodeFunctionData, isAddress, type Address, type Hex } from 'viem';
import { config as deploymentConfig } from '../../config';
import { shortAddress } from '../../components';
import { useGaslessTx } from '../../lib/gasless';
import { registerPasskey, savePasskey, type DemoPasskey } from '../../lib/passkey';

const accountAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'addPasskey',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'credentialIdDigest', type: 'bytes32' },
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'hasPasskey',
    stateMutability: 'view',
    inputs: [{ name: 'credentialIdDigest', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'passkeyCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isOwner',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

type Phase = 'configure' | 'webauthn' | 'building' | 'signing' | 'submitting' | 'done';

export function EnrollPasskeyFlow() {
  const { address: signerAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const gasless = useGaslessTx();

  const expectedChainId = deploymentConfig.chainId;
  const wrongChain = expectedChainId !== undefined && chainId !== expectedChainId;

  const [accountInput, setAccountInput] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('configure');
  const [registeredPasskey, setRegisteredPasskey] = useState<DemoPasskey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accountAddr = isAddress(accountInput) ? (accountInput as Address) : null;

  // Verify the connected EOA is actually an owner of the target account —
  // addPasskey is onlySelf; the userOp's signature has to validate as an owner.
  const { data: connectedIsOwner } = useReadContract({
    address: accountAddr ?? undefined,
    abi: accountAbi,
    functionName: 'isOwner',
    args: signerAddress ? [signerAddress] : undefined,
    query: { enabled: !!accountAddr && !!signerAddress },
  });

  const { data: passkeyCount, refetch: refetchPasskeyCount } = useReadContract({
    address: accountAddr ?? undefined,
    abi: accountAbi,
    functionName: 'passkeyCount',
    query: { enabled: !!accountAddr },
  });

  const ready =
    isConnected &&
    !wrongChain &&
    !!accountAddr &&
    connectedIsOwner === true &&
    label.trim().length > 0;

  const handleEnroll = async () => {
    if (!ready || !accountAddr) return;
    setError(null);
    setPhase('webauthn');
    try {
      // 1. WebAuthn ceremony (browser prompts TouchID / FaceID / security key).
      const passkey = await registerPasskey(label.trim());
      setRegisteredPasskey(passkey);

      // 2. Build calldata: account.execute(account, 0, addPasskey(cid, x, y))
      const inner = encodeFunctionData({
        abi: accountAbi,
        functionName: 'addPasskey',
        args: [passkey.credentialIdDigest, passkey.pubKeyX, passkey.pubKeyY],
      });
      const outer = encodeFunctionData({
        abi: accountAbi,
        functionName: 'execute',
        args: [accountAddr, 0n, inner],
      });

      // 3. Submit via gasless relayer.
      setPhase('building');
      const txHash = await gasless.submit({ sender: accountAddr, callData: outer });
      if (!txHash) {
        // gasless hook surfaces the error itself via gasless.error
        setPhase('configure');
        return;
      }

      // 4. Persist locally + refresh chain reads.
      savePasskey({ ...passkey, account: accountAddr });
      await refetchPasskeyCount();
      setPhase('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase('configure');
    }
  };

  const reset = () => {
    setPhase('configure');
    setRegisteredPasskey(null);
    setError(null);
    setLabel('');
    gasless.reset();
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Capability · Enroll backup passkey</p>
        <h1>Add a passkey as a second authority.</h1>
        <p>
          Gasless. Your wallet stays in control; the passkey becomes a second device-bound signer.
          Useful if you lose access to the wallet later — any owner OR passkey can authorize future
          calls. Powered by the smartAgentPaymaster, so your EOA pays nothing.
        </p>
      </div>

      {!isConnected && (
        <p className="muted">Connect a wallet first — its EOA must be an owner of the target account.</p>
      )}
      {isConnected && wrongChain && (
        <p className="err">
          Wallet is on chain <code>{chainId}</code>. This demo targets chain{' '}
          <code>{expectedChainId}</code> (Base Sepolia).{' '}
          <button
            onClick={() => expectedChainId && switchChain({ chainId: expectedChainId })}
            disabled={isSwitching}
            data-testid="enroll-passkey-switch-chain"
          >
            {isSwitching ? 'Switching…' : 'Switch chain'}
          </button>
        </p>
      )}

      <div className="split">
        <section className="card">
          <p className="eyebrow">Configure</p>
          <h2>Account + passkey label</h2>
          <label className="field">
            <span>AgentAccount</span>
            <input
              value={accountInput}
              onChange={(e) => setAccountInput(e.target.value.trim())}
              placeholder="0x…"
              data-testid="enroll-passkey-account"
              spellCheck={false}
            />
            {accountInput && !accountAddr && (
              <small className="err">Not a valid 0x address.</small>
            )}
            {accountAddr && connectedIsOwner === false && (
              <small className="err">
                Your connected wallet ({signerAddress ? shortAddress(signerAddress) : '—'}) is NOT
                an owner of this account. The userOp signature would not validate; only an owner
                can authorize addPasskey.
              </small>
            )}
            {accountAddr && passkeyCount !== undefined && (
              <small className="muted">
                Current passkeys on this account: <code>{String(passkeyCount)}</code>
              </small>
            )}
          </label>

          <label className="field">
            <span>Passkey label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. iPhone 15 Pro, YubiKey #2"
              data-testid="enroll-passkey-label"
            />
            <small className="muted">
              Stored locally so the UI can identify this passkey later. Not committed to chain.
            </small>
          </label>

          <button
            className="primary"
            onClick={handleEnroll}
            disabled={!ready || phase !== 'configure'}
            data-testid="enroll-passkey-submit"
            style={{ marginTop: '1rem' }}
          >
            {phase === 'configure'
              ? 'Enroll passkey (gasless)'
              : phase === 'webauthn'
                ? 'Confirm passkey in browser…'
                : phase === 'building'
                  ? 'Building userOp…'
                  : gasless.state === 'signing'
                    ? 'Sign userOp in wallet…'
                    : 'Submitting…'}
          </button>
        </section>

        <section className="card">
          <p className="eyebrow">Steps</p>
          <h2>What happens when you click</h2>
          <ol className="status-list">
            <li className={phase !== 'configure' ? 'approved' : 'pending'}>
              <span>{phase !== 'configure' ? '✓' : '○'}</span>
              Create passkey via WebAuthn (browser prompt)
            </li>
            <li
              className={
                phase === 'building' || phase === 'signing' || phase === 'submitting' || phase === 'done'
                  ? phase === 'done'
                    ? 'approved'
                    : 'pending'
                  : ''
              }
            >
              <span>{phase === 'done' ? '✓' : phase === 'building' || phase === 'signing' || phase === 'submitting' ? '○' : ''}</span>
              Build UserOp · account.execute → addPasskey
            </li>
            <li
              className={
                phase === 'signing' || phase === 'submitting' || phase === 'done'
                  ? phase === 'done'
                    ? 'approved'
                    : 'pending'
                  : ''
              }
            >
              <span>{phase === 'done' ? '✓' : phase === 'signing' || phase === 'submitting' ? '○' : ''}</span>
              Sign userOp hash (wallet prompt)
            </li>
            <li className={phase === 'done' ? 'approved' : phase === 'submitting' ? 'pending' : ''}>
              <span>{phase === 'done' ? '✓' : phase === 'submitting' ? '○' : ''}</span>
              Submit via paymaster (free gas)
            </li>
          </ol>

          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
            Your EOA pays nothing — the smartAgentPaymaster sponsors the userOp from its EntryPoint
            deposit. WebAuthn ceremony happens entirely in the browser; the private key never
            leaves your device.
          </p>
        </section>
      </div>

      {phase === 'done' && registeredPasskey && (
        <section className="card" data-testid="enroll-passkey-done">
          <p className="eyebrow ok">Passkey enrolled</p>
          <h2>{registeredPasskey.label} · added to {shortAddress(accountAddr!)}</h2>
          <ul className="kv">
            <li>
              <strong>credentialIdDigest:</strong> <code>{registeredPasskey.credentialIdDigest}</code>
            </li>
            <li>
              <strong>pubKeyX:</strong> <code>{registeredPasskey.pubKeyX.toString().slice(0, 20)}…</code>
            </li>
            <li>
              <strong>pubKeyY:</strong> <code>{registeredPasskey.pubKeyY.toString().slice(0, 20)}…</code>
            </li>
            <li>
              <strong>Tx:</strong> <code>{gasless.txHash}</code>
            </li>
          </ul>
          <p className="muted" style={{ marginTop: '1rem' }}>
            On-chain passkey count for this account is now <code>{passkeyCount !== undefined ? String(passkeyCount) : '…'}</code>.
            You can verify in <a href={`#/flows/view-account?address=${accountAddr}`}>Inspect AgentAccount state →</a>.
          </p>
          <button onClick={reset} style={{ marginTop: '0.5rem' }}>
            Enroll another
          </button>
        </section>
      )}

      {(error || gasless.error) && (
        <p className="err" style={{ marginTop: '1rem' }} data-testid="enroll-passkey-error">
          {error || gasless.error}
        </p>
      )}

      <p className="muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
        Walkthrough: <code>docs/multi-sig/flows/enroll-passkey.md</code>
      </p>
    </section>
  );
}
