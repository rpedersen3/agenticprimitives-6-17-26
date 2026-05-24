import { createPublicClient, http, keccak256, toHex, type Address, type Hex, type PublicClient } from 'viem';
import { agentProfileResolverAbi } from './abis';
import { profileContentHash, canonicalProfileJson } from './profile';
import { ProfileHashMismatchError } from './errors';
import type {
  AgentCard,
  AgentIdentityClientOpts,
  PublishProfileInput,
  VerificationMethod,
} from './types';

const ZERO_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
const ATL_METADATA_URI  = keccak256(toHex('atl:metadataURI'));
const ATL_METADATA_HASH = keccak256(toHex('atl:metadataHash'));

/**
 * Read + write client for agent identity profiles.
 *
 * Phase 2 lands the `fetchProfile` read path against the live
 * AgentProfileResolver: read `metadata-uri` + `metadata-hash`,
 * HTTP-fetch the JSON, verify the canonical-JSON content-hash
 * matches the on-chain anchor (anti-mutation invariant).
 *
 * Configuration: `opts.profileResolver` MUST be the deployed
 * AgentProfileResolver contract address.
 */
export interface AgentIdentityClientOptsLive extends AgentIdentityClientOpts {
  profileResolver: Address;
  /** Optional fetcher (test injection). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

export class AgentIdentityClient {
  private readonly publicClient: PublicClient;
  private readonly profileResolver: Address;
  private readonly fetcher: typeof fetch;

  constructor(readonly opts: AgentIdentityClientOptsLive) {
    if (!opts.rpcUrl) throw new Error('[agent-identity] rpcUrl required');
    if (typeof opts.chainId !== 'number') {
      throw new Error('[agent-identity] chainId required');
    }
    if (!opts.profileResolver) {
      throw new Error('[agent-identity] profileResolver address required');
    }
    this.publicClient = createPublicClient({ transport: http(opts.rpcUrl) });
    this.profileResolver = opts.profileResolver;
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ─── Reads (Phase 2 — live) ─────────────────────────────────────

  /**
   * Fetch the AgentCard for `agent`:
   *   1. Read `atl:metadataURI` + `atl:metadataHash` from the
   *      AgentProfileResolver (on-chain anchor).
   *   2. HTTP-fetch the JSON at metadataURI.
   *   3. Compute `profileContentHash(parsed)` over canonical JSON.
   *   4. Compare against the on-chain hash; throw on mismatch
   *      (anti-mutation invariant — spec 217 § 6).
   *
   * Returns `null` when no profile is published OR the agent has no
   * `atl:metadataURI` record (treated equivalently — the on-chain
   * anchor is absent).
   */
  async fetchProfile(agent: Address): Promise<AgentCard | null> {
    const [uri, anchorHash] = await Promise.all([
      this.publicClient.readContract({
        address: this.profileResolver,
        abi: agentProfileResolverAbi,
        functionName: 'getStringProperty',
        args: [agent, ATL_METADATA_URI],
      }),
      this.publicClient.readContract({
        address: this.profileResolver,
        abi: agentProfileResolverAbi,
        functionName: 'getBytes32Property',
        args: [agent, ATL_METADATA_HASH],
      }),
    ]);
    if (!uri || uri === '') return null;
    const response = await this.fetcher(uri);
    if (!response.ok) {
      throw new Error(`[agent-identity] failed to fetch profile JSON: HTTP ${response.status}`);
    }
    const body = await response.text();
    const parsed = JSON.parse(body) as AgentCard;
    // Round-trip via our canonical serializer to validate shape AND
    // produce the canonical content hash to compare against the anchor.
    const canonical = canonicalProfileJson(parsed);
    void canonical; // forces validation
    const computed = profileContentHash(parsed);
    if (anchorHash !== ZERO_NODE && computed !== anchorHash) {
      throw new ProfileHashMismatchError(anchorHash, computed);
    }
    return parsed;
  }

  /**
   * Verify endpoint control for an MCP server profile. Phase 2
   * scope: shape-only (caller declares which method). Real
   * verification (DNS TXT lookup, signed-URL recovery, HTTP
   * challenge, VP signature) ships in a follow-up.
   */
  async verifyEndpoint(
    agent: Address,
    endpoint: string,
    methods: VerificationMethod[],
  ): Promise<VerificationMethod | null> {
    void agent;
    void endpoint;
    void methods;
    throw new Error(
      'I Phase 2.5 — endpoint verification ships separately; ' +
        'wire DNS-TXT / signed-URL / HTTP-challenge / VP after Phase 2 lands',
    );
  }

  // ─── Writes (wire in Phase 4) ────────────────────────────────────

  async publishProfile(input: PublishProfileInput): Promise<Hex> {
    void input;
    throw new Error('I Phase 4 — wire canonical-JSON upload + AgentProfileResolver.setMetadata');
  }
}
