import type { Address, Hex } from '@agenticprimitives/types';
import type {
  AgentCard,
  AgentIdentityClientOpts,
  PublishProfileInput,
  VerificationMethod,
} from './types';

/**
 * Read + write client for agent identity profiles.
 *
 * Phase 1 ships the API skeleton — reads throw `I Phase 2`, writes
 * throw `I Phase 4`. The shape is locked so demos can be written
 * against it before contracts deploy.
 *
 * Round-trip discipline (security invariant from spec § 6):
 *   `fetchProfile` MUST refuse a profile whose `profileContentHash`
 *   does not match the on-chain `metadata-hash` record. The client
 *   throws `ProfileHashMismatchError` rather than returning a profile
 *   that diverges from its anchor.
 */
export class AgentIdentityClient {
  constructor(readonly opts: AgentIdentityClientOpts) {
    if (!opts.rpcUrl) throw new Error('[agent-identity] rpcUrl required');
    if (typeof opts.chainId !== 'number') {
      throw new Error('[agent-identity] chainId required');
    }
  }

  // ─── Reads (wire in Phase 2) ─────────────────────────────────────

  /**
   * Fetch the off-chain `AgentCard` for a Smart Agent. Resolves the
   * profile via the agent-naming `metadata-uri` record, fetches it,
   * and asserts its content-hash matches the on-chain `metadata-hash`.
   * Returns `null` when no profile is published.
   */
  async fetchProfile(agent: Address): Promise<AgentCard | null> {
    void agent;
    throw new Error('I Phase 2 — wire to agent-naming records + metadata-uri fetch + hash assert');
  }

  /**
   * Verify endpoint control for an MCP server profile.
   * Each declared `VerificationMethod` is evaluated; the first one
   * to pass wins. Returns the passing method, or `null` if none pass.
   */
  async verifyEndpoint(
    agent: Address,
    endpoint: string,
    methods: VerificationMethod[],
  ): Promise<VerificationMethod | null> {
    void agent;
    void endpoint;
    void methods;
    throw new Error('I Phase 2 — wire each VerificationMethod (DNS TXT / signed URL / HTTP / VP)');
  }

  // ─── Writes (wire in Phase 4) ────────────────────────────────────

  /**
   * Publish a profile for a Smart Agent. The client:
   *   1. computes `profileContentHash(profile)`,
   *   2. (if `input.expectedHash` set) asserts the computed hash
   *      matches the caller's expectation,
   *   3. uploads canonical JSON to the configured off-chain store,
   *   4. writes `metadata-uri` + `metadata-hash` records via
   *      `agent-naming` (caller wires the AgentNamingClient).
   *
   * Returns the published content-hash (the on-chain anchor).
   */
  async publishProfile(input: PublishProfileInput): Promise<Hex> {
    void input;
    throw new Error('I Phase 4 — wire canonical-JSON upload + agent-naming records.update');
  }
}
