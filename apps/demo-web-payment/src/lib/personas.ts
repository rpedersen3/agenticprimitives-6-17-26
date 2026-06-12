/**
 * The two personas in the x402 demo:
 *
 *  - Reader  — a Person SA custodied by the connected wallet. Holds USDC and
 *              signs the payment delegation that authorizes the charge.
 *  - Provider — a Person SA whose treasury receives the USDC. Custodied by an
 *              ephemeral demo EOA (generated + held in sessionStorage); it only
 *              ever *receives* — it signs nothing — so an in-tab key is enough.
 *
 * Both deploy gaslessly through demo-a2a's permissionless `direct-deploy`
 * (mode=0, EOA custodian). Different custodians ⇒ different CREATE2 addresses,
 * so reader and provider never collide even though one wallet drives the demo.
 */

import { type Address } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { deployPersonAgent } from './deploy-person';

const PROVIDER_PK_KEY = 'demo-web-payment:provider-pk';

/** Stable-within-tab provider EOA (receives USDC; never signs). */
export function providerEoa(): Address {
  let pk = sessionStorage.getItem(PROVIDER_PK_KEY);
  if (!pk) {
    pk = generatePrivateKey();
    sessionStorage.setItem(PROVIDER_PK_KEY, pk);
  }
  return privateKeyToAccount(pk as `0x${string}`).address;
}

export interface PersonaDeploy {
  ok: true;
  address: Address;
}
export interface PersonaError {
  ok: false;
  error: string;
}

/** Deploy (or re-resolve) a Person SA custodied by a single EOA. Gasless. */
export async function deployPersona(custodian: Address): Promise<PersonaDeploy | PersonaError> {
  const res = await deployPersonAgent({ custodians: [custodian] });
  if (!res.ok) return { ok: false, error: res.reason ? `${res.error}: ${res.reason}` : res.error };
  return { ok: true, address: res.deployedAddress };
}
