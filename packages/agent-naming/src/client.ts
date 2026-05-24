import type { Address, Hex } from '@agenticprimitives/types';
import type {
  AgentNameRecords,
  AgentNamingClientOpts,
  RegisterSubnameInput,
  SetAgentRecordsInput,
  SetPrimaryNameInput,
  SetSubregistryInput,
} from './types';

/**
 * Read + write client for the Agent Naming Service.
 *
 * Phase 1 ships the API skeleton — read methods throw `NS Phase 2`
 * and write methods throw `NS Phase 4`. The shape is locked so demos
 * can be written against it before contracts deploy.
 *
 * Round-trip discipline (security invariant from spec § 10):
 *   `reverseResolve(agent)` returns a name ONLY when
 *   `resolveName(name) === agent`. The client enforces this on the
 *   read side; the universal resolver enforces it on chain.
 */
export class AgentNamingClient {
  constructor(readonly opts: AgentNamingClientOpts) {
    if (!opts.rpcUrl) throw new Error('[agent-naming] rpcUrl required');
    if (!opts.registry) throw new Error('[agent-naming] registry address required');
    if (!opts.universalResolver) {
      throw new Error('[agent-naming] universalResolver address required');
    }
  }

  // ─── Reads (wire in Phase 2) ─────────────────────────────────────

  /**
   * Resolve an agent name to its forward-record `addr`.
   * Returns `null` when the name is unregistered OR has no `addr` set.
   */
  async resolveName(name: string): Promise<Address | null> {
    void name;
    throw new Error('NS Phase 2 — wire to AgentNameUniversalResolver.resolveName');
  }

  /**
   * Resolve a Smart Agent address back to its primary name.
   * Returns `null` when no primary name is set OR when round-trip
   * verification fails (forward record does not point back to this
   * agent — anti-squat invariant).
   */
  async reverseResolve(agent: Address): Promise<string | null> {
    void agent;
    throw new Error('NS Phase 2 — wire to AgentNameUniversalResolver.reverse');
  }

  /**
   * Read the full record bundle for a name. Returns an empty bundle
   * (no fields set) when the name is unregistered.
   */
  async getRecords(name: string): Promise<AgentNameRecords> {
    void name;
    throw new Error('NS Phase 2 — wire to AgentNameAttributeResolver multi-read');
  }

  // ─── Writes (wire in Phase 4) ────────────────────────────────────

  /**
   * Register `<label>.<parent>` under the parent namespace.
   * Caller's signer MUST be authorized to own subnames of `parent`
   * (either direct owner OR via a subregistry-grant chain).
   */
  async registerSubname(input: RegisterSubnameInput): Promise<Hex> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameRegistry.register + initial-records writes');
  }

  /**
   * Set the reverse-record on a Smart Agent address.
   * Caller's signer MUST authorize the target agent (ERC-1271).
   */
  async setPrimaryName(input: SetPrimaryNameInput): Promise<Hex> {
    void input;
    throw new Error('NS Phase 4 — wire to PrimaryName resolver setPrimaryName');
  }

  /**
   * Write records for a name. Returns one tx hash per record set
   * (the caller may batch via the universal resolver's multicall
   * once available).
   */
  async setAgentRecords(input: SetAgentRecordsInput): Promise<Hex[]> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameAttributeResolver setText');
  }

  /**
   * Delegate child-name issuance authority to a subregistry.
   * Setting `subregistry = address(0)` reverts to the default.
   */
  async setSubregistry(input: SetSubregistryInput): Promise<Hex> {
    void input;
    throw new Error('NS Phase 4 — wire to AgentNameRegistry.setSubregistry');
  }
}
