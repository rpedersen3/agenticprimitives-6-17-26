/**
 * The x402 charge, wired to the live spec-272 substrate on Base Sepolia.
 *
 *   fund  →  approve budget (mint mandate)  →  access + pay (redeem)  →  read treasury
 *
 * The reader SA holds USDC. The reader mints an OPEN payment delegation
 * (`delegate = 0xa11`) caveated by the PaymentEnforcer (treasury-only,
 * per-charge + session caps, transfer-only) + timestamp/targets/methods. To
 * settle, the wallet submits `DelegationManager.redeemDelegation(...)`
 * directly: the DM (which the reader SA trusts for `execute`) runs the
 * PaymentEnforcer and moves USDC reader → provider treasury. No relayer, no
 * passkey — the only on-chain gas is the redemption tx the wallet signs.
 *
 * NOTE: production x402 scopes `delegate` to the *service* SA and the service
 * redeems via its own sponsored UserOp (spec 272 PAY-DEL-1). OPEN delegate is a
 * demo simplification — the PaymentEnforcer still fully gates every charge.
 */

import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  DelegationClient,
  buildPaymentMandateCaveats,
  describePaymentMandate,
  type Delegation,
  type PaymentMandateConsent,
} from '@agenticprimitives/delegation';
import {
  computeMandateId,
  x402,
  type PaymentMandate,
  type Hex32,
} from '@agenticprimitives/payments';
import { config } from '../config';
import { executeViaSa } from './agent-pay';
import { publicClient, delegationSigner, type PaymentWallet } from './wallet';

/** DelegationManager sentinel: delegate = address(0xa11) ⇒ any redeemer. */
const OPEN_DELEGATION = '0x0000000000000000000000000000000000000a11' as Address;

const USDC_DECIMALS = 6;
export function toUsdc(human: number): bigint {
  return BigInt(Math.round(human * 10 ** USDC_DECIMALS));
}
export function fromUsdc(raw: bigint): string {
  return (Number(raw) / 10 ** USDC_DECIMALS).toFixed(2);
}

const ERC20_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

/** Mint demo USDC straight into an address (MockUSDC.mint is permissionless). */
export async function fundWithUsdc(wallet: PaymentWallet, to: Address, amount: bigint): Promise<Hex> {
  const custodian = wallet.account?.address;
  if (!custodian) throw new Error('wallet not connected');
  return wallet.sendTransaction({
    account: custodian,
    to: config.mockUsdc,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'mint', args: [to, amount] }),
    chain: baseSepolia,
  });
}

export async function readUsdcBalance(addr: Address): Promise<bigint> {
  return publicClient.readContract({ address: config.mockUsdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] });
}

export interface PaymentBudget {
  /** signed delegation authorizing the charges */
  delegation: Delegation;
  /** human-readable consent the UI rendered */
  consent: PaymentMandateConsent;
}

/**
 * Approve a session budget: the reader signs an OPEN payment delegation scoped
 * to the provider's treasury. One signature unlocks repeated capped charges.
 */
export async function approvePaymentBudget(args: {
  wallet: PaymentWallet;
  treasurySa: Address;
  providerTreasury: Address;
  perCharge: bigint;
  sessionBudget: bigint;
}): Promise<PaymentBudget> {
  const custodian = args.wallet.account?.address;
  if (!custodian) throw new Error('wallet not connected');

  const opts = {
    enforcers: {
      payment: config.paymentEnforcer,
      timestamp: config.timestampEnforcer,
      allowedTargets: config.allowedTargetsEnforcer,
      allowedMethods: config.allowedMethodsEnforcer,
    },
    payee: args.providerTreasury,
    asset: config.mockUsdc,
    maxAmountPerCharge: args.perCharge,
    maxAggregate: args.sessionBudget,
    maxRedemptionsPerWindow: 100,
    windowSeconds: 3600,
    validUntil: Math.floor(Date.now() / 1000) + 86_400,
  };
  const caveats = buildPaymentMandateCaveats(opts);

  const client = new DelegationClient({
    signer: delegationSigner(args.wallet, custodian),
    smartAccount: args.treasurySa,
    chainId: config.chainId,
    delegationManager: config.delegationManager,
  });
  const delegation = await client.issueDelegation({ delegate: OPEN_DELEGATION, caveats });

  return { delegation, consent: describePaymentMandate(opts) };
}

/** A single resource the reader can buy (the "service"). */
export interface PricedResource {
  title: string;
  url: string;
  price: bigint;
}

function resourceHashOf(r: PricedResource): Hex32 {
  return keccak256(toBytes(`x402:${r.url}`)) as Hex32;
}

/**
 * Build the one-shot closed mandate for a single charge. Only the fields the
 * on-chain redemption needs are load-bearing; the rest satisfy the PaymentMandate
 * shape (spec 243).
 */
function buildCharge(args: { readerSa: Address; treasury: Address; resource: PricedResource; nonce: bigint }): {
  mandate: PaymentMandate;
  resourceHash: Hex32;
} {
  const now = Math.floor(Date.now() / 1000);
  const resourceHash = resourceHashOf(args.resource);
  const asset = { id: config.mockUsdc, symbol: 'USDC', decimals: USDC_DECIMALS };
  const mandate: PaymentMandate = {
    mandateId: computeMandateId({ payer: args.readerSa, nonce: args.nonce, rail: 'x402', chain: config.chainId }),
    payer: args.readerSa,
    payee: args.treasury,
    granter: args.readerSa,
    rail: 'x402',
    amountPolicy: { kind: 'exact', amount: args.resource.price, asset, chain: config.chainId },
    nonce: args.nonce,
    maxRedemptions: 1,
    validFrom: now,
    expiresAt: now + 3600,
    contextBinding: {
      resource: { method: 'GET', url: args.resource.url, requestBodyHash: ('0x' + '00'.repeat(32)) as Hex32 },
      chain: config.chainId,
      asset,
      nonce: args.nonce,
      validFrom: now,
      expiresAt: now + 3600,
    },
    mode: 'closed',
    reasonHash: keccak256(toBytes(`access:${args.resource.title}`)) as Hex32,
    signature: '0x',
  };
  return { mandate, resourceHash };
}

export interface SettleResult {
  settlementHash: Hex;
  mandateId: Hex32;
  amount: bigint;
}

/**
 * Access + pay: build the redemption and submit it from the wallet. The DM runs
 * the PaymentEnforcer and moves USDC reader → treasury in one tx.
 */
export async function accessAndPay(args: {
  wallet: PaymentWallet;
  budget: PaymentBudget;
  treasurySa: Address;     // payer (signs the budget; the enforcer moves its USDC)
  personalSa: Address;     // redeemer (executes the gasless userOp — distinct SA, no reentrancy)
  providerTreasury: Address;
  resource: PricedResource;
}): Promise<SettleResult> {
  const custodian = args.wallet.account?.address;
  if (!custodian) throw new Error('wallet not connected');

  // Fresh per-charge nonce (the PaymentEnforcer rejects a reused one — PAY-CON-1).
  const nonce = BigInt(Date.now());
  const { mandate, resourceHash } = buildCharge({
    readerSa: args.treasurySa,
    treasury: args.providerTreasury,
    resource: args.resource,
    nonce,
  });

  const plan = x402.buildRedemptionCalldata({
    mandate,
    delegation: args.budget.delegation,
    delegationManager: config.delegationManager,
    paymentEnforcer: config.paymentEnforcer,
    asset: config.mockUsdc,
    resourceHash,
  });

  // Gasless + enforcer-gated: the Personal SA executes redeemDelegation as a paymaster-sponsored
  // userOp; the DM runs the PaymentEnforcer and moves USDC Treasury SA → provider treasury SA.
  const settlementHash = await executeViaSa(args.wallet, args.personalSa, plan.to, plan.value, plan.data);

  return { settlementHash, mandateId: mandate.mandateId, amount: args.resource.price };
}
