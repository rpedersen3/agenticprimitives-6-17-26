// @agenticprimitives/delegated-signer — generic named delegated-signer resolution (spec 276 KCS-D6).
//
// Composes the four trust primitives into one answer to: "give me a signer for
// the NAMED identity X, authorized by delegation chain Y."
//   • agent-naming   → resolve the name to a Smart Agent (INJECTED `resolveName`)
//   • agent-account  → confirm that SA is a valid/deployed account (INJECTED `verifyAccount`)
//   • delegation     → verify the chain links the named SA to the signer key
//   • key-custody    → the operational signing key (e.g. a KMS per-subject signer)
//
// This is the GENERIC core that an app's bespoke trust-context orchestration
// (e.g. an external `trust-context.ts`) reduces to. It is vertical-agnostic: no
// TLD, registry, or product names. naming + account reach the network through
// INJECTED clients so the package stays a pure, unit-testable leaf (ADR-0021).
//
// SCOPE: this verifies name resolution, account validity, and the delegation
// chain's AUTHORITY LINKAGE (each link cryptographically binds its parent via
// the EIP-712 delegation hash, rooted at the named SA, terminating at the
// signer key). On-chain ERC-1271 signature verification of each link is a
// separate concern (`delegation.verifyAuthorization`); inject it upstream if
// you need it. Fail-closed throughout (ADR-0013).

import { bytesToHex, type Address, type Hex } from 'viem';
import { type Delegation, hashDelegation, ROOT_AUTHORITY } from '@agenticprimitives/delegation';
import type { KmsAccountBackend } from '@agenticprimitives/key-custody';

export const PACKAGE_NAME = '@agenticprimitives/delegated-signer';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/276-kms-consumer-surface.md';

/** Resolve a name (label) to its Smart Agent address, or `null` if it doesn't resolve.
 *  Injected so the package never hardcodes a registry / TLD (ADR-0021). */
export type NameResolver = (name: string) => Promise<Address | null>;

/** Confirm a Smart Agent is a valid, deployed account. Injected (agent-account client). */
export type AccountVerifier = (sa: Address) => Promise<boolean>;

export interface ResolveDelegatedSignerOpts {
  /** The name (label) of the delegating identity — opaque; resolved by `resolveName`. */
  name: string;
  /** The operational signing backend (e.g. a KMS per-subject signer from key-custody). */
  signer: KmsAccountBackend;
  /** The delegation chain: `[root, …, leaf]`. Root authorized by the named SA; leaf delegates to the signer. */
  delegationChain: Delegation[];
  /** Injected agent-naming resolver. */
  resolveName: NameResolver;
  /** Injected agent-account validity check. */
  verifyAccount: AccountVerifier;
  /** Chain id + DelegationManager address — required to recompute each link's authority hash. */
  chainId: number;
  delegationManager: Address;
}

export interface ResolvedDelegatedSigner {
  /** The operational signing key's EVM address (the chain's leaf delegate). */
  signerAddress: Address;
  /** The named identity's canonical Smart Agent (the chain's root delegator). */
  delegatorAgent: Address;
  /** Sign a 32-byte digest with the resolved signer; returns a 0x-hex `(r,s,v)` signature. */
  sign(digest: Uint8Array): Promise<Hex>;
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Resolve + verify a delegated signer for a named identity. Throws (fail-closed) on any
 *  unresolved name, invalid account, or broken/mis-rooted/mis-terminated delegation chain. */
export async function resolveDelegatedSigner(opts: ResolveDelegatedSignerOpts): Promise<ResolvedDelegatedSigner> {
  const { name, signer, delegationChain, resolveName, verifyAccount, chainId, delegationManager } = opts;

  if (delegationChain.length === 0) {
    throw new Error('resolveDelegatedSigner: delegationChain is empty');
  }

  const delegatorAgent = await resolveName(name);
  if (!delegatorAgent) {
    throw new Error(`resolveDelegatedSigner: name "${name}" did not resolve to a Smart Agent`);
  }
  if (!(await verifyAccount(delegatorAgent))) {
    throw new Error(`resolveDelegatedSigner: ${delegatorAgent} is not a valid/deployed account`);
  }

  const signerAddress = await signer.getSignerAddress();

  // Root link: must be a ROOT delegation issued BY the named SA.
  const root = delegationChain[0]!;
  if (!eqAddr(root.authority, ROOT_AUTHORITY)) {
    throw new Error('resolveDelegatedSigner: chain[0] is not a root delegation (authority != ROOT_AUTHORITY)');
  }
  if (!eqAddr(root.delegator, delegatorAgent)) {
    throw new Error('resolveDelegatedSigner: root delegator does not match the named agent');
  }

  // Continuity: each link is authorized by the previous (authority == hash(prev)) and continues it
  // (delegator == prev.delegate). This is the cryptographic chain binding.
  for (let i = 1; i < delegationChain.length; i++) {
    const prev = delegationChain[i - 1]!;
    const cur = delegationChain[i]!;
    if (!eqAddr(cur.delegator, prev.delegate)) {
      throw new Error(`resolveDelegatedSigner: chain[${i}].delegator != chain[${i - 1}].delegate`);
    }
    if (!eqAddr(cur.authority, hashDelegation(prev, chainId, delegationManager))) {
      throw new Error(`resolveDelegatedSigner: chain[${i}].authority does not bind chain[${i - 1}]`);
    }
  }

  // The chain MUST terminate at THIS signer key — otherwise the chain authorizes someone else.
  const leaf = delegationChain[delegationChain.length - 1]!;
  if (!eqAddr(leaf.delegate, signerAddress)) {
    throw new Error('resolveDelegatedSigner: chain leaf delegate != signer address');
  }

  return {
    signerAddress,
    delegatorAgent,
    async sign(digest: Uint8Array): Promise<Hex> {
      const { signature } = await signer.signA2AAction({ digest });
      return bytesToHex(signature);
    },
  };
}
