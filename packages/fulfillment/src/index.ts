/**
 * @agenticprimitives/fulfillment — FulfillmentCase + Task/Message/Artifact +
 * Evidence/Outcome credential lifecycle.
 *
 * Spine Layers 10–12.
 * Authoritative spec: specs/244-fulfillment.md
 */

import type { Address } from '@agenticprimitives/types';

export const PACKAGE_NAME = '@agenticprimitives/fulfillment';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/244-fulfillment.md';

export type Hex32 = `0x${string}`;

// ─── Lifecycle state machine (spec 244 §4.2) ────────────────────────

export type FulfillmentLifecycle =
  | 'drafted'
  | 'clarified'
  | 'expressed'
  | 'acknowledged'
  | 'proposed'
  | 'accepted'
  | 'committed'
  | 'in_progress'
  | 'fulfilled'
  | 'validated'
  | 'archived'
  | 'canceled'
  | 'disputed';

const LIFECYCLE_TRANSITIONS: Record<FulfillmentLifecycle, FulfillmentLifecycle[]> = {
  drafted: ['clarified', 'canceled'],
  clarified: ['expressed', 'canceled'],
  expressed: ['acknowledged', 'canceled'],
  acknowledged: ['proposed', 'canceled'],
  proposed: ['accepted', 'canceled'],
  accepted: ['committed', 'canceled'],
  committed: ['in_progress', 'canceled', 'disputed'],
  in_progress: ['fulfilled', 'disputed', 'canceled'],
  fulfilled: ['validated', 'disputed'],
  validated: ['archived'],
  archived: [],
  canceled: ['archived'],
  disputed: ['archived'],
};

export function canTransition(from: FulfillmentLifecycle, to: FulfillmentLifecycle): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

// ─── A2A Task state machine (spec 245) ──────────────────────────────

export type TaskState =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'input-required'
  | 'rejected'
  | 'auth-required';

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  submitted: ['working', 'rejected', 'auth-required'],
  'auth-required': ['submitted'],
  working: ['completed', 'failed', 'canceled', 'input-required'],
  'input-required': ['working'],
  completed: [],
  failed: [],
  canceled: [],
  rejected: [],
};

export function canTaskTransition(from: TaskState, to: TaskState): boolean {
  return (TASK_TRANSITIONS[from] ?? []).includes(to);
}

// ─── Core types ─────────────────────────────────────────────────────

export interface FulfillmentCase {
  caseId: Hex32;
  agreementCommitment: Hex32;
  parties: [Address, Address];
  lifecycle: FulfillmentLifecycle;
  lifecycleHistory: {
    from: FulfillmentLifecycle;
    to: FulfillmentLifecycle;
    actor: Address;
    epochBucket: number;
  }[];
  taskIds: Hex32[];
  topology: 'linear' | 'parallel' | 'dag';
  visibility: string;
  paymentMandateIds: Hex32[];
}

export interface Task {
  taskId: Hex32;
  parentCaseId?: Hex32;
  parentIntentId?: string;
  state: TaskState;
  assignee: Address;
  assigneeKind: 'person' | 'org' | 'agent' | 'oracle' | 'hybrid';
  inputHash: Hex32;
  artifactIds: Hex32[];
  deadline?: number;
  maxRetries: number;
  permissionGrantRef: Hex32;
}

export interface HandoffPolicy {
  allowedTargetAgents: Address[];
  allowedAgentClasses: string[];
  requiresUserApproval: boolean;
  preservePrivacyTier: boolean;
  allowedScopes: string[];
  maxHopCount: number;
}

/** FLF-INV-09: enforce handoff policy at runtime. */
export function isHandoffAllowed(policy: HandoffPolicy, target: Address, targetClass?: string): boolean {
  if (policy.allowedTargetAgents.includes(target)) return true;
  if (targetClass && policy.allowedAgentClasses.includes(targetClass)) return true;
  return false;
}

export interface Artifact {
  artifactId: Hex32;
  caseId: Hex32;
  taskId?: Hex32;
  producer: Address;
  artifactKind: string;
  bodyHash: Hex32;
  bodyContentType: string;
  disclosurePolicy: string;
  createdAt: number;
}

export interface OutcomeCredentialSubject {
  intentId: string;
  caseId: Hex32;
  intentExpected: Record<string, unknown>;
  delivered: Record<string, unknown>;
  actorSatisfaction: 'fully' | 'partially' | 'not';
  evidenceAssertionUids: Hex32[];
}

/** FLF-OUT-1: OutcomeCredential MUST cite at least one EvidenceCredential UID. */
export function assertOutcomeCitations(subject: OutcomeCredentialSubject): void {
  if (subject.evidenceAssertionUids.length === 0) {
    throw new Error(
      `[fulfillment/FLF-OUT-1] OutcomeCredential MUST cite at least one EvidenceCredential UID. D-40 substrate invariant.`,
    );
  }
}

// ─── Trace spans (Decision 7 in ADR-0024) ───────────────────────────

export type SpanType =
  | 'parse'
  | 'clarify'
  | 'resolve'
  | 'match'
  | 'handoff'
  | 'tool_call'
  | 'wallet_simulation'
  | 'user_approval'
  | 'execution'
  | 'validation'
  | 'task_state_change'
  | 'lifecycle_transition';

export interface IntentTraceSpan {
  spanId: Hex32;
  parentSpanId?: Hex32;
  caseId: Hex32;
  intentId?: string;
  spanType: SpanType;
  actorAgent: Address;
  inputHash: Hex32;
  outputHash: Hex32;
  policyVersion: string;
  timestamp: number;
}
