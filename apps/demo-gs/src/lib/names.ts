// Address → friendly-name resolver (Wave 2). With the deterministic fixture identities gone, the only
// human-readable labels come from REAL connected members (Jane's member registry) + the Switchboard
// bridge provenance. AddrChip + directory render synchronously, so the store seeds this sync cache
// from the member registry whenever it hydrates the broker view. Pure display — never load-bearing.

const _names = new Map<string, string>();

/** Replace the known-name cache (called by the store after it loads Jane's member registry). */
export function setKnownNames(entries: Array<{ sa: string; label: string }>): void {
  _names.clear();
  for (const e of entries) _names.set(e.sa.toLowerCase(), e.label);
}

/** A friendly name for an address, if a connected member maps to it; otherwise undefined. */
export function agentName(addr?: string): string | undefined {
  return addr ? _names.get(addr.toLowerCase()) : undefined;
}
