# ADR-0019 — A relying site's authority is a scoped delegation, not a custody credential

**Status:** Accepted (2026-05-26).
**Related:** [spec 229](../../../specs/229-personal-central-auth.md) (implementing spec),
[ADR-0011](./0011-credential-recovery-and-re-association.md) (credential ≠ delegation — load-bearing),
[ADR-0014](./0014-connect-is-an-sso-broker.md) (broker owns the ceremony),
[ADR-0017](./0017-oidc-social-is-a-login-facet-not-custody.md) (login-grade vs custody-grade sessions),
[spec 213](../../../specs/213-custody-layer-carve-out.md) (custody/agency firewall),
[spec 212](../../../specs/212-agent-centric-delegation.md) + [spec 208](../../../specs/208-argument-level-caveats.md) (delegation + caveats).

---

## Context

Spec 229 lets a person reach their one canonical Smart Agent from many web apps. A
relying site (separate origin) needs a way to "sign in as you and act on your
behalf, on that site." The first implementation made the relying site's per-site
passkey a **custodian** of the person's canonical Smart Agent (via
`AgentAccount.addPasskey`), and ran runtime auth as on-chain `isCustodian`.

A security review found this is the system's worst-case authority grant (finding
F4): a custodian is a **full master key** — it can sign anything, `addCustodian`,
`removePasskey`, rotate, recover. So a single relying-site compromise (XSS, a
malicious site, supply chain) = **full takeover of the canonical identity** and
every org it governs. "Narrowing" a custodian with a new on-chain `role`/`scope`
flag (the other option considered) only moves authority-scoping *into the custody
core* — exactly what the spec-213 custody/agency firewall exists to prevent — and
enlarges the most security-sensitive contract in the repo.

The repo already has the right primitive for "let principal B act for principal A
within bounds": the **ERC-7710 delegation** stack (`DelegationManager` + caveat
enforcers), deployed on Base Sepolia, with an off-chain SDK in
`packages/delegation`.

## Decision

> **A relying site is a *delegate* of the person's Smart Agent, never a *custodian*
> of it. The person SA issues the relying-site key a caveated, revocable ERC-7710
> delegation. The person's ROOT/primary credential remains the SA's only custodian.**

1. **Delegate, not credential.** A relying-site key never authenticates *as* the
   person (never a custodian). It *acts for* the person within caveats. This is
   ADR-0011's credential-vs-delegation line applied to cross-site enrollment: the
   "credential add … NEVER a delegation" rule forbids making a relying site a
   *credential*; it does not forbid the person *delegating scoped authority* to one.
2. **Runtime relying-site auth = "holds a live, unrevoked, in-window delegation,"
   not `isCustodian`.** The resulting `AgentSession` is **scoped / login-grade**
   (ADR-0017): it can read and act within the delegation's caveats, and can never
   rotate credentials, change custody, recover, or exceed its value/target/method
   caveats.
3. **No per-credential role flags in the custody core.** Authority scoping is the
   agency layer's job (caveat enforcers), per the spec-213 firewall. `AgentAccount`
   keeps a binary custodian set; the relying-site scoping lives entirely in caveats.
4. **Enrollment authority is server-minted.** The person's central-auth **server**
   (demo-sso Pages Functions) validates `aud` + `redirect_uri` against a
   **server-side** allowlist and mints a single-use authorization bound to
   `{ aud, agent, delegate, caveatHash, redirect_uri, state }` before the person
   signs the delegation. Client-side allowlists are advisory only (closes F1). The
   WebAuthn approval commits to that authorization, not to an opaque hash (F2-strong).
5. **The org case is unaffected at the org layer.** An Organization SA is a
   *separate* agent; its per-site custodian + ROOT-recovery custodian (spec 229 §7)
   stay as-is. What changes is that demo-org's authority to *create the org on the
   person's behalf* comes from a person-SA delegation (caveated to the factory +
   naming + relationship targets), not from the site key being a person custodian.

## Consequences

- **Blast radius (the F4 closure):** a compromised relying site can, at worst,
  exercise its own caveated delegation until revoked (`revokeDelegationByOwner`) —
  it cannot add credentials, recover, or take over the canonical identity.
- **Zero new contract concepts / no redeploy** for the primitive: `DelegationManager`
  + `TimestampEnforcer` / `AllowedTargetsEnforcer` / `AllowedMethodsEnforcer` /
  `ValueEnforcer` are deployed (`deployments-base-sepolia.json`); the off-chain
  stack is `packages/delegation` (`issueDelegation`, caveat builders, `hashDelegation`,
  revoke). The person's ROOT passkey signs the delegation EIP-712 digest
  (`hashDelegation`) with the same WebAuthn path that signs UserOps; the SA's
  ERC-1271 `isValidSignature` validates it at redemption.
- **Runtime auth path moves** for relying sites from custody-membership to
  delegation-holding; the relying-site session is correctly demoted from
  (masquerading) custody-grade to a scoped agency session.
- **Custody-grade actions still require the ROOT credential**, evaluated on-chain —
  unchanged from ADR-0011/0017.
- **Cost is at the app layer**, not the contract layer: rewrite demo-sso enrollment
  to issue a delegation (not `addPasskey`), add the server enrollment-grant endpoint,
  and change demo-org runtime auth + the on-behalf action path (redeem the
  delegation) — see spec 229 §5–§6.

## Explicitly not taken

- **Per-credential custody roles** (`AgentAccount` `role`/`canAddCredentials` flags).
  Rejected: it keeps the relying site inside the custody perimeter, couples its
  blast radius to a new branch in the custody core, and violates the spec-213
  firewall by putting authority-scoping in the custody layer.

## Closure conditions

`pnpm check:all` green; spec 229 §5.1/§6/§8.x rewritten to this model;
`apps/demo-sso/CLAUDE.md` + `apps/demo-org/CLAUDE.md` + `packages/delegation/CLAUDE.md`
reflect it; a regression test proves (a) a relying-site delegate returns
`isCustodian == false` on the person SA, and (b) the server enrollment endpoint
rejects a non-allowlisted `aud`/`redirect_uri`.
