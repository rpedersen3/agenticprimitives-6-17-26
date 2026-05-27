# Name-first secure-home passkey SSO

This is the current demo shape: the relying app starts by name, sends the user
to their secure home, and receives a signed app permission plus an OIDC
`id_token`.

The key difference from normal SSO: the central service is not the account. The
portable identity is the Agent Naming Service name, such as `rpedersen.agent`,
and the authority anchor is the person Smart Agent. The secure-home passkey
confirms the person and approves what each app may do.

The key difference from ordinary passkeys: a new app connection is not a new
account. It is a permission from the existing person Smart Agent to that app.

```text
rpedersen.agent
  -> Person Smart Agent
     -> secure-home passkey
     -> Agentic Org app permission
     -> optional wallet sign-in method
```

The secure-home passkey does not become a passkey for every relying site. It
confirms at the secure home and approves an app permission that can be revoked.

---

## Product model

Use this language in UX and docs:

> `rpedersen.agent` is the portable identity. Your secure-home passkey protects
> it. Each app receives only the permission you approve.

Avoid telling users about implementation details unless they open advanced
settings.

User-facing copy:

```text
Connect to Smart Agent

[ rpedersen____________ ]

✓ Found rpedersen.agent

This is your first time using rpedersen.agent on Agentic Org.

[ Continue with Agentic Connect ]
[ Continue once with wallet ]
```

After approval:

```text
App connected

Agentic Org can now sign you in and read approved profile data.
```

Return visit:

```text
Continue as rpedersen.agent
```

---

## Why this is different

| Common solution | Problem | This model |
| --- | --- | --- |
| Password/OIDC SSO | Central provider remains the account authority | Smart Agent is the account; Connect only helps authenticate facets |
| One passkey per website | Easy UX, but each site creates a separate identity | Each app connects back to the same `rpedersen.agent` Smart Agent |
| One central WebAuthn passkey reused everywhere | Fights WebAuthn RP scoping | Secure-home passkey confirms at the secure home and approves app permissions |
| Wallet-only connect | Cross-origin, but not passkey-native | Passkey-first, with SIWE only as fallback/bootstrap |

This is passkey-driven, but it uses ERC-4337 to make the passkey model portable:
site credentials become scoped signers on one account instead of becoming
separate accounts.

---

## Credential tree

```mermaid
flowchart TB
  Name["rpedersen.agent"]
  Agent["Person Smart Agent\nERC-4337 account"]

  Root["Central ANS passkey\nrpId: auth.agent.example\nrole: root / bootstrap / recovery\ncanAddCredentials: true"]
  Org["Demo Org passkey\nrpId: demo-org.example\nrole: site signer\nscope: demo-org"]
  Sso["Demo SSO passkey\nrpId: demo-sso.example\nrole: site signer\nscope: demo-sso"]
  Eoa["Optional SIWE / EOA\nrole: fallback / recovery"]

  Name --> Agent
  Agent --> Root
  Agent --> Org
  Agent --> Sso
  Agent --> Eoa
```

Only public keys and metadata are registered with the Smart Agent. Private keys
stay inside Windows Hello, iCloud Keychain, Android, or a hardware key.

---

## Phase 1 — Initial creation at the ANS auth origin

The user creates or claims `rpedersen.agent` through the central ANS auth origin,
for example `auth.agent.example`.

```mermaid
sequenceDiagram
  participant U as User
  participant Auth as ANS auth origin
  participant WH as Windows Hello / authenticator
  participant A2A as A2A / bundler path
  participant Agent as Person Smart Agent
  participant Naming as Agent Naming Service

  U->>Auth: Claim rpedersen.agent
  Auth->>WH: WebAuthn create rpId=auth.agent.example user.name=rpedersen.agent
  WH-->>Auth: credentialId, publicKeyX, publicKeyY
  Auth->>A2A: Build ERC-4337 deploy / add root passkey UserOperation
  U->>WH: Confirm with central ANS passkey
  A2A->>Agent: Deploy or configure Person Smart Agent
  Agent->>Agent: Store central passkey public key + role=root-bootstrap
  Auth->>Naming: Register rpedersen.agent -> Person Smart Agent
```

The person Smart Agent stores the central credential as a custody credential:

```ts
type WebAuthnSigner = {
  agentName: 'rpedersen.agent';
  rpId: 'auth.agent.example';
  rpIdHash: Hex;              // sha256(rpId)
  credentialIdHash: Hex;
  publicKeyX: Hex;
  publicKeyY: Hex;
  role: 'root';
  scope?: string;
  canAddCredentials: true;
  canRecover: true;
  canRotate: true;
  addedByCredentialIdHash?: Hex;
  createdAt: bigint;
  revokedAt?: bigint;
};
```

---

## Phase 2 — First visit to a new relying site

Current demo: the relying site sends the user to the secure home. The secure home
confirms with the passkey and returns a revocable app permission plus an OIDC
session. No relying-site passkey is created in this flow.

### Deferred option — create a local relying-site passkey

The user visits `demo-org.example` and enters `rpedersen`.

```mermaid
sequenceDiagram
  participant U as User
  participant Site as demo-org.example
  participant Naming as Agent Naming Service
  participant Agent as Person Smart Agent

  U->>Site: Enter rpedersen
  Site->>Naming: resolve rpedersen.agent
  Naming-->>Site: 0xPersonAgent
  Site->>Agent: Read WebAuthn signers
  Agent-->>Site: central ANS passkey exists; demo-org passkey missing
  Site-->>U: Found rpedersen.agent. Add this site?
```

The site does not assume the new local credential is trusted. It first creates a
site-local WebAuthn credential, then asks the root credential to authorize adding
it.

```mermaid
sequenceDiagram
  participant U as User
  participant Site as demo-org.example
  participant WH as Windows Hello / authenticator
  participant Auth as auth.agent.example
  participant Agent as Person Smart Agent
  participant EntryPoint as ERC-4337 EntryPoint

  U->>Site: Add this site to rpedersen.agent
  Site->>WH: WebAuthn create rpId=demo-org.example user.name=rpedersen.agent
  WH-->>Site: new credentialId + P-256 public key
  Site->>Auth: Request AddCredential approval for demo-org signer
  Auth->>WH: Central ANS passkey signs AuthorizeAddCredential
  Auth-->>Site: authorization signature / UserOp signature material
  Site->>EntryPoint: submit addWebAuthnCredential UserOperation
  EntryPoint->>Agent: validateUserOp
  Agent->>Agent: Verify central passkey authorized ADD_WEBAUTHN_CREDENTIAL
  Agent->>Agent: Store demo-org passkey as site-scoped signer
```

The authorization payload should bind every important field:

```ts
type AuthorizeAddCredential = {
  agentName: 'rpedersen.agent';
  smartAccount: Address;
  action: 'ADD_WEBAUTHN_CREDENTIAL';
  newRpId: 'demo-org.example';
  newRpIdHash: Hex;             // sha256('demo-org.example')
  newCredentialIdHash: Hex;     // sha256 or keccak256 of credentialId, consistently chosen
  newPublicKeyX: Hex;
  newPublicKeyY: Hex;
  scope: 'demo-org';
  chainId: 8453 | 84532;
  nonce: bigint;
  expiresAt: string;
};
```

The account call is conceptually:

```solidity
personAgent.addWebAuthnCredential(
  rpIdHash,
  credentialIdHash,
  publicKeyX,
  publicKeyY,
  scope,
  label
);
```

Under ERC-4337, the EntryPoint calls `validateUserOp`; the Smart Agent verifies
that a credential with `canAddCredentials = true` authorized the operation before
execution.

---

## Phase 3 — Return visit to that relying site

Current demo: later visits use the saved app permission. If it is still valid,
sign-in is silent. If it expired or was revoked, the user goes back to the secure
home approval screen.

### Deferred option — return with a site-local passkey

Later visits do not need the central ANS passkey.

```mermaid
sequenceDiagram
  participant U as User
  participant Site as demo-org.example
  participant WH as Windows Hello / authenticator
  participant Agent as Person Smart Agent
  participant Broker as Connect broker for demo-org

  Site-->>U: Continue as rpedersen.agent
  U->>Site: Continue
  Site->>WH: WebAuthn get rpId=demo-org.example
  WH-->>Site: signature from demo-org site passkey
  Site->>Agent: isValidSignature / hasWebAuthnCredential
  Agent-->>Site: valid local signer for rpedersen.agent
  Site->>Broker: issue AgentSession aud=demo-org
  Broker-->>Site: AgentSession sub=eip155:...:0xPersonAgent
```

The user sees one stable name: `rpedersen.agent`. Underneath, each origin uses its
own passkey.

---

## Phase 4 — Org creation

Current demo: org creation is approved at the secure home. The relying app
receives an org permission it can present to read approved org data.

### Deferred option — org creation from the site-local passkey

Once `demo-org.example` has a local passkey bound to `rpedersen.agent`, that
passkey can sign the org creation flow.

```mermaid
sequenceDiagram
  participant U as User
  participant Site as demo-org.example
  participant WH as Windows Hello / authenticator
  participant A2A as A2A / bundler path
  participant Person as rpedersen.agent Person SA
  participant Org as acme-org.agent Org SA
  participant Rel as AgentRelationship

  U->>Site: Create org acme-org.agent
  Site->>WH: Sign UserOperation with demo-org passkey
  Site->>A2A: Submit org deploy UserOperation
  A2A->>Org: Deploy simple single-custodian Org Smart Agent
  Site->>A2A: Register acme-org.agent name
  Site->>A2A: Record governance relationship
  Person->>Rel: propose HAS_GOVERNANCE_OVER -> Org
  Org->>Rel: confirm edge
```

This connects the name-first SSO model to the org app:

```text
rpedersen.agent signs with demo-org passkey
  -> create org Smart Agent
  -> org Smart Agent has simple single custodian
  -> rpedersen.agent HAS_GOVERNANCE_OVER acme-org.agent
```

---

## A2A endpoint architecture

The same model can be self-sovereign rather than provider-centric. The person
Smart Agent can have an A2A service agent and endpoint domain that helps manage
site connections.

```mermaid
flowchart LR
  User["User"]
  Site["Relying site\ndemo-org.example"]
  Name["rpedersen.agent"]
  Person["Person Smart Agent"]
  A2A["Personal A2A agent\nagent.rpedersen.agent"]
  Connect["Connect broker / auth origin"]

  User --> Site
  Site --> Name
  Name --> Person
  Person --> A2A
  Site --> A2A
  A2A --> Connect
  Connect --> Person
```

In this shape:

- `rpedersen.agent` is still the canonical identity.
- The personal A2A endpoint can advertise how to connect, which credentials are
  acceptable, and where to request add-site authorization.
- The root ANS passkey remains the high-power credential.
- App permissions remain narrow and revocable. Site-local passkeys are a
  deferred option, not the current demo flow.

This avoids turning a central IdP into the permanent authority. Connect helps
authenticate and issue sessions; the Smart Agent owns the credential graph.

---

## Implementation notes

### WebAuthn algorithm

For on-chain verification, require or strongly prefer ES256 / P-256:

```ts
pubKeyCredParams: [
  { type: 'public-key', alg: -7 } // ES256 / P-256
]
```

If the authenticator returns RSA or EdDSA, the current P-256 verifier cannot
validate it unless the account adds verifier support for those algorithms.

### EVM verification

Use a P-256 verifier/precompile where available. EIP-7951 introduces
`P256VERIFY` at address `0x100` for secp256r1/P-256 signatures and supersedes
the earlier RIP-7212 direction. Some rollups already expose RIP-7212-style
verification for WebAuthn/passkey signatures.

### Signer policy

Root credential:

```text
auth.agent.example
  canAddCredentials = true
  canRecover = true
  canRotate = true
```

Deferred site credential:

```text
demo-org.example
  canSignInToDemoOrg = true
  canCreateOrg = true, if approved
  canAddCredentials = false by default
```

If we add site-local passkeys later, do not make every site-local passkey a root
key.

---

## Main warning

Correct:

```text
secure-home passkey approves app permissions
```

Incorrect:

```text
secure-home passkey is directly reused by relying sites
```

The first model works with WebAuthn and ERC-4337. The second fights WebAuthn's
RP-scoping model.
