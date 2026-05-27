# demo-sso as the personal central auth (spec 229)

demo-sso is the **stand-in central auth** for the cross-site model in
[spec 229](../../../specs/229-personal-central-auth.md). This note records the
custody boundary so the central credential **bootstraps, but is not reused by,**
each relying site.

## The model

`rpedersen.agent` is the **portable identity** (one canonical ERC-4337 Smart
Agent). Underneath it are several **RP-scoped P-256/WebAuthn signers** — one per
origin, because a WebAuthn credential only works with the `rpId` it was created
for:

```
rpedersen.agent  →  Person Smart Agent (ERC-4337)
  ├─ central ANS passkey   rpId: auth.agentictrust.io  role: ROOT
  │     canAddCredentials · canRecover · canRotate       (bootstrap / recovery)
  ├─ demo-org site passkey rpId: demo-org.example       role: SITE  (local signer)
  ├─ demo-sso site passkey rpId: demo-sso.example       role: SITE
  └─ optional EOA / SIWE                                 role: RECOVERY / fallback
```

- The **central ANS passkey is the root/bootstrap credential.** It does **not**
  become the passkey for every site.
- Each relying site creates its **own** local P-256 credential (at its own
  `rpId`) and the **central credential authorizes adding it** to the same Smart
  Agent via an `addPasskey`/`AuthorizeAddCredential` UserOperation.
- Only the **public** `(x, y)` + a credential-id hash are stored on-chain. The
  private key never leaves the authenticator (Windows Hello / iCloud Keychain /
  hardware key) — WebAuthn keeps it scoped to the RP and never exposes it.

## Flow

1. **Bootstrap** at the central origin: claim `rpedersen.agent`, register the
   central passkey (`rpId=auth.agentictrust.io`), store its public key on the
   person agent as the ROOT custody credential.
2. **First visit to a new site** (`demo-org`): enter `rpedersen` → resolves to
   `rpedersen.agent` → the site sees the central key exists but has **no
   site-local key yet** → "Add this site to your agent?" → the site runs its own
   WebAuthn registration (`rpId=demo-org.example`).
3. **Central authorizes the add:** the ROOT passkey signs an add-credential
   UserOp binding the new site key's public `(x, y)` to the person agent. (ERC-4337
   `EntryPoint → validateUserOp` enforces the ROOT signature.)
4. **Return visits:** "Continue as rpedersen.agent" → the **site-local** passkey
   (not the central one) → custody verified directly on-chain. No redirect.

## Authority model ([ADR-0019](../../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md))

| principal | rpId | what it is | authority |
| --- | --- | --- | --- |
| ROOT passkey | central auth | the **only custodian** | full: add/remove creds, recover, rotate, issue delegations |
| relying-site key | each relying site | a **scoped delegate** (NOT a custodian) | only its caveated ERC-7710 delegation (targets/methods/time/value); revocable |
| RECOVERY EOA/SIWE | — | fallback custodian | recovery |

A relying-site key is a **delegate, not a credential**: it acts *for* the person
within caveats, never *as* the person. Runtime auth = "holds a live, unrevoked,
in-window delegation," not `isCustodian`. A compromised relying site can only
exercise its caveats until revoked (`revokeDelegationByOwner`) — it can't add
credentials, recover, or take over the identity. Per-credential custody roles were
**rejected** (they'd put authority-scoping in the custody core — spec-213 firewall).

> **Implementation status:** ADR-0019 is accepted; the demo currently still uses the
> `addPasskey`-as-custodian path (and discloses the full-authority grant in consent)
> until the spec-229 **P6** delegation rewrite ships.

## Algorithm

Custody credentials MUST be **ES256 / P-256** (`pubKeyCredParams:[{alg:-7}]`) so
the agent can verify them on-chain via the P-256 precompile (EIP-7951 `P256VERIFY`
at `0x100`, superseding RIP-7212) or a pure-Solidity fallback. RSA/EdDSA
credentials are unusable for custody.

## The boundary, in one line

**Correct:** the central passkey *authorizes adding* per-site passkeys.
**Incorrect:** the central passkey is *used directly* by every site (fights
WebAuthn's RP-scoping and concentrates root authority everywhere).
