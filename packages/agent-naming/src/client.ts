import { createPublicClient, http, parseAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import {
  agentNameAttributeResolverAbi,
  agentNameRegistryAbi,
  agentNameUniversalResolverAbi,
} from './abis';
import {
  PREDICATE_ID,
  decodeRecords,
  type DecodeInput,
} from './records';
import type {
  AgentNameRecords,
  AgentNamingClientOpts,
  RegisterSubnameInput,
  SetAgentRecordsInput,
  SetPrimaryNameInput,
  SetSubregistryInput,
} from './types';
import { namehash, ZERO_NODE } from './namehash';
import { normalizeAgentName } from './normalize';

/**
 * Read + write client for the Agent Naming Service.
 *
 * Phase 2 lands the read paths (resolveName / reverseResolve /
 * getRecords) against the live AgentNameUniversalResolver +
 * AgentNameAttributeResolver. Write methods still throw `NS Phase 4`
 * — they need ERC-1271 auth + the agent-naming/custody call builders.
 *
 * Round-trip discipline (security invariant from spec § 10):
 *   `reverseResolve(agent)` returns a name ONLY when the on-chain
 *   `resolveName(name) === agent`. The universal resolver enforces this
 *   on chain; we additionally reconstruct the dotted name off chain by
 *   walking the `NameRegistered` event log up the parent chain.
 */
export class AgentNamingClient {
  private readonly publicClient: PublicClient;

  constructor(readonly opts: AgentNamingClientOpts) {
    if (!opts.rpcUrl) throw new Error('[agent-naming] rpcUrl required');
    if (!opts.registry) throw new Error('[agent-naming] registry address required');
    if (!opts.universalResolver) {
      throw new Error('[agent-naming] universalResolver address required');
    }
    this.publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
  }

  // ─── Reads (Phase 2 — live) ─────────────────────────────────────

  /**
   * Resolve an agent name to its forward-record address. Returns
   * `null` when the name is unregistered OR no `addr` record is set.
   *
   * Reads via `UniversalResolver.resolveName(node)` which:
   *   1. Tries `resolver.getAddress(node, ATL_ADDR)`.
   *   2. Falls back to `registry.owner(node)` if no resolver-addr set.
   */
  async resolveName(name: string): Promise<Address | null> {
    const node = namehash(name);
    if (node === ZERO_NODE) return null;
    const addr = await this.publicClient.readContract({
      address: this.opts.universalResolver,
      abi: agentNameUniversalResolverAbi,
      functionName: 'resolveName',
      args: [node],
    });
    if (addr === '0x0000000000000000000000000000000000000000') return null;
    return addr as Address;
  }

  /**
   * Reverse-resolve a Smart Agent address to its primary name string.
   * Returns `null` when no primary name is set OR the round-trip
   * check fails on chain (squat protection).
   *
   * The contract returns the namehash node; we walk up the parent
   * chain via `NameRegistered` events to reconstruct the dotted
   * label string.
   */
  async reverseResolve(agent: Address): Promise<string | null> {
    const node = await this.publicClient.readContract({
      address: this.opts.universalResolver,
      abi: agentNameUniversalResolverAbi,
      functionName: 'reverseResolve',
      args: [agent],
    });
    if (node === ZERO_NODE) return null;
    return await this._reconstructName(node);
  }

  /**
   * Read the full typed record bundle for a name. Returns an empty
   * bundle when the name has no resolver / no records set.
   */
  async getRecords(name: string): Promise<AgentNameRecords> {
    const node = namehash(name);
    if (node === ZERO_NODE) return {};

    // Read the resolver address from the registry; if none, return empty.
    const resolverAddr = await this.publicClient.readContract({
      address: this.opts.registry,
      abi: agentNameRegistryAbi,
      functionName: 'resolver',
      args: [node],
    });
    if (resolverAddr === '0x0000000000000000000000000000000000000000') return {};

    // String predicates batched through the universal resolver
    // (single multi-call for everything that's stored as string).
    const stringPreds: Hex[] = [
      PREDICATE_ID.displayName,
      PREDICATE_ID.a2aEndpoint,
      PREDICATE_ID.mcpEndpoint,
      PREDICATE_ID.metadataUri,
      PREDICATE_ID.nativeId,
    ];
    const stringValues = await this.publicClient.readContract({
      address: this.opts.universalResolver,
      abi: agentNameUniversalResolverAbi,
      functionName: 'resolveStringBatch',
      args: [node, stringPreds],
    });

    // Address + bytes32 predicates — direct getter calls against the
    // resolver (no batch path on chain yet; per-call is cheap for the
    // small constant set we have).
    const [addr, custodyPolicy] = await Promise.all([
      this.publicClient.readContract({
        address: resolverAddr as Address,
        abi: agentNameAttributeResolverAbi,
        functionName: 'getAddress',
        args: [node, PREDICATE_ID.addr],
      }),
      this.publicClient.readContract({
        address: resolverAddr as Address,
        abi: agentNameAttributeResolverAbi,
        functionName: 'getAddress',
        args: [node, PREDICATE_ID.custodyPolicy],
      }),
    ]);
    const [agentKind, metadataHash, passkeyDigest] = await Promise.all([
      this.publicClient.readContract({
        address: resolverAddr as Address,
        abi: agentNameAttributeResolverAbi,
        functionName: 'getBytes32',
        args: [node, PREDICATE_ID.agentKind],
      }),
      this.publicClient.readContract({
        address: resolverAddr as Address,
        abi: agentNameAttributeResolverAbi,
        functionName: 'getBytes32',
        args: [node, PREDICATE_ID.metadataHash],
      }),
      this.publicClient.readContract({
        address: resolverAddr as Address,
        abi: agentNameAttributeResolverAbi,
        functionName: 'getBytes32',
        args: [node, PREDICATE_ID.passkeyCredentialDigest],
      }),
    ]);

    const input: DecodeInput = { strings: {}, addresses: {}, bytes32s: {} };
    input.strings[PREDICATE_ID.displayName] = stringValues[0]!;
    input.strings[PREDICATE_ID.a2aEndpoint] = stringValues[1]!;
    input.strings[PREDICATE_ID.mcpEndpoint] = stringValues[2]!;
    input.strings[PREDICATE_ID.metadataUri] = stringValues[3]!;
    input.strings[PREDICATE_ID.nativeId]    = stringValues[4]!;
    if (addr !== '0x0000000000000000000000000000000000000000') {
      input.addresses[PREDICATE_ID.addr] = addr as `0x${string}`;
    }
    if (custodyPolicy !== '0x0000000000000000000000000000000000000000') {
      input.addresses[PREDICATE_ID.custodyPolicy] = custodyPolicy as `0x${string}`;
    }
    if (agentKind !== ZERO_NODE) input.bytes32s[PREDICATE_ID.agentKind] = agentKind as Hex;
    if (metadataHash !== ZERO_NODE) input.bytes32s[PREDICATE_ID.metadataHash] = metadataHash as Hex;
    if (passkeyDigest !== ZERO_NODE) input.bytes32s[PREDICATE_ID.passkeyCredentialDigest] = passkeyDigest as Hex;

    return decodeRecords(input);
  }

  // ─── Writes (wire in Phase 4) ────────────────────────────────────

  async registerSubname(input: RegisterSubnameInput): Promise<Hex> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameRegistry.register + initial-records writes');
  }

  async setPrimaryName(input: SetPrimaryNameInput): Promise<Hex> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameRegistry.setPrimaryName');
  }

  async setAgentRecords(input: SetAgentRecordsInput): Promise<Hex[]> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameAttributeResolver typed setters');
  }

  async setSubregistry(input: SetSubregistryInput): Promise<Hex> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameRegistry.setSubregistry');
  }

  // ─── Internals ──────────────────────────────────────────────────

  /**
   * Reconstruct the dotted name for `node` by walking up the parent
   * chain via `NameRegistered` events. Each event carries the label
   * as its `label` field (indexed by `node`), so a single
   * `getLogs` per ancestor returns the label deterministically.
   *
   * Returns `null` if any ancestor's event is missing (would indicate
   * a broken chain, e.g. stale state where a node exists but
   * `NameRegistered` was never emitted — shouldn't happen).
   */
  private async _reconstructName(startNode: Hex): Promise<string | null> {
    const labels: string[] = [];
    let current = startNode;
    const registeredEvent = parseAbiItem(
      'event NameRegistered(bytes32 indexed node, bytes32 indexed parent, string label, address owner, address resolver, uint64 expiry)',
    );
    const rootEvent = parseAbiItem(
      'event RootInitialized(bytes32 indexed rootNode, string label, address indexed owner, bytes32 kind)',
    );
    for (let depth = 0; depth < 10; depth++) {
      if (current === ZERO_NODE) break;
      const logs = await this.publicClient.getLogs({
        address: this.opts.registry,
        event: registeredEvent,
        args: { node: current },
        fromBlock: 0n,
      });
      if (logs.length === 0) {
        const rootLogs = await this.publicClient.getLogs({
          address: this.opts.registry,
          event: rootEvent,
          args: { rootNode: current },
          fromBlock: 0n,
        });
        if (rootLogs.length === 0) return null;
        const label = rootLogs[0]!.args.label;
        if (label) labels.push(label);
        break;
      }
      const { label, parent } = logs[0]!.args;
      if (label) labels.push(label);
      current = (parent ?? ZERO_NODE) as Hex;
    }
    if (labels.length === 0) return null;
    const name = labels.join('.');
    return normalizeAgentName(name) === name ? name : name.toLowerCase();
  }
}
