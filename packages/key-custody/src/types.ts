import type { Address } from '@agenticprimitives/types';
import type { AuditSink } from '@agenticprimitives/audit';

export type KmsBackend = 'local-aes' | 'aws-kms' | 'gcp-kms';

/**
 * H7-F.5 / PKG-KEY-CUSTODY-005 closure — opaque branded type for
 * sensitive config values (raw private keys, KMS service-account JSON,
 * session secrets, derivation masters, etc.).
 *
 * Previously `BuildOpts.config: Record<string, string>` shipped raw
 * private keys + KMS service-account JSON as plain strings. A consumer
 * who logged `opts.config` for debugging silently dumped the master
 * private key to logs (and worse, to any structured-log backend that
 * indexed it).
 *
 * `Secret<T>` is a `BrandedSecret` wrapper that:
 *   - Cannot be `JSON.stringify`d to its underlying value (the brand
 *     wins; the value field is non-enumerable + has a custom toJSON
 *     that returns `'[redacted secret]'`).
 *   - Cannot be `console.log`'d in a useful way (custom `inspect`
 *     symbol + `Symbol.toPrimitive` return the redaction marker).
 *   - Exposes the underlying value ONLY through {@link unwrapSecret}.
 *
 * Loaders (`loadSecret`, `loadSecretFromEnv`) are the only constructors.
 * Existing `Record<string, string>` config still works (back-compat);
 * new code should use the branded shape via `secretConfig`.
 */
const SECRET_BRAND: unique symbol = Symbol.for('agenticprimitives.secret');

export interface Secret<T extends string = string> {
  readonly [SECRET_BRAND]: true;
  /** Phantom — for compile-time discrimination of value shapes. */
  readonly _kind?: T;
}

interface InternalSecret<T extends string = string> extends Secret<T> {
  __value: string;
}

const REDACTED = '[redacted secret]' as const;

/**
 * Wrap a plain string as an opaque secret. The returned object will
 * NOT survive `JSON.stringify`, `console.log`, or `util.inspect`.
 */
export function loadSecret<T extends string = string>(value: string): Secret<T> {
  const inner: InternalSecret<T> = {
    [SECRET_BRAND]: true,
    __value: value,
    toJSON: () => REDACTED,
    toString: () => REDACTED,
    [Symbol.toPrimitive]: () => REDACTED,
  } as InternalSecret<T> & {
    toJSON: () => string;
    toString: () => string;
    [Symbol.toPrimitive]: () => string;
  };
  // Hide `__value` from enumeration so naive iteration (Object.keys,
  // spread, JSON.stringify) cannot reach it.
  Object.defineProperty(inner, '__value', { enumerable: false, writable: false });
  // Node's util.inspect honors this symbol.
  Object.defineProperty(inner, Symbol.for('nodejs.util.inspect.custom'), {
    enumerable: false,
    value: () => REDACTED,
  });
  return inner;
}

/** Load a secret from a process env var. Throws if the var is missing or empty. */
export function loadSecretFromEnv<T extends string = string>(name: string): Secret<T> {
  let value: string | undefined;
  try {
    value = process.env?.[name];
  } catch {
    /* SES / Workers may throw on process access */
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[key-custody] loadSecretFromEnv: env var ${name} is missing or empty`);
  }
  return loadSecret<T>(value);
}

/** Unwrap a secret to its underlying string. Use AT THE LAST POSSIBLE MOMENT. */
export function unwrapSecret<T extends string>(s: Secret<T>): string {
  return (s as InternalSecret<T>).__value;
}

/** Type guard. */
export function isSecret<T extends string = string>(v: unknown): v is Secret<T> {
  return typeof v === 'object' && v !== null && (v as { [SECRET_BRAND]?: boolean })[SECRET_BRAND] === true;
}

export interface BuildOpts {
  /**
   * Backend selection. Recommended explicit value. When omitted, the
   * factory falls back to `A2A_KMS_BACKEND` env, then to `local-aes` in
   * development. In production with neither set, the factory THROWS at
   * construction time (audit H1: no silent local-aes default).
   */
  backend?: KmsBackend;
  /**
   * Plain config bag (back-compat). H7-F.5 callers should prefer
   * {@link secretConfig} for any value that's a private key, session
   * secret, KMS service-account JSON, or derivation master.
   */
  config?: Record<string, string>;
  /**
   * H7-F.5 / PKG-KEY-CUSTODY-005 — sensitive config values wrapped in
   * `Secret<T>` so they don't survive logging / JSON.stringify.
   * Factories that need to unwrap call {@link unwrapSecret} at the
   * latest possible moment + never store the unwrapped value.
   */
  secretConfig?: Record<string, Secret<string>>;
  /**
   * Optional audit sink threaded into signers so every signing op emits
   * `key-custody.sign`. Consumers share one sink across all primitives
   * so rows land in one trail. Fail-soft if the sink throws.
   */
  auditSink?: AuditSink;
  /**
   * Production-readiness gate (audit H1). Inverted default: factories
   * treat the runtime as `'production'` unless either:
   *   - `developmentMode: true` is set explicitly, or
   *   - `process.env.NODE_ENV !== 'production'`.
   * In production with no explicit backend AND no `A2A_KMS_BACKEND`
   * env, the factory throws. Pass `environment: 'production'` to force
   * production semantics in tests; pass `'development'` (or
   * `developmentMode: true`) to opt into the dev fallback.
   */
  environment?: 'production' | 'development';
  /** Shorthand for `environment: 'development'`. */
  developmentMode?: boolean;
}

export interface A2AKeyProvider {
  readonly keyVersion: string;
  generateSessionDataKey(input: {
    aadContext: Record<string, string>;
  }): Promise<{
    plaintextDataKey: Uint8Array;
    encryptedDataKey: Uint8Array;
    keyId: string;
    keyVersion: string;
  }>;
  decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array>;
  signA2AAction?(input: {
    digest: Uint8Array;
    auditContext?: { toolId?: string; sessionId?: string; actionId?: string };
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: Address }>;
  generateMac?(input: {
    canonicalMessage: Uint8Array;
    service: string;
    audience: string;
  }): Promise<{ mac: Uint8Array; keyId: string }>;
}

export interface KmsAccountBackend {
  /**
   * The concrete backend kind. `createKmsAccount` reads this so the
   * emitted `provider` / `keyId` reflect the REAL backend (audit
   * provenance), instead of a defaulted `'local-aes'` label that could
   * mislabel a production GCP signer (audit F-6).
   */
  readonly provider: 'local-aes' | 'aws-kms' | 'gcp-kms';
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>;
  getSignerAddress(): Promise<Address>;
}
