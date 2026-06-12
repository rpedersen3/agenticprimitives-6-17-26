/**
 * PMT-INV-02 / PMT-INV-12 — EIP-712 mandate signing + ERC-1271 verification.
 *
 * The payer SA signs an EIP-712 typed-data digest of the mandate. The signed
 * struct flattens the load-bearing fields and folds the entire `ContextBinding`
 * into one `contextBindingHash` — so no field can be stripped or substituted
 * after signing (PMT-INV-02 / INV-07 / INV-08), and verification is one
 * ERC-1271 call against the payer SA (PMT-INV-12 — no raw EOA signatures).
 *
 * Pure crypto only (viem) — the actual ERC-1271 read is injected so the package
 * stays transport-agnostic (no hard publicClient dependency).
 */

import {
  hashTypedData,
  keccak256,
  encodeAbiParameters,
  toHex,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import type { PaymentMandate, ContextBinding, Hex32 } from './index.js';

export const PAYMENT_MANDATE_DOMAIN_NAME = 'AgenticPaymentMandate';
export const PAYMENT_MANDATE_DOMAIN_VERSION = '1';

/** ERC-1271 magic value for a valid signature. */
export const ERC1271_MAGIC = '0x1626ba7e';

export const PAYMENT_MANDATE_EIP712_TYPES = {
  PaymentMandate: [
    { name: 'mandateId', type: 'bytes32' },
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'granter', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'maxRedemptions', type: 'uint256' },
    { name: 'validFrom', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'mode', type: 'string' },
    { name: 'rail', type: 'string' },
    { name: 'reasonHash', type: 'bytes32' },
    { name: 'contextBindingHash', type: 'bytes32' },
  ],
} as const;

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;
const hashStr = (s?: string): Hex32 => (s ? (keccak256(toBytes(s)) as Hex32) : ZERO32);

/** The charge amount carried by the mandate (exact → amount; range/formula → maxAmount). */
export function mandateAmount(mandate: PaymentMandate): bigint {
  const ap = mandate.amountPolicy;
  return ap.kind === 'exact' ? ap.amount : ap.maxAmount;
}

/**
 * Canonical hash of the ENTIRE context binding (PMT-INV-02). Every field is
 * folded in; absent fields hash to zero, so adding/removing one changes the hash.
 */
export function hashContextBinding(cb: ContextBinding): Hex32 {
  const resourceHash: Hex32 = cb.resource
    ? (keccak256(
        encodeAbiParameters(
          [{ type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
          [cb.resource.method, cb.resource.url, cb.resource.requestBodyHash],
        ),
      ) as Hex32)
    : ZERO32;
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' }, // intentIdHash
        { type: 'bytes32' }, // agreementCommitment
        { type: 'bytes32' }, // taskId
        { type: 'bytes32' }, // artifactHash
        { type: 'bytes32' }, // resourceHash
        { type: 'bytes32' }, // orderHash
        { type: 'bytes32' }, // legId
        { type: 'uint256' }, // chain
        { type: 'address' }, // asset
        { type: 'uint256' }, // nonce
        { type: 'uint256' }, // validFrom
        { type: 'uint256' }, // expiresAt
      ],
      [
        hashStr(cb.intentId),
        cb.agreementCommitment ?? ZERO32,
        cb.taskId ?? ZERO32,
        cb.artifactHash ?? ZERO32,
        resourceHash,
        cb.orderHash ?? ZERO32,
        cb.legId ?? ZERO32,
        BigInt(cb.chain),
        cb.asset.id as Address,
        cb.nonce,
        BigInt(cb.validFrom),
        BigInt(cb.expiresAt),
      ],
    ),
  ) as Hex32;
}

export interface MandateDomainOpts {
  chainId: number;
  /** Optional binding to a specific contract (e.g. the PaymentEnforcer). Omit for a chain-scoped mandate. */
  verifyingContract?: Address;
}

export function paymentMandateDomain(opts: MandateDomainOpts) {
  return {
    name: PAYMENT_MANDATE_DOMAIN_NAME,
    version: PAYMENT_MANDATE_DOMAIN_VERSION,
    chainId: opts.chainId,
    ...(opts.verifyingContract ? { verifyingContract: opts.verifyingContract } : {}),
  } as const;
}

function mandateMessage(mandate: PaymentMandate) {
  return {
    mandateId: mandate.mandateId,
    payer: mandate.payer,
    payee: mandate.payee,
    granter: mandate.granter,
    asset: mandate.amountPolicy.asset.id as Address,
    amount: mandateAmount(mandate),
    nonce: mandate.nonce,
    maxRedemptions: BigInt(mandate.maxRedemptions),
    validFrom: BigInt(mandate.validFrom),
    expiresAt: BigInt(mandate.expiresAt),
    mode: mandate.mode,
    rail: mandate.rail,
    reasonHash: mandate.reasonHash,
    contextBindingHash: hashContextBinding(mandate.contextBinding),
  } as const;
}

/** The full EIP-712 typed-data object (domain + types + message) for a mandate. */
export function buildPaymentMandateTypedData(mandate: PaymentMandate, opts: MandateDomainOpts) {
  return {
    domain: paymentMandateDomain(opts),
    types: PAYMENT_MANDATE_EIP712_TYPES,
    primaryType: 'PaymentMandate' as const,
    message: mandateMessage(mandate),
  };
}

/** The 32-byte EIP-712 digest the payer SA's ERC-1271 validates over. */
export function paymentMandateDigest(mandate: PaymentMandate, opts: MandateDomainOpts): Hex32 {
  const td = buildPaymentMandateTypedData(mandate, opts);
  return hashTypedData(td) as Hex32;
}

/** Signer surface — an SA signer that produces an ERC-1271-validatable signature over typed data. */
export interface MandateSigner {
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: typeof PAYMENT_MANDATE_EIP712_TYPES;
    primaryType: 'PaymentMandate';
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

/** Sign an unsigned mandate (`signature: '0x'`) → a fully-populated mandate. */
export async function signPaymentMandate(
  mandate: PaymentMandate,
  signer: MandateSigner,
  opts: MandateDomainOpts,
): Promise<PaymentMandate> {
  const td = buildPaymentMandateTypedData(mandate, opts);
  const signature = await signer.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: td.message as Record<string, unknown>,
  });
  return { ...mandate, signature };
}

/** Injected ERC-1271 read: returns the 4-byte magic from `payer.isValidSignature(digest, signature)`. */
export type Erc1271Reader = (account: Address, digest: Hex32, signature: Hex) => Promise<Hex>;

/**
 * PMT-INV-12 — verify the mandate's signature via the payer SA's ERC-1271. Fail-closed: any read
 * error or non-magic result is `false` (never throws on a bad signature).
 */
export async function verifyPaymentMandateSignature(
  mandate: PaymentMandate,
  opts: MandateDomainOpts,
  read1271: Erc1271Reader,
): Promise<boolean> {
  if (!mandate.signature || mandate.signature === '0x') return false;
  const digest = paymentMandateDigest(mandate, opts);
  try {
    const res = await read1271(mandate.payer, digest, mandate.signature);
    return typeof res === 'string' && res.slice(0, 10).toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
}

void toHex; // reserved for future debug helpers
