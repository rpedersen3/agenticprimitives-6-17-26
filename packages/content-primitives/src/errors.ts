/** A reference path failed its scheme's normalization. */
export class InvalidReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReferenceError';
  }
}

/** A rendering's keccak commitment did not match its descriptor. */
export class CommitmentMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitmentMismatchError';
  }
}
