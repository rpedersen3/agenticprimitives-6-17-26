/**
 * Wallet rail (spec 243 §5.3/§5.5) — direct SA→SA transfer of a CLOSED mandate.
 *
 * Plain "checkout" pay: no budget delegation, no 402 round-trip. The payer SA executes a
 * single ERC-20 transfer to the payee. Nullifier + receipt are identical to x402 (EXC-D3
 * evidence symmetry). Ports the smart-agent `PledgeRegistry` cryptographic-rail pattern.
 */

import type { Address } from '@agenticprimitives/types';
import { mandateAmount } from '../mandate-sign.js';
import { buildClosedMandate, type ClosedMandateInput } from '../mandate.js';
import { buildErc20Transfer, type TransferPlan } from '../transfer.js';
import type { PaymentMandate } from '../index.js';

export const WALLET_RAIL = 'wallet' as const;

/** Build an unsigned closed wallet-rail mandate (sign with `signPaymentMandate`). */
export function buildWalletMandate(input: Omit<ClosedMandateInput, 'rail'>): PaymentMandate {
  return buildClosedMandate({ ...input, rail: 'wallet' });
}

/** The settlement plan for a closed wallet mandate: a direct transfer payer → payee. */
export function buildWalletTransferPlan(mandate: PaymentMandate): TransferPlan {
  return buildErc20Transfer(mandate.amountPolicy.asset.id as Address, mandate.payee, mandateAmount(mandate));
}
