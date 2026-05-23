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
        '(`aws-kms` / `gcp-kms` for real deploys; `local-aes` for dev) or set ' +
        'the A2A_KMS_BACKEND env var. There is no implicit fallback in production — ' +
        'pass `developmentMode: true` to opt into the dev default.',
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

export function buildToolExecutorBackend(toolId: string, opts: BuildOpts): KmsAccountBackend {
  // For v0 local-aes, per-tool isolation is achieved by deriving a separate
  // signer key from the master per toolId. v0 demo just returns the master
  // signer; v0.1 will derive per-tool keys via HKDF.
  void toolId;
  return buildSignerBackend(opts);
}

export function buildMacProvider(audience: string, opts: BuildOpts): A2AKeyProvider {
  // Same backend selector; provider returns generateMac.
  // The audience is consumed by generateMac at call time; the provider itself
  // doesn't bind to one audience.
  void audience;
  return buildKeyProvider(opts);
}
