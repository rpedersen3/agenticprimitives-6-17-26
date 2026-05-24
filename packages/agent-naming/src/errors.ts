export class InvalidNameError extends Error {
  constructor(readonly agentName: string, readonly reason: string) {
    super(`[agent-naming] invalid name "${agentName}": ${reason}`);
    this.name = 'InvalidNameError';
  }
}

export class NameNotFoundError extends Error {
  constructor(readonly agentName: string) {
    super(`[agent-naming] name not registered: ${agentName}`);
    this.name = 'NameNotFoundError';
  }
}

export class UnauthorizedNameOwnerError extends Error {
  constructor(readonly agentName: string, readonly attemptedSigner?: string) {
    super(
      `[agent-naming] caller is not the owner of "${agentName}"` +
        (attemptedSigner ? ` (attempted: ${attemptedSigner})` : ''),
    );
    this.name = 'UnauthorizedNameOwnerError';
  }
}
