# @agenticprimitives/content-primitives

## 1.0.0-alpha.10

### Patch Changes

- Issuer-delegated content signing (spec 266): optional `ContentDescriptor.delegatingSigner`
  `{ delegatorIssuer, delegateKey, delegationLeaf }`; `buildContentDescriptor` attaches it;
  `verifyContentDescriptor` does leaf-then-delegate via an injected `verifyDelegatedAuthority`
  (stays delegation-agnostic) and requires `issuer.address == delegatorIssuer`. Backward-compatible —
  optional; direct-issuer signing unchanged.
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.6

## 1.0.0-alpha.9

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.9
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.5

## 1.0.0-alpha.8

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.8
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.4

## 1.0.0-alpha.7

### Patch Changes

- Updated dependencies [ba49084]
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.3
  - @agenticprimitives/types@1.0.0-alpha.7
