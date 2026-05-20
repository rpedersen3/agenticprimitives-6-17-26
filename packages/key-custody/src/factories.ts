import type { A2AKeyProvider, BuildOpts, KmsAccountBackend } from './types';
import { LocalAesProvider, LocalSecp256k1Signer } from './providers/local';
import { AwsKmsProvider, AwsKmsSigner } from './providers/aws';
import { GcpKmsProvider, GcpKmsSigner } from './providers/gcp';

function backendOrEnv(opts: BuildOpts): BuildOpts['backend'] {
  return opts.backend ?? (process.env.A2A_KMS_BACKEND as BuildOpts['backend']) ?? 'local-aes';
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
