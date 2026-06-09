# Audit 2026-06-09 — Remediation Status

Branch: `harden/audit-2026-06-09`. Source reports:
[package audit](./2026-06-09-independent-package-audit.md) + [contracts audit](./2026-06-09-independent-contracts-audit.md).

Every fix below ships with a regression test that fails on the pre-fix behaviour. Cross-stack
contract fixes are locked by `check:eip712-typehash-equality`; the TS byte-packing was verified
equal to `abi.encode` in each case.

## Closed (committed + tested)

| Finding | Sev | Commit | Tests |
| --- | --- | --- | --- |
| VC-1 / VC-2 — fail-open verifier + unbound EIP-712 domain | P0 | `a8027d3` | 29 |
| AN-1 — un-normalized registration labels | High | `d579de0` | +3 |
| KC-001 — raw session privateKey exposed on `SessionResolveResult` | Med | `d579de0` | — |
| CN-1 — `expectedIss` optional in `verifyAgentSession` | Med | `d579de0` | +3 |
| CA-001 — SIWE nonce caller-optional (+ demo-a2a one-shot consume) | Med | `d579de0` | +2 |
| SC-1 — AgreementRegistry issuer sig not bound to contents | **Crit** | `a8254fc` | 12 + 15 |
| SC-2 — attestation subject spoofing | High | `3cd1017` | 22 + 11 |
| SC-3 — view verifier fail-open on no-code enforcer | Med | `d2cf821` | +1 |
| SC-4 — `.impact` root owned by hot deployer EOA | Med | `d2cf821` | (deploy) |
| SC-5 — paymaster deploy defaults governance/owner to deployer | Med | `d2cf821` | (deploy) |

## DEL-001 (Critical) — in progress

Design (confirmed with stakeholder): the *remediation* is **verification-only / key-free**, and the
app layer is structured so it holds.

- **Verify side — DONE** (this branch): `verifyDelegationToken` now enforces, under
  `requireSessionDelegateBinding`, a `sessionDelegation` leaf whose `delegator === delegation.delegate`
  and `delegate === sessionKeyAddress`, ERC-1271-signed by that delegate SA. `principal` stays the
  person (`delegation.delegator`). Pure-logic checks extracted to `sessionDelegateBindingError` (unit
  tested); ERC-1271 of the leaf verified inline. **No signer added — MCP stays a verifier.** The opt
  defaults off so nothing breaks until the minter is wired; flipping it on (in demo-mcp) is the switch.
- **App side — TODO**: demo-a2a's session path must mint the token against a `sessionDelegation` leaf
  `appSA → sessionKey`, signed by the relying app's delegate-SA operator key (the *existing* signing
  path — **no new env private key**). The relying app holds the delegate key, so this is the
  "relying-app-signs" handshake (session key minted → leaf signed by the delegate SA → token). Then
  flip `requireSessionDelegateBinding` on in demo-mcp + redeploy.

## Deferred — GCP-KMS hardening (separate wave, acceptance criteria)

Pre-existing gaps; NOT introduced by any audit fix. Confirmed in scope only for **GCP KMS**
(local-aes dev path + AWS explicitly out of scope per stakeholder). Enforcement gates already exist:
`buildSignerBackend`'s production-throw (rejects the local master key unless
`A2A_ALLOW_LOCAL_MASTER_KEY=true`) + `check:forbidden-terms`.

1. **spec-235 §10 — GCP per-subject KMS derivation.** `deriveSubjectSigner` (derive-subject.ts)
   throws for `gcp-kms`, so `demo-a2a/custody-google.ts` feeds `A2A_MASTER_PRIVATE_KEY` from the
   Worker env. Acceptance: a Google member's a2a custody derivation happens inside the HSM (per-subject
   KMS key / HMAC), so no master signing key is required in env. **Main blocker for "no env signing key".**
2. **HSM-back the delegation session signer.** `SessionManager.resolve()` decrypts the session key
   into Worker memory and signs in-process (noble). Not in env, not plaintext at rest, but not
   HSM-resident. Acceptance: session signing moves behind a `KmsAccountBackend` (gcp-kms) so raw key
   material never exists in the process.

Note (flag to stakeholders): KMS backends still read IAM credentials from env
(`GCP_SERVICE_ACCOUNT_JSON` or instance metadata) — an *access credential* to call the HSM, not the
signing key. For "no secret in env at all", use workload identity / instance metadata.

## Confirmed key posture of the committed fixes

- No fix introduces a `privateKeyToAccount(env.X)` signer (whole-branch diff verified).
- No `mcp-runtime` / `demo-mcp` file touched for signing — MCP stays a pure verifier.
- SC-1/SC-2 issuer signing reuses demo-jp's existing `personaSignHash` (the demo operator-key path —
  accepted testnet C-1 hole, spec 248); only the signed *digest* changed, not the signer.
