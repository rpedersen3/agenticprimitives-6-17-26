# Relying-site authority is a scoped delegation, not a custody credential

**Decision:** [ADR-0019](../../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md) ·
**Implementing spec:** [spec 229 §5.1/§6](../../../specs/229-personal-central-auth.md) ·
**Doctrine line:** [ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)

This package owns the primitive behind a cross-origin/relying-site sign-in. This
doc records *why* that authority is a **delegation** and not a **custody
credential** — the trade considered, the option rejected, and the shape we ship.

## The problem

A person has one canonical Smart Agent (SA), reachable from many web apps. A
relying site (a separate origin) needs to "sign in as me and act on my behalf, on
that site." The naive implementation made the relying site's per-site key a
**custodian** of the person's SA (`AgentAccount.addPasskey`), with runtime auth as
`isCustodian`.

That is the system's worst-case authority grant. A custodian is a **full master
key**: it can sign anything, `addCustodian`, `removePasskey`, rotate, recover. So a
single relying-site compromise (XSS, a malicious site, a supply-chain hit) =
**full takeover of the canonical identity** and every org it governs.

## The two options considered

| | **A — per-credential custody roles** | **B — scoped delegation** *(chosen)* |
| --- | --- | --- |
| What the site key is | a custodian, but "narrow" via a new on-chain `role`/`canAddCredentials` flag | a **delegate** — not a custodian at all |
| Where scoping lives | inside `AgentAccount` (the custody core) | in **caveat enforcers** (the agency layer) |
| Blast radius if site compromised | bounded only by the correctness of a new authorization branch in the most security-sensitive contract | bounded by the delegation's caveats; revocable; can never touch custody |
| Contract work | change + redeploy the custody core; new role enforcement + tests | **none** — `DelegationManager` + enforcers already deployed |
| Doctrine | **violates** the [spec 213](../../../specs/213-custody-layer-carve-out.md) custody/agency firewall (authority-scoping smuggled into custody) | **honors** it — scoping is the agency layer's job |

## Why B (the trade)

1. **A relying site is a *delegate*, not a *credential*.** It acts *for* you within
   bounds; it never authenticates *as* you. [ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)'s
   line — "credential add/replace/remove … NEVER a delegation" — forbids making a
   relying site a *credential*. It does **not** forbid the person *delegating scoped
   authority* to one. That is exactly what this package is for.
2. **Least privilege + revocability.** A delegation is caveated (targets, methods,
   value, time) and revocable (`revokeDelegationByOwner`). A custodian is neither.
3. **The custody core stays a binary custodian set.** No `role`/`scope` flags leak
   into `AgentAccount`. Authority-scoping is caveats — the firewall holds.
4. **Free on-chain.** No new contracts, no redeploy: `DelegationManager` + the
   `Timestamp`/`AllowedTargets`/`AllowedMethods`/`Value` enforcers are deployed on
   Base Sepolia; this package is the off-chain SDK.

**Closure:** a compromised relying site can only exercise its own caveated
delegation until revoked — it cannot add credentials, recover, or take over the
identity.

## The shape (what to build with this package)

```
Delegation {
  delegator: personAgent     // the canonical SA (the ONLY thing with custody)
  delegate:  siteKey          // the relying site's local key (PIA / session key)
  caveats:   [ Timestamp(validUntil), AllowedTargets([...]), AllowedMethods([...]),
               Value(0) ]      // least-privilege; tune per relying site
  signature: ERC-1271 over hashDelegation, produced by the person's ROOT credential
}
```

- **Issue** (at the person's central auth, signed by the ROOT credential):
  `DelegationClient.issueDelegation({ delegate, caveats })` — or, for a passkey
  signer, build the `Delegation`, compute `hashDelegation(d, chainId, delegationManager)`,
  sign that digest with the ROOT passkey (the same WebAuthn path that signs UserOps),
  and attach the encoded signature. The SA's ERC-1271 `isValidSignature` validates it.
- **Runtime auth at the relying site:** the site key asserts (proving it holds the
  delegate key) AND a **live, unrevoked, in-window** delegation exists from the
  person SA to that key (`isValidSignature(hashDelegation, signature)` on the SA +
  `isRevoked(hash) === false` on the `DelegationManager` + caveats evaluated) →
  issue a **scoped (login-grade) session**. This is NOT an `isCustodian` check.
- **Act on the person's behalf:** the site key **redeems** the delegation via
  `DelegationManager.redeemDelegation(...)` (gasless UserOp); caveats enforce
  on-chain. No session grade can exceed the caveats.
- **Revoke:** `revokeDelegationByOwner(delegation)` — delegator or delegate.

## What this is NOT

- **NOT** a way to gain custody powers. A delegated party MUST NOT add/remove
  credentials or recover the agent — those require the ROOT credential, on-chain
  ([ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) /
  [ADR-0017](../../../docs/architecture/decisions/0017-oidc-social-is-a-login-facet-not-custody.md)).
- **NOT** the org's custody. An Organization SA is a separate agent; its own
  custodians are a different question (spec 229 §7). ADR-0019 is about the *person* SA.

## Consumer

`apps/demo-org` (relying site) + `apps/demo-sso` (the person's central auth) —
see [`apps/demo-sso/docs/central-auth.md`](../../../apps/demo-sso/docs/central-auth.md)
and spec 229 §6. Implemented in spec-229 phase **P6**.
