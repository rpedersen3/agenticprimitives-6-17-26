# @agenticprimitives/related-agents

## 0.0.0-alpha.6

### Minor Changes

- bf725a9: NEW-RAG-2 (security): add `relatedAgentWriteContentHash` + `hashRelatedAgentWriteChallenge` — the bound,
  one-shot challenge a person-SA custodian signs to authorize an external-custodian related-agent write
  (replaces the replayable constant challenge in the demo-sso `related-orgs` write path). Client and server
  derive the digest identically so they can't drift.

### Patch Changes

- Updated dependencies [75a24d9]
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.7
  - @agenticprimitives/delegation@1.0.0-alpha.10
  - @agenticprimitives/types@1.0.0-alpha.10

## 0.0.0-alpha.5

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.9
- @agenticprimitives/delegation@1.0.0-alpha.9
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.5

## 0.0.0-alpha.4

### Patch Changes

- Updated dependencies [fa345d7]
  - @agenticprimitives/delegation@1.0.0-alpha.8
  - @agenticprimitives/types@1.0.0-alpha.8
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.4

## 0.0.0-alpha.3

### Patch Changes

- Updated dependencies [ba49084]
  - @agenticprimitives/delegation@1.0.0-alpha.7
  - @agenticprimitives/verifiable-credentials@0.0.0-alpha.3
  - @agenticprimitives/types@1.0.0-alpha.7

## 0.0.0-alpha.2

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.6
- @agenticprimitives/delegation@1.0.0-alpha.6
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.2

## 0.0.0-alpha.1

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/delegation@1.0.0-alpha.5
- @agenticprimitives/verifiable-credentials@0.0.0-alpha.1
