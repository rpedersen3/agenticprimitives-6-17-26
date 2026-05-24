import { createPublicClient, http, keccak256, toHex, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { agentProfileResolverAbi } from './abis';
import { profileContentHash, canonicalProfileJson } from './profile';
import { ProfileHashMismatchError } from './errors';
import {
  buildRegisterProfileCall,
  buildSetProfileMetadataCall,
} from './calls';
import type {
  AgentCard,
  AgentIdentityClientOpts,
  PublishProfileInput,
  VerificationMethod,
} from './types';

/**
 * Optional per-call submission context. Required for write methods.
 */
export interface WriteContext {
  walletClient: WalletClient;
}

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

  // ─── Writes (Phase 4 — live) ─────────────────────────────────────

  /**
   * Publish a profile by:
   *   1. Validating the AgentCard + computing its canonical
   *      content-hash.
   *   2. (If `expectedHash` set) asserting it matches our computed
   *      hash — anti-spoof self-check.
   *   3. (If agent is not yet registered AND `registerWith` is set)
   *      calling AgentProfileResolver.register first.
   *   4. Calling AgentProfileResolver.setMetadata(metadataURI,
   *      contentHash) to anchor the profile.
   *
   * The walletClient's account MUST equal `input.agent` — the
   * contract enforces `msg.sender == agent`.
   *
   * Storage is OUT OF SCOPE for this SDK (per ADR-0007): the caller
   * uploads the canonical JSON to `metadataURI` BEFORE calling this
   * method. Use `canonicalProfileJson(input.profile)` to produce the
   * exact bytes that hash to the on-chain anchor.
   *
   * Returns the metadata-set tx hash (the canonical "I've published"
   * marker). If `register` was called, that tx is awaited first.
   */
  async publishProfile(input: PublishProfileInput, ctx: WriteContext): Promise<Hex> {
    // Validate + compute hash.
    canonicalProfileJson(input.profile); // throws on invalid shape
    const computed = profileContentHash(input.profile);
    if (input.expectedHash && input.expectedHash.toLowerCase() !== computed.toLowerCase()) {
      throw new ProfileHashMismatchError(input.expectedHash, computed);
    }
    // Register first if needed.
    const isRegistered = await this.publicClient.readContract({
      address: this.profileResolver,
      abi: agentProfileResolverAbi,
      functionName: 'isRegistered',
      args: [input.agent],
    });
    if (!isRegistered) {
      const registerCall = buildRegisterProfileCall({
        profileResolver: this.profileResolver,
        agent: input.agent,
        displayName: input.registerWith?.displayName,
        description: input.registerWith?.description,
        agentKind: input.registerWith?.agentKind,
        profileSchemaURI: input.registerWith?.profileSchemaURI,
      });
      await this._submit(ctx, registerCall);
      // Base Sepolia uses a load-balanced RPC pool; the next read
      // can hit a node that hasn't yet observed our register tx.
      // Poll isRegistered until true (cap at 10×2 s = 20 s) so the
      // subsequent setMetadata simulation sees the new state.
      for (let i = 0; i < 10; i++) {
        const ok = await this.publicClient.readContract({
          address: this.profileResolver,
          abi: agentProfileResolverAbi,
          functionName: 'isRegistered',
          args: [input.agent],
        });
        if (ok) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    // Set the metadata anchor.
    const setCall = buildSetProfileMetadataCall({
      profileResolver: this.profileResolver,
      agent: input.agent,
      metadataURI: input.metadataURI,
      metadataHash: computed,
    });
    return await this._submit(ctx, setCall);
  }

  /**
   * Submit a single ContractCall via the bound walletClient. Uses
   * explicit nonce fetch + retry on "replacement underpriced".
   */
  private async _submit(ctx: WriteContext, call: { to: Address; value: bigint; data: Hex }): Promise<Hex> {
    const { walletClient } = ctx;
    const account = (walletClient as { account?: { address: Address } }).account;
    if (!account) throw new Error('[agent-identity] walletClient has no account');
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
    throw lastErr instanceof Error ? lastErr : new Error('[agent-identity] _submit: exceeded retries');
  }
}
