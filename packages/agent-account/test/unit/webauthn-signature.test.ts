import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, slice } from 'viem';
import {
  SIG_TYPE_WEBAUTHN,
  encodeAssertion,
  encodeWebAuthnSignature,
} from '../../src/webauthn-signature';
import type { WebAuthnAssertion } from '@agenticprimitives/identity-auth/passkey';

const FIXTURE: WebAuthnAssertion = {
  authenticatorData:
    ('0x' + 'aa'.repeat(37)) as `0x${string}`,
  clientDataJSON:
    '{"type":"webauthn.get","challenge":"abc","origin":"https://example.com"}',
  challengeIndex: 33n,
  typeIndex: 1n,
  r: 0x1234567890n,
  s: 0x9876543210n,
  credentialIdDigest:
    ('0x' + 'cc'.repeat(32)) as `0x${string}`,
};

describe('SIG_TYPE_WEBAUTHN', () => {
  it('is the byte 0x01 (matches AgentAccount._validateSig)', () => {
    expect(SIG_TYPE_WEBAUTHN).toBe('0x01');
  });
});

describe('encodeAssertion', () => {
  it('round-trips through abi.decode', () => {
    const encoded = encodeAssertion(FIXTURE);
    const [decoded] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'authenticatorData', type: 'bytes' },
            { name: 'clientDataJSON', type: 'string' },
            { name: 'challengeIndex', type: 'uint256' },
            { name: 'typeIndex', type: 'uint256' },
            { name: 'r', type: 'uint256' },
            { name: 's', type: 'uint256' },
            { name: 'credentialIdDigest', type: 'bytes32' },
          ],
        },
      ],
      encoded,
    );
    expect(decoded.authenticatorData).toBe(FIXTURE.authenticatorData);
    expect(decoded.clientDataJSON).toBe(FIXTURE.clientDataJSON);
    expect(decoded.challengeIndex).toBe(FIXTURE.challengeIndex);
    expect(decoded.typeIndex).toBe(FIXTURE.typeIndex);
    expect(decoded.r).toBe(FIXTURE.r);
    expect(decoded.s).toBe(FIXTURE.s);
    expect(decoded.credentialIdDigest).toBe(FIXTURE.credentialIdDigest);
  });

  it('does NOT prepend the SIG_TYPE byte', () => {
    const encoded = encodeAssertion(FIXTURE);
    // ABI tuple encoding starts with an offset word (32 bytes); first
    // byte is 0x00 (not the sig-type marker). encodeWebAuthnSignature is
    // the one that prepends 0x01.
    expect(slice(encoded, 0, 1)).toBe('0x00');
  });
});

describe('encodeWebAuthnSignature', () => {
  it('prepends the SIG_TYPE_WEBAUTHN byte (0x01) to the ABI-encoded struct', () => {
    const blob = encodeWebAuthnSignature(FIXTURE);
    expect(slice(blob, 0, 1)).toBe('0x01');
    // Bytes [1:] should equal encodeAssertion's output.
    const tail = ('0x' + blob.slice(4)) as `0x${string}`;
    const inner = encodeAssertion(FIXTURE);
    expect(tail).toBe(inner);
  });

  it('produces a different blob than encodeAssertion alone', () => {
    expect(encodeWebAuthnSignature(FIXTURE)).not.toBe(encodeAssertion(FIXTURE));
  });

  it('is deterministic for identical input', () => {
    expect(encodeWebAuthnSignature(FIXTURE)).toBe(encodeWebAuthnSignature(FIXTURE));
  });
});
