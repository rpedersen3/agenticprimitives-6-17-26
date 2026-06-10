// The SkillHandler plug-in contract (spec 269 §3 / §8) — the most important consumer API. An agent
// registers handlers keyed by skill name; the runtime dispatches a working task to the matching handler.
// Unknown skill → the task is rejected. The handler receives the VERIFIED, captured grant + clients to
// read/write the principal's vault and call MCP tools via the delegation token.
import type { Address, Hex } from '@agenticprimitives/types';
import type { Delegation } from '@agenticprimitives/delegation';
import type { VaultRef } from './types.js';

/** Minimal vault seam — the consumer wires demo-mcp vault read/write over a delegation (W4). */
export interface VaultClient {
  read(ref: VaultRef): Promise<unknown>;
  write(args: { owner: Address; recordType: string; data: unknown }): Promise<VaultRef>;
}

/** Minimal MCP seam — call a tool via the delegation token (reuses the a2a→mcp leg, W4). */
export interface McpClient {
  callTool(args: { tool: string; toolArgs?: Record<string, unknown> }): Promise<unknown>;
}

/** Thrown by `requestAuth` to suspend a task pending a fresh/again-scoped delegation (FR-3.5). The
 *  dispatcher catches it and transitions the task to `auth-required`. */
export class AuthRequired extends Error {
  constructor(public readonly authReason: string) {
    super(`auth-required: ${authReason}`);
    this.name = 'AuthRequired';
  }
}

export interface SkillContext {
  taskId: Hex;
  /** On whose behalf the sender acts (delegation.delegator). */
  principal: Address;
  /** The submitting agent SA (delegation.delegate). */
  sender: Address;
  /** The input body (already read from the vault by the runtime). */
  input: unknown;
  /** The verified, captured grant. */
  delegation: Delegation;
  vault: VaultClient;
  mcp: McpClient;
  /** Emit a result artifact: the runtime writes the body to the ASSIGNEE's vault (A2A-INV-04), computes
   *  the bodyHash, records the ref, and returns the artifactId. Only the hash/ref travel in task state. */
  emitArtifact(a: {
    artifactKind: string;
    body: unknown;
    bodyContentType?: string;
    disclosurePolicy?: string;
    caseId?: Hex;
  }): Promise<Hex>;
  /** Suspend pending a fresh grant — throws `AuthRequired`. */
  requestAuth(reason: string): never;
}

export interface SkillResult {
  state: 'completed' | 'failed' | 'input-required';
  artifactIds?: Hex[];
  error?: string;
}

export interface SkillHandler {
  skill: string;
  handle(ctx: SkillContext): Promise<SkillResult>;
}

/** Index handlers by skill name; reject duplicate registrations. */
export function buildSkillRegistry(handlers: SkillHandler[]): Map<string, SkillHandler> {
  const reg = new Map<string, SkillHandler>();
  for (const h of handlers) {
    if (reg.has(h.skill)) throw new Error(`duplicate skill handler: ${h.skill}`);
    reg.set(h.skill, h);
  }
  return reg;
}
