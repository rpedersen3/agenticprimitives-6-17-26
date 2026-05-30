# Delegation Architecture

`@agenticprimitives/delegation` owns authority delegation and the lifecycle of delegation-bound session keys. It is the package that decides what a delegated session can do, when it expires, and how a runtime verifies it.

## Role

Main capabilities:

- EIP-712 `Delegation` and `Caveat` structures.
- Caveat builders, encoders, hashing, and fail-closed evaluation.
- Browser-side `DelegationClient` issuance.
- `SessionManager` lifecycle: `init`, `package`, `resolve`, `revoke`.
- Delegation token minting and verification.
- JTI and session store interfaces.
- On-chain revocation surface.

## Session Lifecycle

`SessionManager` owns the lifecycle state machine, while `key-custody` owns the data-key wrapping primitive.

```mermaid
sequenceDiagram
  participant Web as Web / user
  participant A2A as A2A runtime
  participant SM as delegation.SessionManager
  participant KC as key-custody
  participant Store as SessionStore
  participant MCP as mcp-runtime

  Web->>A2A: request session init
  A2A->>SM: init(accountAddress, chainId)
  SM->>KC: generateSessionDataKey(AAD)
  SM->>Store: save pending encrypted session private key
  SM-->>A2A: sessionId + sessionKeyAddress
  A2A-->>Web: sessionKeyAddress for delegation
  Web->>Web: sign EIP-712 delegation to sessionKeyAddress
  Web->>A2A: delegation + sessionId
  A2A->>SM: package(sessionId, delegation)
  SM->>KC: decryptSessionDataKey(AAD)
  SM->>Store: save active encrypted package
  A2A->>SM: resolve(sessionId)
  SM-->>A2A: session signer + delegation
  A2A->>A2A: mintDelegationToken
  A2A->>MCP: call tool with token
```

Session private keys are plaintext only inside `SessionManager` calls that need to encrypt, decrypt, or sign. At rest they are always inside an encrypted session package.

## Verification Flow

```mermaid
flowchart TD
  Token["Delegation token"] --> Parse["parse claims and embedded delegation"]
  Parse --> SessionSig["recover session key from token signature"]
  SessionSig --> DelegateMatch["session key == delegation.delegate"]
  DelegateMatch --> Erc1271["ERC-1271 verify delegator account"]
  Erc1271 --> Revoke["check on-chain revocation"]
  Revoke --> Caveats["evaluate caveats fail-closed"]
  Caveats --> Jti["track JTI atomically"]
  Jti --> Principal["return verified principal"]
```

`mcp-runtime` calls this package for token verification and then maps the result into runtime-specific handler context.

## Package Interactions

```mermaid
flowchart LR
  Identity["connect-auth"]
  Account["agent-account"]
  KeyCustody["key-custody"]
  ToolPolicy["tool-policy"]
  Mcp["mcp-runtime"]
  Delegation["delegation"]

  Identity -->|Signer type| Delegation
  Account -->|ERC-1271 verification| Delegation
  KeyCustody -->|A2AKeyProvider, AAD bytes| Delegation
  Delegation -->|verify/mint/session APIs| Mcp
  ToolPolicy -.->|risk TTL decisions consumed by app| Delegation
```

`delegation` must not depend on `mcp-runtime` or `tool-policy`; those packages sit above it. Apps can combine policy decisions with session creation, but the primitive stays transport-agnostic.

## Boundary

Owned here:

- Authority objects: `Delegation`, `Caveat`, `DelegationTokenClaims`.
- Session row shape and lifecycle state transitions.
- Fail-closed caveat evaluation.
- Token minting, token verification, and JTI interface.

Not owned here:

- KMS implementations or AES primitives.
- MCP transport wrappers.
- Tool classification taxonomy.
- Auth methods and JWT-cookie sessions.
- Smart-account deployment internals.

## Security Invariants

- Unknown caveat enforcers reject.
- Session private keys are never stored plaintext.
- Tokens bind the delegation and a session-key signature over canonical claims.
- JTI usage tracking must be atomic.
- Delegate binding caveats validate every bound address, not just one side.
- Revocation and ERC-1271 checks should fail closed for production verification paths.
