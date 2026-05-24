import { createPublicClient, http, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { agentRelationshipAbi } from './abis';
import {
  buildAddRoleCall,
  buildConfirmEdgeCall,
  buildProposeEdgeCall,
  buildRemoveRoleCall,
  buildRevokeEdgeCall,
} from './calls';
import { computeEdgeId } from './edge-id';
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

/**
 * Optional per-call submission context. When provided, the write
 * method submits the encoded call via `walletClient.sendTransaction`.
 * Callers who want to compose into AgentAccount.execute / CustodyPolicy
 * ceremonies / ERC-4337 UserOps should use the pure builders in
 * `./calls` directly.
 */
export interface WriteContext {
  walletClient: WalletClient;
}

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

  // ─── Writes (Phase 4 — live) ─────────────────────────────────────

  /**
   * Propose a new edge. The walletClient's account MUST equal
   * `input.subject` — the contract enforces `msg.sender == subject`.
   * Returns the propose tx hash. The edgeId can be computed
   * off-chain via `computeEdgeId(subject, object, relationshipType)`
   * (matches the on-chain `keccak256(abi.encodePacked(...))`
   * derivation).
   *
   * For PSA-controlled proposals (subject is a Smart Agent gated by
   * CustodyPolicy), use `buildProposeEdgeCall` directly and compose
   * into your AgentAccount.execute / CustodyPolicy ceremony.
   */
  async proposeEdge(input: ProposeEdgeInput, ctx: WriteContext): Promise<Hex> {
    const call = buildProposeEdgeCall({
      relationships: this.relationships,
      subject: input.subject,
      object: input.object,
      relationshipType: input.relationshipType,
      initialRoles: input.subjectRoles,
      metadataURI: input.metadataUri,
      metadataHash: input.metadataHash,
    });
    return await this._submit(ctx, call);
  }

  /**
   * Confirm a PROPOSED edge. The walletClient's account MUST equal
   * the object side (msg.sender == object on chain).
   */
  async confirmEdge(input: ConfirmEdgeInput, ctx: WriteContext): Promise<Hex> {
    const call = buildConfirmEdgeCall({ relationships: this.relationships, edgeId: input.edgeId });
    return await this._submit(ctx, call);
  }

  /**
   * Revoke an edge. Either party may revoke unilaterally (contract
   * checks `msg.sender == subject || msg.sender == object`).
   */
  async revokeEdge(input: RevokeEdgeInput, ctx: WriteContext): Promise<Hex> {
    const call = buildRevokeEdgeCall({ relationships: this.relationships, edgeId: input.edgeId });
    return await this._submit(ctx, call);
  }

  /**
   * Add / remove roles on an existing edge. Either party may modify
   * the edge's role bag.
   *
   * Note: the on-chain `Edge` has a single role bag (no subject/object
   * separation in storage); `SetRolesInput.subjectRoles` +
   * `objectRoles` are coalesced into the same bag. The current set
   * is computed via `getRoles(edgeId)` and the diff is submitted as
   * N add / remove txs.
   */
  async setRoles(input: SetRolesInput, ctx: WriteContext): Promise<Hex[]> {
    const desiredArr: Hex[] = [
      ...(input.subjectRoles ?? []),
      ...(input.objectRoles ?? []),
    ];
    const current = await this.publicClient.readContract({
      address: this.relationships,
      abi: agentRelationshipAbi,
      functionName: 'getRoles',
      args: [input.edgeId],
    });
    const desired = new Set(desiredArr.map((r) => r.toLowerCase()));
    const existing = new Set([...current].map((r) => r.toLowerCase()));
    const toAdd = desiredArr.filter((r) => !existing.has(r.toLowerCase()));
    const toRemove = [...current].filter((r) => !desired.has(r.toLowerCase()));
    const hashes: Hex[] = [];
    for (const role of toAdd) {
      hashes.push(
        await this._submit(
          ctx,
          buildAddRoleCall({ relationships: this.relationships, edgeId: input.edgeId, role: role as never }),
        ),
      );
    }
    for (const role of toRemove) {
      hashes.push(
        await this._submit(
          ctx,
          buildRemoveRoleCall({ relationships: this.relationships, edgeId: input.edgeId, role: role as never }),
        ),
      );
    }
    return hashes;
  }

  /**
   * Submit a single ContractCall via the bound walletClient. Uses
   * explicit nonce fetch + retry on "replacement underpriced" to
   * tolerate Base Sepolia's read-after-write lag.
   */
  private async _submit(ctx: WriteContext, call: { to: Address; value: bigint; data: Hex }): Promise<Hex> {
    const { walletClient } = ctx;
    const account = (walletClient as { account?: { address: Address } }).account;
    if (!account) throw new Error('[agent-relationships] walletClient has no account');
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const nonce = await this.publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        });
        const hash = await walletClient.sendTransaction({
          to: call.to,
          value: call.value,
          data: call.data,
          nonce,
          account: walletClient.account!,
          chain: walletClient.chain ?? null,
        });
        await this.publicClient.waitForTransactionReceipt({ hash });
        return hash;
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message ?? '';
        if (msg.includes('replacement') || msg.includes('underpriced')) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('[agent-relationships] _submit: exceeded retries');
  }
}

/** Re-export for callers that want to compute edge IDs off-chain. */
export { computeEdgeId };

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
