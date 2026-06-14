// @agenticprimitives/a2a — async, delegation-authorized Agent-to-Agent task transport (spec 269).
// W1 (this wave): the transport-agnostic Task runtime + the TaskStore port + the SkillHandler contract.
// W2+: delegation-auth gate, scoped-grant caveat builders, JSON-RPC handlers, A2aWireAdapter client, and
// the Cloudflare TaskStoreDO (the `./cloudflare` subpath). See ADR-0034 for the package/boundary shape.

export const PACKAGE_NAME = '@agenticprimitives/a2a';
export const PACKAGE_STATUS = 'w5-acceptance-and-adoption' as const;
export const SPEC_REF = 'specs/269-async-delegation-authorized-a2a.md';

// Types (built on @agenticprimitives/fulfillment)
export type {
  Task,
  TaskState,
  Artifact,
  A2aArtifact,
  A2aMessage,
  VaultRef,
  TaskRecord,
  TaskEvent,
} from './types.js';
export { TERMINAL_STATES, isTerminal } from './types.js';

// TaskStore port + reference in-memory impl
export type { TaskStore } from './task-store.js';
export { createInMemoryTaskStore } from './task-store.js';

// SkillHandler contract + dispatch
export type { SkillHandler, SkillContext, SkillResult, VaultClient, McpClient, HandoffRequest } from './skill-handler.js';
export { AuthRequired, HandoffRequested, buildSkillRegistry } from './skill-handler.js';

// Spec 272 PAY-A2A — payment-gated skills (injected x402 rail; a2a stays transport-agnostic).
export type { SkillPayment, PaymentGate, PaymentGateDecision, PaymentLane, X402PaymentMetadata, X402PaymentStatus } from './payment-gate.js';
export {
  X402_EXTENSION_URI,
  x402AgentCardExtension,
  buildPaymentRequiredMetadata,
  buildPaymentSettledMetadata,
  gateSkillPayment,
} from './payment-gate.js';

// Runtime
export { newTaskRecord, applyTransition, dispatchTask } from './runtime.js';
export type { TransitionResult } from './runtime.js';

// Scoped-grant caveat builders (W2 / FR-4.2)
export { A2A_ANY_SKILL, skillSelector, buildA2aGrantCaveats } from './grant.js';
export type { A2aEnforcers } from './grant.js';

// Delegation-auth gate (W2 / FR-4)
export {
  authorizeA2aMessage,
  hashA2aMessage,
  hashA2aTaskRequest,
  decodeTimestampTerms,
  decodeAllowedTargetsTerms,
  decodeAllowedMethodsTerms,
} from './auth.js';
export type { OnChainChecks, MessageIdReserver, AuthorizeResult } from './auth.js';

// Embeddable agent + JSON-RPC + client (W3)
export { createA2aAgent } from './agent.js';
export type { A2aAgent, A2aAgentConfig, AgentCard, MessageSendParams, ResubmitParams, RpcResult, RpcOk, RpcErr } from './agent.js';
export { dispatchA2aRpc, handleA2aRpcBody } from './jsonrpc.js';
export type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.js';
export { A2aWireAdapter } from './client.js';
export type { A2aTransport } from './client.js';

// Agent discovery (§8) — name → SA → endpoint + agent-card fetch (injected resolvers, ADR-0021)
export { resolveA2aTarget, fetchAgentCard } from './discovery.js';
export type { A2aTarget, ResolveAgentName, AgentEndpointFor, A2aFetch } from './discovery.js';

// Delivery — signed push + SSE (W4)
export { hashPushPayload, deliverPush, verifyPushEnvelope } from './push.js';
export type { PushPayload, PushEnvelope, TerminalSigner, PushSender } from './push.js';
export { SSE_HEADERS, formatSseEvent, formatSseComment, isStreamEnd } from './sse.js';
export type { PushConfig } from './types.js';
