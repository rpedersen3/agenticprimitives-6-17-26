// AUDIT N-2 regression: the `aws-kms` backend must FAIL FAST (at construction), not on first use.
// Previously selecting `aws-kms` constructed a stub that threw only on the first sign/encrypt call —
// a deferred-failure footgun for a real deployment. These tests pin the fail-fast contract.
import { describe, it, expect } from 'vitest';
import { buildKeyProvider, buildSignerBackend } from '../../src/factories';
import { AwsKmsProvider, AwsKmsSigner, AWS_KMS_NOT_IMPLEMENTED } from '../../src/providers/aws';

describe('aws-kms fail-fast (AUDIT N-2)', () => {
  it('buildKeyProvider({ backend: "aws-kms" }) throws synchronously, not on a later call', () => {
    expect(() => buildKeyProvider({ backend: 'aws-kms' })).toThrow(/aws-kms.*not implemented/i);
  });

  it('buildSignerBackend({ backend: "aws-kms" }) throws synchronously', () => {
    expect(() => buildSignerBackend({ backend: 'aws-kms' })).toThrow(/aws-kms.*not implemented/i);
  });

  it('direct AwsKmsProvider construction throws (no usable instance can exist)', () => {
    expect(() => new AwsKmsProvider()).toThrow(AWS_KMS_NOT_IMPLEMENTED);
  });

  it('direct AwsKmsSigner construction throws', () => {
    expect(() => new AwsKmsSigner()).toThrow(AWS_KMS_NOT_IMPLEMENTED);
  });

  it('local-aes selection still constructs (fail-fast is aws-kms-specific)', () => {
    // local-aes builds a usable provider in dev; this proves we didn't break the other backends.
    const sessionSecretHex = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    expect(() => buildKeyProvider({ backend: 'local-aes', developmentMode: true, config: { sessionSecretHex } })).not.toThrow();
  });
});
