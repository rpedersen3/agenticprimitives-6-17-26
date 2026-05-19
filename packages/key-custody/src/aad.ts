// AAD canonicalization. The caller supplies a Record<string, string>; we sort
// keys, JSON-encode each value, and produce a deterministic byte string used
// both as AES-GCM AAD and as KMS EncryptionContext. AAD-bound trip-wire:
// changing any field invalidates BOTH the AES-GCM tag (when the caller wraps
// it at the payload layer) AND the HKDF derivation here.

export function canonicalContextBytes(ctx: Record<string, string>): Uint8Array {
  const keys = Object.keys(ctx).sort();
  // Format: key1=value1;key2=value2 (values URI-encoded to disambiguate '=' and ';')
  const parts: string[] = [];
  for (const k of keys) {
    const v = ctx[k];
    if (typeof v !== 'string') {
      throw new Error(`canonicalContextBytes: value for "${k}" must be a string`);
    }
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return new TextEncoder().encode(parts.join(';'));
}
