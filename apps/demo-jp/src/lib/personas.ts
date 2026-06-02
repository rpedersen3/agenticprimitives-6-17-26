// Pete + Jill — the EOA-custodian personas for demo-jp.
//
// IA §1: each org agent is custodied by an EOA-backed person agent for the
// demo (Pete custodies Global Church; Jill custodies JP). Real deployments
// would use multi-credential custody per ADR-0011; for the demo we keep the
// key material visible in localStorage so the audit story remains pedagogical.
//
// Per the substrate's privacy doc D-46.1, NO personal data lives here —
// these EOAs are *substrate* identifiers that custody org SAs, not people.

import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';
import type { PrivateKeyAccount } from 'viem';

export type PersonaName = 'pete' | 'jill';

const STORAGE_PREFIX = 'demo-jp/persona/';

export interface PersonaState {
  name: PersonaName;
  privateKey: `0x${string}`;
  address: Address;
}

/** Load a persona from localStorage; mint a fresh one if absent. */
export function loadOrMintPersona(name: PersonaName): PersonaState {
  if (typeof localStorage === 'undefined') {
    return mintPersona(name);
  }
  const stored = localStorage.getItem(`${STORAGE_PREFIX}${name}`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { privateKey: `0x${string}` };
      const account = privateKeyToAccount(parsed.privateKey);
      return { name, privateKey: parsed.privateKey, address: account.address };
    } catch {
      // Fall through to mint
    }
  }
  const persona = mintPersona(name);
  localStorage.setItem(
    `${STORAGE_PREFIX}${name}`,
    JSON.stringify({ privateKey: persona.privateKey }),
  );
  return persona;
}

/** Deterministic mint for tests (uses a name-derived hex seed). */
export function mintPersona(name: PersonaName): PersonaState {
  // For tests + first-mount; production would mint via secure random.
  const seed = name === 'pete' ? 'a11ce' : 'b0b';
  const padded = seed.padStart(64, '0');
  const privateKey = `0x${padded}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return { name, privateKey, address: account.address };
}

/** Return a viem signer for the persona (used by signCredential, etc.). */
export function getPersonaSigner(persona: PersonaState): PrivateKeyAccount {
  return privateKeyToAccount(persona.privateKey);
}

/** Lifecycle hook: clear a persona (used during persona switcher reset). */
export function clearPersona(name: PersonaName): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(`${STORAGE_PREFIX}${name}`);
}
