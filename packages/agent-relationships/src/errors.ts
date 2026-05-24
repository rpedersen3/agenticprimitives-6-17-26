export class InvalidEdgeError extends Error {
  constructor(readonly reason: string, readonly field?: string) {
    super(
      `[agent-relationships] invalid edge: ${reason}` +
        (field ? ` (field: ${field})` : ''),
    );
    this.name = 'InvalidEdgeError';
  }
}

export class UnauthorizedActorError extends Error {
  constructor(readonly actor: string, readonly action: string) {
    super(`[agent-relationships] actor ${actor} not authorized for ${action}`);
    this.name = 'UnauthorizedActorError';
  }
}

export class UnknownRelationshipTypeError extends Error {
  constructor(readonly typeId: string) {
    super(`[agent-relationships] unknown relationship type ${typeId}`);
    this.name = 'UnknownRelationshipTypeError';
  }
}
