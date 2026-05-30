export class InvalidProfileError extends Error {
  constructor(readonly reason: string, readonly field?: string) {
    super(
      `[agent-profile] invalid profile: ${reason}` +
        (field ? ` (field: ${field})` : ''),
    );
    this.name = 'InvalidProfileError';
  }
}

export class ProfileHashMismatchError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(
      `[agent-profile] profile content-hash mismatch — on-chain ${expected} vs computed ${actual}`,
    );
    this.name = 'ProfileHashMismatchError';
  }
}

export class EndpointVerificationError extends Error {
  constructor(readonly method: string, readonly endpoint: string, readonly reason: string) {
    super(`[agent-profile] ${method} verification failed for ${endpoint}: ${reason}`);
    this.name = 'EndpointVerificationError';
  }
}

export class InvalidCaip10Error extends Error {
  constructor(readonly value: string, readonly reason: string) {
    super(`[agent-profile] invalid CAIP-10 "${value}": ${reason}`);
    this.name = 'InvalidCaip10Error';
  }
}
