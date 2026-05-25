// @agenticprimitives/connect — the SSO broker (spec 224 / ADR-0014).
//
// State-machine + token issuer that ties connect-auth (credential ceremonies) +
// identity-directory (resolution) into a CAIP-10-subject, no-owner AgentSession.
//
// See:
//   - capability.manifest.json — boundary (types + connect-auth + identity-directory)
//   - ../../specs/224-agentic-connect.md — the contract
//   - ../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md

// Token layer (asymmetric AgentSession + JWKS; CN-4).
export {
  generateBrokerKeypair,
  mintAgentSession,
  verifyAgentSession,
  exportPublicJwk,
  publishJwks,
  importJwks,
  type BrokerAlg,
  type BrokerSigner,
  type VerifyKey,
  type VerifyResult,
  type VerifyOpts,
  type MintAgentSessionInput,
} from './token';

// Broker convergence + issuance (CN-2/5/6/8).
export {
  convergence,
  isCustodiedNamespace,
  SESSION_ISSUANCE_FLOOR,
  canIssueSession,
  selectFromResolution,
  requiresStepUp,
  CUSTODY_CLASS_ACTIONS,
  issueForResolution,
  type Convergence,
  type IssueDecision,
  type CustodyClassAction,
  type IssueForResolutionInput,
  type IssueOutcome,
} from './broker';

// Redirect & response delivery (CN-1/9).
export {
  validateRedirectUri,
  newAuthCode,
  createInMemoryAuthCodeStore,
  type AuthCodeValue,
  type AuthCodeStore,
} from './redirect';
