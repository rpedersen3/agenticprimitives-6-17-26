import type { Address, Hex } from '@agenticprimitives/types';
import type {
  AgentRelationshipsClientOpts,
  ConfirmEdgeInput,
  Edge,
  ProposeEdgeInput,
  RelationshipType,
  RevokeEdgeInput,
  SetRolesInput,
} from './types';

/**
 * Read + write client for the agent-relationships trust fabric.
 *
 * Phase 1 ships the API skeleton — reads throw `R Phase 2`, writes
 * throw `R Phase 4`. The shape is locked so demos can be written
 * against it before contracts deploy.
 *
 * Authorization model (security invariant from spec § 7):
 *   Every write asserts ERC-1271 `isValidSignature` against the
 *   subject's Smart Agent (for subject-side actions) or the object's
 *   Smart Agent (for object-side actions). The relationships package
 *   itself stays custody-agnostic — quorum / scheduling lives in the
 *   actor's CustodyPolicy module.
 */
export class AgentRelationshipsClient {
  constructor(readonly opts: AgentRelationshipsClientOpts) {
    if (!opts.rpcUrl) throw new Error('[agent-relationships] rpcUrl required');
    if (typeof opts.chainId !== 'number') {
      throw new Error('[agent-relationships] chainId required');
    }
  }

  // ─── Reads (wire in Phase 2) ─────────────────────────────────────

  /** Fetch a single edge by ID. Returns `null` when no such edge. */
  async getEdge(edgeId: Hex): Promise<Edge | null> {
    void edgeId;
    throw new Error('R Phase 2 — wire to AgentRelationship.getEdge');
  }

  /**
   * List edges where `subject` appears on either side. Optional filter
   * by `relationshipType` and/or `status`. Result order is contract-
   * defined (typically insertion order).
   */
  async listEdgesFor(
    subject: Address,
    filter?: { relationshipType?: RelationshipType; status?: number },
  ): Promise<Edge[]> {
    void subject;
    void filter;
    throw new Error('R Phase 2 — wire to AgentRelationship.listEdgesFor');
  }

  // ─── Writes (wire in Phase 4) ────────────────────────────────────

  /**
   * Propose a new edge. Caller must be authorized to act for `subject`
   * (ERC-1271 against subject's Smart Agent).
   */
  async proposeEdge(input: ProposeEdgeInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.proposeEdge');
  }

  /** Confirm a previously-proposed edge. Caller must be authorized to act for the other side. */
  async confirmEdge(input: ConfirmEdgeInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.confirmEdge');
  }

  /** Revoke an edge. Either subject or object may revoke unilaterally. */
  async revokeEdge(input: RevokeEdgeInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.revokeEdge');
  }

  /** Update the role bag on one side of an existing edge. */
  async setRoles(input: SetRolesInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.setRoles');
  }
}
