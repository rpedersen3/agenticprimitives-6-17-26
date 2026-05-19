// Passkey (WebAuthn) auth method — stub in v0; the demo uses SIWE.
// Real implementation lands when a consumer asks.

export interface PasskeySignupInput {
  label: string;
  challenge: `0x${string}`;
}

export async function beginSignup(_input: { label: string }): Promise<never> {
  throw new Error('identity-auth/passkey: not implemented in v0 demo (use /siwe).');
}

export async function completeSignup(_req: unknown): Promise<never> {
  throw new Error('identity-auth/passkey: not implemented in v0 demo (use /siwe).');
}

export async function beginLogin(_input: { credentialId: string }): Promise<never> {
  throw new Error('identity-auth/passkey: not implemented in v0 demo (use /siwe).');
}

export async function completeLogin(_req: unknown): Promise<never> {
  throw new Error('identity-auth/passkey: not implemented in v0 demo (use /siwe).');
}
