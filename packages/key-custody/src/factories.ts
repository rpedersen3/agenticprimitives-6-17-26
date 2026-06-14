import type { A2AKeyProvider, BuildOpts, KmsAccountBackend, KmsBackend } from './types';
import { LocalAesProvider, LocalSecp256k1Signer } from './providers/local';
import { AwsKmsProvider, AwsKmsSigner } from './providers/aws';
import { GcpKmsProvider, GcpKmsSigner } from './providers/gcp';

/**
 * Resolve effective environment for production-default gates (audit H1).
 *   1. Explicit `opts.environment` wins.
 *   2. `developmentMode: true` shorthand → 'development'.
 *   3. `process.env.NODE_ENV` if readable.
 *   4. Default to 'production' — safe-by-default when the runtime is
 *      ambiguous. Consumers who want a permissive default MUST opt out.
 */
function inferEnvironment(opts: BuildOpts): 'production' | 'development' {
  if (opts.environment) return opts.environment;
  if (opts.developmentMode === true) return 'development';
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
      return process.env.NODE_ENV === 'production' ? 'production' : 'development';
    }
  } catch {
    /* SES / Workers may throw on process access */
  }
  return 'production';
}

/**
 * Backend selection (audit H1). Required-by-default:
 *   - `opts.backend` always wins.
 *   - Fall back to A2A_KMS_BACKEND env.
 *   - In production with neither, THROW. The previous silent fallback
 *     to `local-aes` was a footgun — production consumers should fail
 *     at construction time, not boot a dev-mode signer.
 *   - In development with neither, default to `local-aes` for ergonomics.
 */
function backendOrEnv(opts: BuildOpts): KmsBackend {
  if (opts.backend) return opts.backend;
  const envBackend = (() => {
    try {
      return process.env?.A2A_KMS_BACKEND as KmsBackend | undefined;
    } catch {
      return undefined;
    }
  })();
  if (envBackend) return envBackend;
  if (inferEnvironment(opts) === 'production') {
    throw new Error(
      '[key-custody] No backend specified for production. Pass `opts.backend` ' +
        '(`gcp-kms` for real deploys; `local-aes` for dev) or set ' +
        'the A2A_KMS_BACKEND env var. There is no implicit fallback in production — ' +
        'pass `developmentMode: true` to opt into the dev default. ' +
        '(`aws-kms` is reserved but NOT implemented — selecting it fails fast.)',
    );
  }
  return 'local-aes';
}

export function buildKeyProvider(opts: BuildOpts): A2AKeyProvider {
  switch (backendOrEnv(opts)) {
    case 'local-aes':
      return new LocalAesProvider({ sessionSecretHex: opts.config?.sessionSecretHex });
    case 'aws-kms':
      return new AwsKmsProvider();
    case 'gcp-kms':
      return new GcpKmsProvider({
        cryptoKeyName: opts.config?.cryptoKeyName,
        serviceAccountJson: opts.config?.serviceAccountJson,
      });
  }
}

export function buildSignerBackend(opts: BuildOpts): KmsAccountBackend {
  switch (backendOrEnv(opts)) {
    case 'local-aes':
      return new LocalSecp256k1Signer({
        privateKeyHex: opts.config?.privateKeyHex,
        auditSink: opts.auditSink,
      });
    case 'aws-kms':
      return new AwsKmsSigner();
    case 'gcp-kms':
      return new GcpKmsSigner({
        cryptoKeyVersionName: opts.config?.cryptoKeyVersionName,
        serviceAccountJson: opts.config?.serviceAccountJson,
        auditSink: opts.auditSink,
      });
  }
}

/**
 * @deprecated Renamed in H7-B.1 to make the lie loud. Use
 * `buildToolExecutorBackendNoIsolation` (and read its JSDoc before you do).
 * Closure of PKG-KEY-CUSTODY-001 / EXT-020.
 */
export function buildToolExecutorBackend(_toolId: string, _opts: BuildOpts): KmsAccountBackend {
  throw new Error(
    '[key-custody] buildToolExecutorBackend was removed in H7-B.1 (PKG-KEY-CUSTODY-001 closure). ' +
      'The function ignored toolId and returned the master signer — every call signed with the ' +
      'master key, which contradicted the JSDoc promise of per-tool isolation. ' +
      'If you actually want master-signer fallback while per-tool HKDF is being built, use ' +
      '`buildToolExecutorBackendNoIsolation(toolId, opts)` AND set ' +
      '`AP_ALLOW_NO_TOOL_ISOLATION=true` (refused in production). ' +
      'For per-OIDC-subject isolation, use `deriveSubjectSigner` (spec 235).',
  );
}

/**
 * **NO per-tool isolation.** Returns the master signer (or the resolved KMS
 * backend) regardless of `toolId`. This is a deliberately ugly name so the
 * caller cannot pretend it's "per-tool" — that capability is not yet built.
 *
 * Use cases (all transitional):
 *   - test fixtures
 *   - dev-mode demos where a single master signer is acceptable
 *   - operator opt-in while per-tool HKDF lands
 *
 * Refuses to run unless `AP_ALLOW_NO_TOOL_ISOLATION=true` in env (or
 * `opts.developmentMode === true` / `opts.environment === 'development'`),
 * AND throws in production environments regardless of the opt-out flag.
 *
 * Closure of PKG-KEY-CUSTODY-001 / EXT-020 / CT-6.
 *
 * For per-OIDC-subject isolation, use {@link deriveSubjectSigner} (spec 235).
 */
export function buildToolExecutorBackendNoIsolation(
  toolId: string,
  opts: BuildOpts,
): KmsAccountBackend {
  void toolId;
  const env = inferEnvironment(opts);
  if (env === 'production') {
    throw new Error(
      '[key-custody] buildToolExecutorBackendNoIsolation is refused in production. ' +
        'Per-tool isolation is not implemented; the function would return the master signer. ' +
        'Build the per-tool HKDF path (mirror `deriveSubjectSigner` from spec 235) before ' +
        'wiring tool executors in production.',
    );
  }
  let allowFlag = false;
  try {
    allowFlag = process.env?.AP_ALLOW_NO_TOOL_ISOLATION === 'true';
  } catch {
    /* SES / Workers may throw */
  }
  if (!allowFlag) {
    throw new Error(
      '[key-custody] buildToolExecutorBackendNoIsolation requires opt-in. ' +
        'Set AP_ALLOW_NO_TOOL_ISOLATION=true (and ensure you are not in production). ' +
        'This signer has NO per-tool isolation — every toolId resolves to the master signer.',
    );
  }
  return buildSignerBackend(opts);
}

export function buildMacProvider(audience: string, opts: BuildOpts): A2AKeyProvider {
  // Same backend selector; provider returns generateMac.
  // The audience is consumed by generateMac at call time; the provider itself
  // doesn't bind to one audience.
  void audience;
  return buildKeyProvider(opts);
}
