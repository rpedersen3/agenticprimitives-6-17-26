---
"@agenticprimitives/vault": patch
---

Fix envelope decryption with context-deriving DEK wrappers (e.g. key-custody's HKDF
`LocalAesProvider`). `sealEnvelope` generated the DEK under an `aadContext` whose
`keyVersion` was `''` (it isn't known until the wrapper returns), while `openEnvelope`
unwrapped under the real `keyVersion` — so any wrapper that derives the key from the
context (HKDF) produced a different key on unwrap and AES-GCM decryption failed. The DEK
wrap now uses a `keyVersion`-free context on BOTH seal and open (`owner`/`resource`/
`classification` still bind the DEK to its object); `keyVersion` remains bound in the
payload AES-GCM AAD. Adds a regression test using a context-deriving wrapper (the prior
mock ignored `aadContext` on unwrap, masking the bug).
