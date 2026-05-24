import { createPublicClient, http, type Address, type Hex, type PublicClient } from 'viem';
import { agentRelationshipAbi } from './abis';
import type {
  AgentRelationshipsClientOpts,
  ConfirmEdgeInput,
  Edge,
  ProposeEdgeInput,
  RelationshipType,
  RevokeEdgeInput,
  SetRolesInput,
} from './types';
import { EdgeStatus } from './types';
import { UnknownRelationshipTypeError } from './errors';

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

/**
 * Read + write client for the agent-relationships trust fabric.
 *
 * Phase 2 lands the read paths (`getEdge`, `listEdgesFor`,
 * `getEdgesByObject`) against the live AgentRelationship contract.
 * Writes still throw `R Phase 4` — proposeEdge / confirmEdge /
 * revokeEdge need ERC-1271 auth through the actor's CustodyPolicy.
 *
 * Configuration: `opts.relationships` MUST be the deployed
 * AgentRelationship contract address (recorded in
 * apps/contracts/deployments-<network>.json).
 */
export interface AgentRelationshipsClientOptsLive extends AgentRelationshipsClientOpts {
  relationships: Address;
}

export class AgentRelationshipsClient {
  private readonly publicClient: PublicClient;
  private readonly relationships: Address;

  constructor(readonly opts: AgentRelationshipsClientOptsLive) {
    if (!opts.rpcUrl) throw new Error('[agent-relationships] rpcUrl required');
    if (typeof opts.chainId !== 'number') {
      throw new Error('[agent-relationships] chainId required');
    }
    if (!opts.relationships) {
      throw new Error('[agent-relationships] relationships address required');
    }
    this.publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
    this.relationships = opts.relationships;
  }

  // ─── Reads (Phase 2 — live) ─────────────────────────────────────

  /** Fetch a single edge by ID. Returns `null` when no such edge. */
  async getEdge(edgeId: Hex): Promise<Edge | null> {
    if (edgeId === ZERO_NODE) return null;
    const exists = await this.publicClient.readContract({
      address: this.relationships,
      abi: agentRelationshipAbi,
      functionName: 'edgeExists',
      args: [edgeId],
    });
    if (!exists) return null;
    const tuple = await this.publicClient.readContract({
      address: this.relationships,
      abi: agentRelationshipAbi,
      functionName: 'getEdge',
      args: [edgeId],
    });
    const roles = await this.publicClient.readContract({
      address: this.relationships,
      abi: agentRelationshipAbi,
      functionName: 'getRoles',
      args: [edgeId],
    });
    return _toEdge(tuple, roles);
  }

  /**
   * List edges where `subject` appears on the subject side. Optional
   * client-side filter by `relationshipType` and/or `status`.
   *
   * Order is contract-insertion order. Each edge is fetched in
   * parallel via getEdge.
   */
  async listEdgesFor(
    subject: Address,
    filter?: { relationshipType?: RelationshipType; status?: EdgeStatus },
  ): Promise<Edge[]> {
    const ids = await this.publicClient.readContract({
      address: this.relationships,
      abi: agentRelationshipAbi,
      functionName: 'getEdgesBySubject',
      args: [subject],
    });
    const edges = (
      await Promise.all(ids.map((id) => this.getEdge(id)))
    ).filter((e): e is Edge => e !== null);
    return edges.filter((e) => {
      if (filter?.relationshipType && e.relationshipType !== filter.relationshipType) return false;
      if (filter?.status !== undefined && e.status !== filter.status) return false;
      return true;
    });
  }

  /** Same as `listEdgesFor` but on the object side. */
  async listEdgesPointingAt(
    object: Address,
    filter?: { relationshipType?: RelationshipType; status?: EdgeStatus },
  ): Promise<Edge[]> {
    const ids = await this.publicClient.readContract({
      address: this.relationships,
      abi: agentRelationshipAbi,
      functionName: 'getEdgesByObject',
      args: [object],
    });
    const edges = (
      await Promise.all(ids.map((id) => this.getEdge(id)))
    ).filter((e): e is Edge => e !== null);
    return edges.filter((e) => {
      if (filter?.relationshipType && e.relationshipType !== filter.relationshipType) return false;
      if (filter?.status !== undefined && e.status !== filter.status) return false;
      return true;
    });
  }

  // ─── Writes (wire in Phase 4) ────────────────────────────────────

  async proposeEdge(input: ProposeEdgeInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.proposeEdge via ERC-1271 auth');
  }

  async confirmEdge(input: ConfirmEdgeInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.confirmEdge');
  }

  async revokeEdge(input: RevokeEdgeInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.revokeEdge');
  }

  async setRoles(input: SetRolesInput): Promise<Hex> {
    void input;
    throw new Error('R Phase 4 — wire to AgentRelationship.addRole / removeRole');
  }
}

// ─── Internals ────────────────────────────────────────────────────

interface OnChainEdge {
  edgeId: Hex;
  subject: Address;
  object_: Address;
  relationshipType: Hex;
  status: number;
  createdBy: Address;
  createdAt: bigint;
  updatedAt: bigint;
  metadataURI: string;
  metadataHash: Hex;
}

function _toEdge(t: OnChainEdge, roles: readonly Hex[]): Edge {
  if (t.subject === ZERO || t.object_ === ZERO) {
    throw new UnknownRelationshipTypeError(t.relationshipType);
  }
  return {
    edgeId: t.edgeId,
    subject: t.subject,
    object: t.object_,
    relationshipType: t.relationshipType as RelationshipType,
    subjectRoles: [...roles] as Edge['subjectRoles'],
    objectRoles: [],
    status: t.status as EdgeStatus,
    metadataUri: t.metadataURI || undefined,
    metadataHash: t.metadataHash === ZERO_NODE ? undefined : t.metadataHash,
    createdAt: Number(t.createdAt),
  };
}
