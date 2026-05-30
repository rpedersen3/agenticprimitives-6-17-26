// Wire shape of an ERC-7710 Delegation as JP holds it on the client side (ADR-0019).
//
// JP receives the delegation from the home as part of the OIDC token response and may
// later present it to the demo-a2a backend for delegated reads. JP does NOT redeem
// the delegation on-chain — that's the backend's job. The full Delegation type (with
// bigint salt) lives in `@agenticprimitives/delegation`; this file is the JSON-safe
// wire shape only. Trimmed in Wave H6+ — the redeem helpers / contract ABIs are not
// reachable from the slim demo-jp surface (ARCH-034 / SEC-032 cleanup).
import type { Caveat } from '@agenticprimitives/delegation';
import type { Address, Hex } from '@agenticprimitives/types';

/** Wire form of a Delegation (bigint salt → string) for transport / storage. */
export interface DelegationWire {
  delegator: Address;
  delegate: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: string;
  signature: Hex;
}
