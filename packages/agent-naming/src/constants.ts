/**
 * The TLD for Smart Agent names. Phase 1 ships `.agent` only; the
 * underlying registry contract is multi-root, but the package surface
 * restricts to `.agent` until additional TLDs are spec'd.
 */
export const AGENT_TLD = 'agent' as const;
export type AgentTld = typeof AGENT_TLD;
