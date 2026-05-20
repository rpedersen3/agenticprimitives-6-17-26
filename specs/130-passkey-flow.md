# Spec 130 — Passkey-Owned Smart Accounts (WebAuthn flow)

**Status:** v0 design · 2026-05-20
**Purpose:** add a passkey-only authentication + signing flow alongside the existing EOA-based demo flow. Passkeys ARE the smart-account owner — every signature (UserOp, delegation) is a WebAuthn assertion validated on-chain by `AgentAccount._verifyWebAuthn`.

---

## 1. Why

The existing demo derives an Ethereum EOA from a localStorage mnemonic and uses secp256k1 signatures end-to-end. Real users won't have mnemonics — they have **passkeys** (Touch ID, Windows Hello, Yubikey, etc.). Passkeys are:

- Hardware-backed (P-256 in a platform authenticator)
- User-verified via biometric/PIN
- Standard WebAuthn — no app install, no extension
- Non-extractable

agenticprimitives' `AgentAccount.sol` already has full on-chain WebAuthn support:

- `SIG_TYPE_WEBAUTHN = 0x01` discriminator in `_validateSig`
- `_verifyWebAuthn(hash, payload)` → `WebAuthnLib.verify` → `P256Verifier.verify` (RIP-7212 precompile OR Daimo fallback)
- Per-account `PasskeyStorage` keyed by `credentialIdDigest` → `(pubKey.x, pubKey.y)`
- `addPasskey` / `removePasskey` (onlySelf) for management

What's **missing**: the factory-side deployment path. Today `AgentAccountFactory.createAccount(owner, salt)` requires an EOA owner. This spec closes that gap.

---

## 2. Architecture

Both flows coexist in the demo. User picks at startup:

```
┌──────────────────────────────────────────────────────────────────┐
│  Existing EOA flow                       NEW passkey flow         │
│  ─────────────────                      ─────────────────         │
│  Mnemonic in localStorage      vs       Platform passkey          │
│  secp256k1 signatures                   P-256 / WebAuthn          │
│  factory.createAccount(eoa, salt)       factory.createAccountWithPasskey│
│  account validates via                  account validates via     │
│    _verifyEcdsa                           _verifyWebAuthn         │
│                                                                   │
│  Signature format on chain:                                       │
│    65-byte (r,s,v)         vs           0x01 || abi.encode(Assertion) │
└──────────────────────────────────────────────────────────────────┘
```

Same downstream path for both: SIWE-or-equivalent login → smart-account deploy → delegation → tool call → mcp resource auth.

---

## 3. Contract changes

### `AgentAccount.initializeWithPasskey`

New initializer that bootstraps a **passkey-only** account (no EOA owner). Mirrors the existing `initialize` shape but writes to `PasskeyStorage` instead of `_owners`.

```solidity
function initializeWithPasskey(
    bytes32 credentialIdDigest,
    uint256 pubKeyX,
    uint256 pubKeyY,
    address dm,
    address factory_
) external initializer {
    if (pubKeyX == 0 || pubKeyY == 0) revert InvalidPasskeyPublicKey();

    PasskeyStorage storage $ = _passkeyStorage();
    $.keys[credentialIdDigest] = PasskeyEntry(pubKeyX, pubKeyY);
    $.registered[credentialIdDigest] = true;
    $.count = 1;
    // _ownerCount stays at 0 — passkey-only account.

    _delegationManager = dm;
    _factory = factory_;
    emit PasskeyAdded(credentialIdDigest, pubKeyX, pubKeyY);
}
```

The contract's existing invariants already permit passkey-only accounts: `removeOwner`'s "can't remove the last owner if passkeyCount == 0" check explicitly allows 0 owners as long as at least one passkey is registered.

### `AgentAccountFactory.createAccountWithPasskey`

New factory method, parallel to `createAccount(owner, salt)`:

```solidity
function createAccountWithPasskey(
    bytes32 credentialIdDigest,
    uint256 pubKeyX,
    uint256 pubKeyY,
    uint256 salt
) external returns (AgentAccount account) {
    address addr = getAddressForPasskey(credentialIdDigest, pubKeyX, pubKeyY, salt);
    if (addr.code.length > 0) return AgentAccount(payable(addr));

    bytes memory initData = abi.encodeCall(
        AgentAccount.initializeWithPasskey,
        (credentialIdDigest, pubKeyX, pubKeyY, delegationManager, address(this))
    );
    ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
        address(accountImplementation),
        initData
    );
    account = AgentAccount(payable(address(proxy)));
    emit AgentAccountCreated(address(account), address(0), salt); // owner=0 signals passkey-only
}

function getAddressForPasskey(
    bytes32 credentialIdDigest,
    uint256 pubKeyX,
    uint256 pubKeyY,
    uint256 salt
) public view returns (address) {
    bytes memory initData = abi.encodeCall(
        AgentAccount.initializeWithPasskey,
        (credentialIdDigest, pubKeyX, pubKeyY, delegationManager, address(this))
    );
    bytes memory proxyBytecode = abi.encodePacked(
        type(ERC1967Proxy).creationCode,
        abi.encode(address(accountImplementation), initData)
    );
    bytes32 bytecodeHash = keccak256(proxyBytecode);
    return address(uint160(uint256(keccak256(
        abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), bytecodeHash)
    ))));
}
```

CREATE2 address now depends on `(credentialIdDigest, pubKeyX, pubKeyY, salt)`. Different passkeys → different smart-account addresses. Same passkey + same salt → same address.

---

## 4. WebAuthn signature wire format

When the user signs a digest via passkey, the resulting signature on-chain is:

```
0x01 || abi.encode(WebAuthnLib.Assertion)
```

Where `WebAuthnLib.Assertion` is:

```solidity
struct Assertion {
    bytes   authenticatorData;
    string  clientDataJSON;
    uint256 challengeIndex;
    uint256 typeIndex;
    uint256 r;
    uint256 s;
    bytes32 credentialIdDigest;
}
```

The frontend converts the browser's WebAuthn assertion into this shape:

1. Call `navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{id, type:'public-key'}] }})`
2. Extract `response.authenticatorData` (ArrayBuffer)
3. Extract `response.clientDataJSON` (ArrayBuffer; UTF-8 decode to string)
4. Extract `response.signature` (ArrayBuffer; DER-encoded ECDSA)
5. Parse DER → `(r, s)` as `uint256`
6. Find `typeIndex`: index of `"type":"webauthn.get"` in clientDataJSON
7. Find `challengeIndex`: index of `"challenge":"` in clientDataJSON
8. Compute `credentialIdDigest = keccak256(credentialId)`
9. ABI-encode the Assertion + prepend `0x01`

The contract then:
1. Strips the `0x01` prefix
2. ABI-decodes the Assertion
3. Looks up `(x, y)` from PasskeyStorage by `credentialIdDigest`
4. Calls `WebAuthnLib.verify(assertion, hash, x, y)`
5. WebAuthnLib validates clientDataJSON structure + reconstructs the signing hash + calls P256Verifier

---

## 5. Browser-side ceremony

### Registration (one-time per device)

```typescript
async function registerPasskey(userName: string): Promise<{
  credentialId: Uint8Array;
  credentialIdDigest: Hex;
  pubKeyX: bigint;
  pubKeyY: bigint;
}> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: window.location.hostname, name: 'agenticprimitives' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 / P-256
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential;

  const credentialId = new Uint8Array(credential.rawId);
  const attestation = credential.response as AuthenticatorAttestationResponse;
  // Parse attestationObject (CBOR) → extract authData → extract COSE pubkey → X, Y
  const { x, y } = parsePubKeyFromAttestation(attestation);

  return {
    credentialId,
    credentialIdDigest: keccak256(credentialId),
    pubKeyX: x,
    pubKeyY: y,
  };
}
```

Persistence: `credentialId` + `(x, y)` in localStorage, like the mnemonic for the EOA flow.

### Signing (per-action ceremony)

```typescript
async function signWithPasskey(
  credentialId: Uint8Array,
  challenge: Uint8Array,
): Promise<WebAuthnAssertion> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: credentialId.buffer, type: 'public-key' }],
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })) as PublicKeyCredential;

  const response = assertion.response as AuthenticatorAssertionResponse;
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
  const authenticatorData = new Uint8Array(response.authenticatorData);
  const { r, s } = derToRS(new Uint8Array(response.signature));
  const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = clientDataJSON.indexOf('"challenge":"');

  return {
    authenticatorData,
    clientDataJSON,
    challengeIndex: BigInt(challengeIndex),
    typeIndex: BigInt(typeIndex),
    r,
    s,
    credentialIdDigest: keccak256(credentialId),
  };
}
```

### Encoding for on-chain submission

```typescript
function encodePasskeySignature(assertion: WebAuthnAssertion): Hex {
  const encoded = encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { type: 'bytes' }, { type: 'string' },
        { type: 'uint256' }, { type: 'uint256' },
        { type: 'uint256' }, { type: 'uint256' },
        { type: 'bytes32' },
      ],
    }],
    [[
      bytesToHex(assertion.authenticatorData),
      assertion.clientDataJSON,
      assertion.challengeIndex,
      assertion.typeIndex,
      assertion.r,
      assertion.s,
      assertion.credentialIdDigest,
    ]],
  );
  return ('0x01' + encoded.slice(2)) as Hex;
}
```

---

## 6. Challenge → digest mapping

WebAuthn signs `sha256(authenticatorData || sha256(clientDataJSON))`. The `clientDataJSON.challenge` field carries the **base64url-encoded SHA-256 of our intended payload**, NOT the payload itself. The on-chain verifier:

1. Reconstructs `signingHash = sha256(authenticatorData || sha256(clientDataJSON))`
2. Decodes `clientDataJSON.challenge` (base64url → 32 bytes) and asserts it equals our `expectedChallengeHash`
3. Calls P256Verifier on `(signingHash, r, s, pubX, pubY)`

This means the **digest we want signed must be embedded in the WebAuthn challenge** as raw 32 bytes, which the browser then base64url-encodes into clientDataJSON.challenge.

For UserOp signing:
- expectedChallengeHash = `userOpHash` (32 bytes, the EIP-712 EntryPoint hash)
- Browser passes `userOpHash` as `challenge`
- Frontend assembles Assertion, passes to contract; contract verifies challenge == userOpHash

For EIP-712 delegation signing:
- expectedChallengeHash = the EIP-712 hash of the Delegation struct
- Same flow

---

## 7. SIWE replacement for passkey users

SIWE is Ethereum-specific (EIP-4361). For passkey users, we use a **passkey-based challenge** flow:

```
POST /a2a/auth/passkey/challenge { credentialId } → { challenge: <random>, nonce: <opaque> }

(client signs challenge via navigator.credentials.get with userVerification)

POST /a2a/auth/passkey/verify { credentialId, assertion } 
  → backend verifies via passkey's pubkey (looked up by credentialId from earlier registration call)
  → on success: mints the same JWT session cookie used by SIWE
```

Or — simpler for v1: SIGN A SIWE MESSAGE VIA the smart account's ERC-1271 path. The smart account validates the passkey assertion. SIWE library is extended to support ERC-1271 signatures via `eth_call` to `isValidSignature`. This is the EIP-1271 SIWE pattern.

The simpler/cleaner path is the dedicated passkey challenge endpoint. v1 implements that.

---

## 8. Implementation phases

### Phase 2 — Contracts
- `AgentAccount.initializeWithPasskey` (new)
- `AgentAccountFactory.createAccountWithPasskey` + `getAddressForPasskey` (new)
- Forge tests:
  - Deploy with passkey owner
  - getAddressForPasskey is CREATE2-deterministic
  - isValidSignature accepts a valid WebAuthn assertion
  - isValidSignature rejects wrong-key, wrong-digest, malformed assertions
  - Two passkey-owned accounts with different credentials get different addresses

### Phase 3 — Browser
- `apps/demo-web/src/passkey-flow.ts` — registration + signing + persistence
- `parsePubKeyFromAttestation` (COSE CBOR → X, Y) — most complex piece
- `derToRS` — DER ECDSA signature → raw (r, s)
- `encodePasskeySignature` — assemble the on-chain wire format
- `addressForPasskey` — call `factory.getAddressForPasskey(...)`

### Phase 4 — App wiring
- demo-web: startup chooser (EOA vs passkey); persist choice
- demo-a2a: new `/auth/passkey/challenge` + `/auth/passkey/verify` endpoints
- demo-a2a: `/session/deploy` accepts a `passkey` flag to use `createAccountWithPasskey` initCode
- Step 2 (Authorize) / Step 3 (Read profile) work for both — signatures already have the type discriminator

### Phase 5 — Live + tests
- `pnpm deploy:cloudflare` redeploys contracts (new factory method added)
- Playwright virtual authenticator via CDP for e2e
- Test: full passkey flow renders profile from mcp

---

## 9. Out of scope (v1)

- Cross-device passkeys (would need passkey sync — out of scope; v1 = device-bound)
- Adding a passkey to an EXISTING EOA-owned account (would need a UserOp from the EOA calling `addPasskey`). Possible later; not needed for the demo.
- Removing passkeys (`removePasskey` exists on-chain; no UI for it in v1)
- Multi-passkey accounts (one passkey per account in v1)
- Passkey ATTESTATION verification (we use `attestation: 'none'` — no provenance check on the authenticator)
- WebAuthn discoverable credentials / "passkey autofill"

---

## 10. Open design questions (resolve in Phase 2)

1. **`AgentAccountCreated` event:** can `owner` be `address(0)` for passkey-only accounts? Existing consumers (indexers, UI) may assume non-zero. May add a separate `AgentAccountCreatedWithPasskey` event instead.
2. **`removeOwner` invariants with 0 initial EOA owners:** double-check — should pass since `_ownerCount + passkeyCount == 1` is the floor.
3. **Bundler vs passkey signer:** for the deploy UserOp, the bundler EOA still signs the outer `handleOps` tx (secp256k1 — Ethereum protocol layer). The passkey signs the INNER `userOpHash`. The bundler EOA is the existing KMS-backed one. No new key needed for bundler.
4. **JWT cookie contents for passkey users:** currently `walletAddress` + `smartAccountAddress`. For passkey users we have no `walletAddress`. New shape: `credentialId` + `smartAccountAddress`, with a `via: 'passkey'` discriminator.

---

## 11. Total effort estimate

- Phase 2 (contracts): 1.5 hrs
- Phase 3 (browser): 2.5 hrs (CBOR + COSE parsing is fiddly)
- Phase 4 (wiring): 2 hrs
- Phase 5 (live + tests): 1.5 hrs

**~7.5 hours** of focused work. Implementation roadmap is concrete; no further design discovery needed once Phase 2 starts.
