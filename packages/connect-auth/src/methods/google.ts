// Google OAuth auth method — stub in v0; the demo uses SIWE.

export async function buildAuthUrl(_input: { clientId: string; redirectUri: string; state: string; nonce: string }): Promise<never> {
  throw new Error('identity-auth/google: not implemented in v0 demo (use /siwe).');
}

export async function handleCallback(_req: unknown): Promise<never> {
  throw new Error('identity-auth/google: not implemented in v0 demo (use /siwe).');
}
