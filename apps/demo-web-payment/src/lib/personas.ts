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

/**
 * Deploy (or re-resolve) a Person SA custodied by a single EOA. Gasless.
 *
 * Bounded same-call retry (ADR-0013 — a retry of the SAME call, not a fallback):
 * demo-a2a submits every direct-deploy from one shared deployer EOA, so two
 * deploys fired back-to-back (reader then provider) race on its nonce and the
 * second gets an `eth_sendRawTransaction` rejection. The failed tx never mines
 * (no nonce burned); waiting a few seconds for the first to settle and retrying
 * the SAME deploy succeeds.
 */
export async function deployPersona(
  custodian: Address,
  opts: { attempts?: number; delayMs?: number; saltSeed?: string } = {},
): Promise<PersonaDeploy | PersonaError> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 7000;
  let lastError = 'deploy_failed';
  for (let i = 0; i < attempts; i++) {
    const res = await deployPersonAgent({ custodians: [custodian], saltSeed: opts.saltSeed });
    if (res.ok) return { ok: true, address: res.deployedAddress };
    lastError = res.reason ? `${res.error}: ${res.reason}` : res.error;
    const transient = /direct_deploy_failed|sendRawTransaction|nonce|invalid parameters|replacement/i.test(lastError);
    if (!transient || i === attempts - 1) break;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, error: lastError };
}
