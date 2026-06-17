# Capability Index

**Generated** by `scripts/generate-capability-index.ts`. Do not edit by hand — re-run the script after manifest changes.

This is the routing index for Claude (and other agents) starting work in this repo. For each package, the table lists the canonical spec, public entry, and immediate `@agenticprimitives/*` dependencies.

## Packages

| Package | Kind | Stability | Spec | Depends on |
| --- | --- | --- | --- | --- |
| `@agenticprimitives/types` | shared | experimental | [101-v0-package-proposal.md](../../specs/101-v0-package-proposal.md) | _none_ |
| `@agenticprimitives/a2a` | capability | experimental | [269-async-delegation-authorized-a2a.md](../../specs/269-async-delegation-authorized-a2a.md) | `types`, `fulfillment`, `delegation` |
| `@agenticprimitives/account-custody` | capability | experimental | [213-custody-layer-carve-out.md](../../specs/213-custody-layer-carve-out.md) | `types` |
| `@agenticprimitives/agent-account` | capability | experimental | [201-agent-account.md](../../specs/201-agent-account.md) | `types`, `connect-auth` |
| `@agenticprimitives/agent-naming` | capability | experimental | [215-agent-naming.md](../../specs/215-agent-naming.md) | `types`, `connect-auth`, `agent-account` |
| `@agenticprimitives/agent-profile` | capability | experimental | [217-agent-profile.md](../../specs/217-agent-profile.md) | `types`, `connect-auth`, `agent-account` |
| `@agenticprimitives/agent-relationships` | capability | experimental | [216-agent-relationships.md](../../specs/216-agent-relationships.md) | `types`, `connect-auth`, `agent-account` |
| `@agenticprimitives/agent-skills` | capability | experimental | [251-skills-and-geo-features.md](../../specs/251-skills-and-geo-features.md) | `types`, `verifiable-credentials` |
| `@agenticprimitives/agreements` | capability | experimental | [241-agreement-commitment-registry.md](../../specs/241-agreement-commitment-registry.md) | `types`, `verifiable-credentials` |
| `@agenticprimitives/attestations` | capability | experimental | [242-trust-credentials-and-public-assertions.md](../../specs/242-trust-credentials-and-public-assertions.md) | `types`, `verifiable-credentials`, `delegation` |
| `@agenticprimitives/audit` | capability | experimental | [206-audit.md](../../specs/206-audit.md) | `types` |
| `@agenticprimitives/connect` | capability | experimental | [224-agentic-connect.md](../../specs/224-agentic-connect.md) | `types`, `connect-auth`, `identity-directory` |
| `@agenticprimitives/connect-auth` | capability | experimental | [200-connect-auth.md](../../specs/200-connect-auth.md) | `types` |
| `@agenticprimitives/content-primitives` | capability | experimental | [266-verifiable-content-substrate.md](../../specs/266-verifiable-content-substrate.md) | `types`, `verifiable-credentials` |
| `@agenticprimitives/delegated-signer` | capability | experimental | [276-kms-consumer-surface.md](../../specs/276-kms-consumer-surface.md) | `types`, `delegation`, `key-custody` |
| `@agenticprimitives/delegation` | capability | experimental | [202-delegation.md](../../specs/202-delegation.md) | `types`, `audit`, `connect-auth`, `agent-account`, `key-custody` |
| `@agenticprimitives/entitlements` | capability | experimental | [277-mcp-delegated-vault-authorization.md](../../specs/277-mcp-delegated-vault-authorization.md) | _none_ |
| `@agenticprimitives/geo-features` | capability | experimental | [251-skills-and-geo-features.md](../../specs/251-skills-and-geo-features.md) | `types`, `verifiable-credentials` |
| `@agenticprimitives/identity-directory` | capability | experimental | [223-identity-directory.md](../../specs/223-identity-directory.md) | `types`, `audit`, `ontology` |
| `@agenticprimitives/intent-marketplace` | capability | experimental | [239-intent-spine.md](../../specs/239-intent-spine.md) | `types`, `verifiable-credentials`, `delegation`, `intent-resolver` |
| `@agenticprimitives/intent-resolver` | capability | experimental | [239-intent-spine.md](../../specs/239-intent-spine.md) | `types`, `verifiable-credentials` |
| `@agenticprimitives/key-custody` | capability | experimental | [203-key-custody.md](../../specs/203-key-custody.md) | `types`, `audit`, `connect-auth` |
| `@agenticprimitives/ontology` | capability | experimental | [225-ontology.md](../../specs/225-ontology.md) | _none_ |
| `@agenticprimitives/payments` | capability | experimental | [243-payments.md](../../specs/243-payments.md) | `types`, `verifiable-credentials`, `attestations`, `delegation` |
| `@agenticprimitives/related-agents` | capability | experimental | [246-related-agents-vault.md](../../specs/246-related-agents-vault.md) | `types`, `verifiable-credentials`, `delegation` |
| `@agenticprimitives/vault` | capability | experimental | [277-mcp-delegated-vault-authorization.md](../../specs/277-mcp-delegated-vault-authorization.md) | _none_ |
| `@agenticprimitives/verifiable-credentials` | capability | experimental | [242-trust-credentials-and-public-assertions.md](../../specs/242-trust-credentials-and-public-assertions.md) | `types`, `ontology` |
| `@agenticprimitives/browser-identity` | adapter | experimental | [264-fedcm-idp-adapter.md](../../specs/264-fedcm-idp-adapter.md) | _none_ |
| `@agenticprimitives/contracts` | contracts | experimental | [spec.md](../../packages/contracts/spec.md) | _none_ |
| `@agenticprimitives/fulfillment` | capability | experimental | [244-fulfillment.md](../../specs/244-fulfillment.md) | `types`, `verifiable-credentials`, `attestations`, `agreements`, `delegation` |
| `@agenticprimitives/mcp-runtime` | capability | experimental | [205-mcp-runtime.md](../../specs/205-mcp-runtime.md) | `types`, `audit`, `delegation`, `key-custody`, `tool-policy` |
| `@agenticprimitives/tool-policy` | capability | experimental | [204-tool-policy.md](../../specs/204-tool-policy.md) | `types` |
| `@agenticprimitives/fedcm-idp` | adapter | experimental | [264-fedcm-idp-adapter.md](../../specs/264-fedcm-idp-adapter.md) | _none_ |
| `@agenticprimitives/fedcm-rp` | adapter | experimental | [264-fedcm-idp-adapter.md](../../specs/264-fedcm-idp-adapter.md) | _none_ |
| `@agenticprimitives/identity-directory-adapters` | adapter | experimental | [223-identity-directory.md](../../specs/223-identity-directory.md) | `types`, `identity-directory`, `agent-naming` |

## Per-package summaries

### `@agenticprimitives/types`

Cross-cutting branded types: Address, Hex, ChainId, BrandedId, plus the NameContext / AgentType shapes downstream packages accept as injected naming context (ADR-0006). Types-only; no runtime code.

**Public exports** (15): `Address`, `Hex`, `ChainId`, `BrandedId`, `CanonicalAgentIdentity`, `AgentType`, `NameContext`, `Caip10Address`, `CanonicalAgentId`, `Caip10Parts`, `Assurance`, `CredentialKind`, `CredentialRole`, `CredentialPrincipal`, `AgentSession`

**Read first:** [`CLAUDE.md`](../../packages/types/CLAUDE.md) · [`capability.manifest.json`](../../packages/types/capability.manifest.json) · [`src/index.ts`](../../packages/types/src/index.ts)

### `@agenticprimitives/a2a`

Async, delegation-authorized Agent-to-Agent task transport (spec 269): Task runtime + SkillHandler dispatch, delegation-auth gate, scoped grants, JSON-RPC + client, push + SSE, Cloudflare DO adapter.

**Public exports** (85): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Task`, `TaskState`, `Artifact`, `A2aArtifact`, `A2aMessage`, `VaultRef`, `TaskRecord`, `TaskEvent`, `TERMINAL_STATES`, `isTerminal`, `TaskStore`, `createInMemoryTaskStore`, `SkillHandler`, `SkillContext`, `SkillResult`, `VaultClient`, `McpClient`, `AuthRequired`, `HandoffRequest`, `HandoffRequested`, `buildSkillRegistry`, `newTaskRecord`, `applyTransition`, `dispatchTask`, `TransitionResult`, `A2A_ANY_SKILL`, `skillSelector`, `buildA2aGrantCaveats`, `A2aEnforcers`, `authorizeA2aMessage`, `hashA2aMessage`, `hashA2aTaskRequest`, `decodeTimestampTerms`, `decodeAllowedTargetsTerms`, `decodeAllowedMethodsTerms`, `OnChainChecks`, `MessageIdReserver`, `AuthorizeResult`, `createA2aAgent`, `A2aAgent`, `A2aAgentConfig`, `AgentCard`, `MessageSendParams`, `ResubmitParams`, `RpcResult`, `RpcOk`, `RpcErr`, `dispatchA2aRpc`, `handleA2aRpcBody`, `JsonRpcRequest`, `JsonRpcResponse`, `A2aWireAdapter`, `A2aTransport`, `resolveA2aTarget`, `fetchAgentCard`, `A2aTarget`, `ResolveAgentName`, `AgentEndpointFor`, `A2aFetch`, `hashPushPayload`, `deliverPush`, `verifyPushEnvelope`, `PushPayload`, `PushEnvelope`, `TerminalSigner`, `PushSender`, `SSE_HEADERS`, `formatSseEvent`, `formatSseComment`, `isStreamEnd`, `PushConfig`, `SkillPayment`, `PaymentGate`, `PaymentGateDecision`, `X402PaymentMetadata`, `X402PaymentStatus`, `X402_EXTENSION_URI`, `x402AgentCardExtension`, `buildPaymentRequiredMetadata`, `buildPaymentSettledMetadata`, `gateSkillPayment`, `PaymentLane`

**Read first:** [`CLAUDE.md`](../../packages/a2a/CLAUDE.md) · [`capability.manifest.json`](../../packages/a2a/capability.manifest.json) · [`src/index.ts`](../../packages/a2a/src/index.ts)

### `@agenticprimitives/account-custody`

Custody-layer SDK for CustodyPolicy: ABI, CustodyAction arg builders, quorum signature slots, EIP-712 typed-data helpers, and custody-domain types.

**Public exports** (41): `custodyPolicyAbi`, `CustodyAction`, `buildAddCustodianArgs`, `buildRemoveCustodianArgs`, `buildAddTrusteeArgs`, `buildRemoveTrusteeArgs`, `buildChangeCustodyModeArgs`, `buildChangeValueCeilingArgs`, `buildSetRecoveryApprovalsArgs`, `buildApplySystemUpdateArgs`, `buildChangeApprovalsRequiredArgs`, `buildAddPasskeyCredentialArgs`, `buildRemovePasskeyCredentialArgs`, `buildRotateAllCustodiansArgs`, `buildRecoverAccountArgs`, `RecoveryPasskeyAdd`, `CUSTODY_DOMAIN_NAME`, `CUSTODY_DOMAIN_VERSION`, `custodyDomain`, `ScheduleCustodyChangeRequest`, `ApplyCustodyChangeRequest`, `CancelScheduledChangeRequest`, `ScheduleCustodyChangeMessage`, `ApplyCustodyChangeMessage`, `CancelScheduledChangeMessage`, `Custodian`, `Trustee`, `CustodyCouncil`, `ScheduledChange`, `CustodyMode`, `RiskTier`, `CUSTODY_MODE_BY_INDEX`, `EcdsaSlot`, `ContractSigSlot`, `ApprovedHashSlot`, `PasskeySlot`, `QuorumSlot`, `WebAuthnAssertion`, `packQuorumSigs`, `encodePasskeyTailBody`, `passkeyIdentity`

**Read first:** [`CLAUDE.md`](../../packages/account-custody/CLAUDE.md) · [`capability.manifest.json`](../../packages/account-custody/capability.manifest.json) · [`src/index.ts`](../../packages/account-custody/src/index.ts)

### `@agenticprimitives/agent-account`

ERC-4337 smart-account substrate. Deterministic addressing, factory deployment, ERC-1271 signing, UserOp building. Account-agnostic of which signer signs.

**Public exports** (30): `AgentAccountClient`, `AgentAccountClientOpts`, `AgentAccountSpec`, `UserOperation`, `Address`, `Hex`, `BundlerClient`, `BundlerClientOpts`, `PackedUserOperation`, `packGasLimits`, `unpackGasLimits`, `agentAccountAbi`, `agentAccountFactoryAbi`, `approvedHashRegistryAbi`, `entryPointAbi`, `SIG_TYPE_WEBAUTHN`, `encodeAssertion`, `encodeWebAuthnSignature`, `packSafeSignatures`, `computeAdminPayloadHash`, `ADMIN_VERB_PROPOSE`, `ADMIN_VERB_EXECUTE`, `ADMIN_VERB_CANCEL`, `SafeSignatureSlot`, `buildExecuteCallData`, `buildExecuteBatchCallData`, `ContractCall`, `SaMismatchError`, `buildErc20TransferCall`, `readErc20Balance`

**Read first:** [`CLAUDE.md`](../../packages/agent-account/CLAUDE.md) · [`capability.manifest.json`](../../packages/agent-account/capability.manifest.json) · [`src/index.ts`](../../packages/agent-account/src/index.ts)

### `@agenticprimitives/agent-naming`

Hierarchical names for Smart Agents (.agent TLD). Pure helpers + record schemas + client skeleton. Phase 1: SDK only.

**Public exports** (47): `AGENT_TLD`, `AgentTld`, `normalizeAgentName`, `isValidAgentName`, `labelhash`, `namehash`, `ZERO_NODE`, `AgentKind`, `AgentNameRecords`, `AgentNamingClient`, `AgentNamingClientOpts`, `InvalidNameError`, `NameNotFoundError`, `UnauthorizedNameOwnerError`, `RegisterSubnameInput`, `SetPrimaryNameInput`, `SetAgentRecordsInput`, `SetSubregistryInput`, `agentNameRegistryAbi`, `agentNameAttributeResolverAbi`, `agentNameUniversalResolverAbi`, `ontologyTermRegistryAbi`, `shapeRegistryAbi`, `PREDICATE_ID`, `AGENT_KIND_ID`, `CLASS_AGENT_NAME`, `AGENT_KIND_ENUM`, `CAIP10_NAMESPACE_ALLOWLIST`, `encodeRecords`, `decodeRecords`, `PredicateName`, `EncodedRecord`, `DecodeInput`, `WriteContext`, `ContractCall`, `buildRegisterSubnameCall`, `buildRotateNameOwnerCall`, `buildRotateNameResolverCall`, `buildSetSubregistryCall`, `buildSetPrimaryNameCall`, `buildSetStringAttributeCall`, `buildSetAddressAttributeCall`, `buildSetBytes32AttributeCall`, `buildRecordCalls`, `buildSubregistryRegisterCall`, `permissionlessSubregistryAbi`, `normalizeLabel`

**Read first:** [`CLAUDE.md`](../../packages/agent-naming/CLAUDE.md) · [`capability.manifest.json`](../../packages/agent-naming/capability.manifest.json) · [`src/index.ts`](../../packages/agent-naming/src/index.ts)

### `@agenticprimitives/agent-profile`

Typed AgentCard profile schema (HCS-11-aligned), CAIP-10 nativeId helpers, endpoint verification methods. Phase 1: pure helpers + types + client skeleton.

**Public exports** (33): `AgentCard`, `ProfileType`, `AiAgentProfile`, `McpServerProfile`, `MultisigProfile`, `ServiceProfile`, `VerificationMethod`, `Caip10Address`, `Caip10Parts`, `AgentIdentityClient`, `AgentIdentityClientOpts`, `PublishProfileInput`, `buildCaip10Address`, `parseCaip10`, `isValidCaip10`, `canonicalProfileJson`, `profileContentHash`, `InvalidProfileError`, `ProfileHashMismatchError`, `EndpointVerificationError`, `InvalidCaip10Error`, `CAIP10_NAMESPACE_ALLOWLIST`, `AGENT_CARD_SCHEMA_VERSION`, `AUTH_ORIGIN`, `agentProfileResolverAbi`, `WriteContext`, `ContractCall`, `buildRegisterProfileCall`, `buildSetProfileMetadataCall`, `buildSetProfileStringCall`, `buildSetProfileAddressCall`, `buildSetProfileBytes32Call`, `buildSetProfileActiveCall`

**Read first:** [`CLAUDE.md`](../../packages/agent-profile/CLAUDE.md) · [`capability.manifest.json`](../../packages/agent-profile/capability.manifest.json) · [`src/index.ts`](../../packages/agent-profile/src/index.ts)

### `@agenticprimitives/agent-relationships`

Trust-fabric edge primitive: (subject, object, relationshipType) tuples with role taxonomy. Phase 1: pure helpers + client skeleton. Contracts land in Phase 3.

**Public exports** (31): `Edge`, `EdgeStatus`, `RelationshipType`, `Role`, `AgentRelationshipsClient`, `AgentRelationshipsClientOpts`, `ProposeEdgeInput`, `ConfirmEdgeInput`, `RevokeEdgeInput`, `SetRolesInput`, `computeEdgeId`, `hashRelationshipType`, `hashRole`, `RELATIONSHIP_TYPE`, `ROLE`, `TYPE_SEMANTICS`, `RelationshipTypeSemantics`, `InvalidEdgeError`, `UnauthorizedActorError`, `UnknownRelationshipTypeError`, `agentRelationshipAbi`, `relationshipTypeRegistryAbi`, `WriteContext`, `ContractCall`, `buildProposeEdgeCall`, `buildConfirmEdgeCall`, `buildActivateEdgeCall`, `buildRevokeEdgeCall`, `buildAddRoleCall`, `buildRemoveRoleCall`, `buildSetMetadataCall`

**Read first:** [`CLAUDE.md`](../../packages/agent-relationships/CLAUDE.md) · [`capability.manifest.json`](../../packages/agent-relationships/capability.manifest.json) · [`src/index.ts`](../../packages/agent-relationships/src/index.ts)

### `@agenticprimitives/agent-skills`

Off-chain skill CLAIM credentials + SkillDefinitionRegistry helpers (spec 251). Definitions on chain; claims are private vault credentials pointing to a (skillId, version).

**Public exports** (27): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Uri`, `Hex32`, `SKILL_KIND`, `SKILL_KIND_URI`, `SKILL_RELATION`, `SkillVisibility`, `SELF_FORBIDDEN_RELATIONS`, `SELF_MAX_PROFICIENCY`, `MAX_PROFICIENCY`, `computeSkillId`, `conceptHash`, `SkillDefinitionPublishInput`, `SkillDefinitionRef`, `SkillClaimSubject`, `SkillClaimCredential`, `skillClaimId`, `SKILL_ENDORSEMENT_TYPEHASH`, `skillEndorsementDigest`, `buildSelfSkillClaim`, `buildEndorsedSkillClaim`, `skillClaimHash`, `SKILL_DEFINITION_READ_ABI`, `ReadContractFn`, `skillDefinitionExists`

**Read first:** [`CLAUDE.md`](../../packages/agent-skills/CLAUDE.md) · [`capability.manifest.json`](../../packages/agent-skills/capability.manifest.json) · [`src/index.ts`](../../packages/agent-skills/src/index.ts)

### `@agenticprimitives/agreements`

Commitment-only AgreementRegistry SDK. Owns AgreementCredential shape (PD-22) + commitment math + bilateral status transitions + joint-assertion gateway.

**Public exports** (17): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Hex32`, `STATUS`, `AgreementStatus`, `TRANSITION_TYPEHASH`, `transitionDigest`, `computeAgreementCommitment`, `partySetCommitment`, `issuerCommitment`, `bytesCommitment`, `nullifierFor`, `AgreementIssuancePayload`, `StatusUpdatePayload`, `AGREEMENT_ISSUER_TYPEHASH`, `issuerAttestationDigest`

**Read first:** [`CLAUDE.md`](../../packages/agreements/CLAUDE.md) · [`capability.manifest.json`](../../packages/agreements/capability.manifest.json) · [`src/index.ts`](../../packages/agreements/src/index.ts)

### `@agenticprimitives/attestations`

AttestationRegistry SDK (EAS-aligned, bilateral-consent) — Association + JointAgreement + Evidence + Outcome + Validation + TrustUpdate credential types in one on-chain registry per ADR-0023.

**Public exports** (14): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Hex32`, `CREDENTIAL_TYPE`, `computeAttestationUid`, `JOINT_CONSENT_TYPEHASH`, `jointConsentDigest`, `JOINT_ISSUER_TYPEHASH`, `jointIssuerDigest`, `AssociationAttestationRequest`, `JointAgreementAttestationRequest`, `ASSOCIATION_ATTESTATION_TYPEHASH`, `associationAttestationDigest`

**Read first:** [`CLAUDE.md`](../../packages/attestations/CLAUDE.md) · [`capability.manifest.json`](../../packages/attestations/capability.manifest.json) · [`src/index.ts`](../../packages/attestations/src/index.ts)

### `@agenticprimitives/audit`

Append-only audit event schema + sink interface. Transport-agnostic; consumers wire concrete sinks (console / D1 / Cloud Logging / etc.). Closes system audit C3.

**Public exports** (23): `AuditEvent`, `AuditSink`, `MetricsSink`, `MemoryAuditSink`, `MemoryMetricsSink`, `PiiFinding`, `PiiGuardrailOpts`, `createConsoleAuditSink`, `createConsoleMetricsSink`, `createMemoryAuditSink`, `createMemoryMetricsSink`, `composeSinks`, `composeFailSoftSinks`, `composeFailHardSinks`, `composeMetricsSinks`, `createPiiGuardrailSink`, `noopMetricsSink`, `generateEventId`, `nowIso`, `buildEvent`, `AUDIT_ACTION_REGISTRY`, `AuditAction`, `isCanonicalAuditAction`

**Read first:** [`CLAUDE.md`](../../packages/audit/CLAUDE.md) · [`capability.manifest.json`](../../packages/audit/capability.manifest.json) · [`src/index.ts`](../../packages/audit/src/index.ts)

### `@agenticprimitives/connect`

Agentic Connect SSO broker (spec 224 / ADR-0014): asymmetric AgentSession mint/verify + JWKS; entry-flow convergence + issuance (assurance floor, non-EVM gate); code-exchange redirect security.

**Public exports** (40): `generateBrokerKeypair`, `mintAgentSession`, `verifyAgentSession`, `exportPublicJwk`, `publishJwks`, `importJwks`, `BrokerAlg`, `BrokerSigner`, `VerifyKey`, `VerifyResult`, `VerifyOpts`, `MintAgentSessionInput`, `convergence`, `isCustodiedNamespace`, `SESSION_ISSUANCE_FLOOR`, `canIssueSession`, `selectFromResolution`, `requiresStepUp`, `CUSTODY_CLASS_ACTIONS`, `issueForResolution`, `Convergence`, `IssueDecision`, `CustodyClassAction`, `IssueForResolutionInput`, `IssueOutcome`, `validateRedirectUri`, `newAuthCode`, `createInMemoryAuthCodeStore`, `AuthCodeValue`, `AuthCodeStore`, `mintIdToken`, `mintBoundIdToken`, `verifyIdToken`, `verifyEnrollmentGrantBinding`, `verifyPkceS256`, `OidcIdToken`, `MintIdTokenInput`, `BoundMintIdTokenInput`, `VerifyIdTokenResult`, `VerifyIdTokenOpts`

**Read first:** [`CLAUDE.md`](../../packages/connect/CLAUDE.md) · [`capability.manifest.json`](../../packages/connect/capability.manifest.json) · [`src/index.ts`](../../packages/connect/src/index.ts)

### `@agenticprimitives/connect-auth`

User auth (passkey + SIWE + Google OAuth), JWT sessions, CSRF, and pluggable Signer interfaces consumed by agent-account and delegation.

**Public exports** (46): `mintSession`, `verifySession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `DEFAULT_SESSION_CLOCK_SKEW_SEC`, `VerifySessionOpts`, `csrfTokenFor`, `verifyCsrf`, `CsrfBindings`, `CsrfMintOpts`, `CsrfVerifyOpts`, `deriveSaltFromLabel`, `deriveSaltFromEmail`, `DeriveSaltFromEmailOpts`, `Signer`, `PasskeySigner`, `PasskeyAssertion`, `EOASigner`, `KMSSigner`, `TypedDataDomain`, `TypedDataTypes`, `JwtClaims`, `AuthenticatedUser`, `AuthMethod`, `Address`, `Hex`, `ERC1271_MAGIC`, `ERC6492_MAGIC`, `universalSignatureValidatorAbi`, `verifyUserSignature`, `verifyUserSignatureView`, `isErc6492Wrapped`, `SignatureVerifyResult`, `VerifyUserSignatureArgs`, `UniversalValidatorClient`, `P256_N`, `base64urlEncode`, `base64urlDecode`, `parseDerSignature`, `normaliseLowS`, `buildWebAuthnAssertion`, `hashToWebAuthnChallenge`, `parseAttestationObject`, `parseAuthData`, `WebAuthnAssertion`, `ParsedAttestation`

**Read first:** [`CLAUDE.md`](../../packages/connect-auth/CLAUDE.md) · [`capability.manifest.json`](../../packages/connect-auth/capability.manifest.json) · [`src/index.ts`](../../packages/connect-auth/src/index.ts)

### `@agenticprimitives/content-primitives`

Verifiable Content Substrate: name/resolve/commit/entitlement-gate/cite off-platform rights-held content. Content-agnostic (ADR-0033) — no vertical vocabulary, no content text. Phase 1: pure SDK.

**Public exports** (58): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `AccessPolicy`, `ProofPolicy`, `DescriptorStatus`, `RightsStatus`, `TrustProfile`, `CanonicalLocus`, `CanonicalLocusEnvelope`, `CanonicalReference`, `ContentCommitment`, `CorpusManifest`, `WorkMeta`, `IssuerIdentityRef`, `ContentDescriptor`, `BuildDescriptorInput`, `SignatureVerifier`, `Entitlement`, `CitationAssertion`, `computeCanonicalId`, `canonicalReference`, `LOCUS_ID_SCHEME`, `corpusRef`, `jcsCanonicalize`, `canonicalHash`, `hashPair`, `leafHash`, `buildCorpusTree`, `merkleRoot`, `merkleProof`, `verifyInclusion`, `CorpusTree`, `NORMALIZATION_V1`, `canonicalizeRendering`, `contentCommitment`, `verifyCommitment`, `assertCommitment`, `descriptorHash`, `buildContentDescriptor`, `verifyContentDescriptor`, `VerifyDescriptorOpts`, `VerificationResult`, `resolveCandidates`, `ResolutionConstraints`, `Candidate`, `ResolutionResult`, `TrustProfileConfig`, `evaluateEntitlement`, `buildCitationAssertion`, `EntitlementDecision`, `CitationInput`, `InvalidReferenceError`, `CommitmentMismatchError`, `buildInclusionZkProof`, `bindPaymentMandate`, `DelegatingSigner`, `DelegatedAuthorityVerifier`

**Read first:** [`CLAUDE.md`](../../packages/content-primitives/CLAUDE.md) · [`capability.manifest.json`](../../packages/content-primitives/capability.manifest.json) · [`src/index.ts`](../../packages/content-primitives/src/index.ts)

### `@agenticprimitives/delegated-signer`

Generic named delegated-signer resolution — resolve a name to a signer authorized by a delegation chain (naming/account injected; composes delegation + key-custody). Vertical-agnostic.

**Public exports** (8): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `NameResolver`, `AccountVerifier`, `ResolveDelegatedSignerOpts`, `ResolvedDelegatedSigner`, `resolveDelegatedSigner`

**Read first:** [`CLAUDE.md`](../../packages/delegated-signer/CLAUDE.md) · [`capability.manifest.json`](../../packages/delegated-signer/capability.manifest.json) · [`src/index.ts`](../../packages/delegated-signer/src/index.ts)

### `@agenticprimitives/delegation`

EIP-712 delegations spanning web app → agent → MCP. Caveats, token envelope, validation, session lifecycle.

**Public exports** (58): `ROOT_AUTHORITY`, `buildCaveat`, `buildMcpToolScopeCaveat`, `buildDataScopeCaveat`, `buildDelegateBindingCaveat`, `buildQuorumCaveat`, `encodeTimestampTerms`, `encodeValueTerms`, `encodeAllowedTargetsTerms`, `encodeAllowedMethodsTerms`, `encodeCallDataHashTerms`, `MCP_TOOL_SCOPE_ENFORCER`, `DATA_SCOPE_ENFORCER`, `DELEGATE_BINDING_ENFORCER`, `QuorumCaveatOpts`, `hashDelegation`, `SessionDelegationParams`, `buildSessionDelegation`, `hashCaveats`, `DELEGATION_EIP712_TYPES`, `delegationDomain`, `evaluateCaveats`, `DelegationClient`, `SessionManager`, `createMemorySessionStore`, `verifyAuthorization`, `VerifyAuthorizationResult`, `mintDelegationToken`, `verifyDelegationToken`, `isRevoked`, `Address`, `Hex`, `Caveat`, `CaveatContext`, `CaveatVerdict`, `Delegation`, `DataScopeGrant`, `DelegationClientOpts`, `DelegationTokenClaims`, `EnforcerAddressMap`, `EvaluateOpts`, `JtiStore`, `SessionMeta`, `SessionPackage`, `SessionRow`, `SessionStore`, `TxContext`, `VerifyError`, `VerifyOpts`, `VerifyOptsExt`, `sessionDelegateBindingError`, `PAYMENT_TRANSFER_SELECTOR`, `encodePaymentTerms`, `buildPaymentMandateCaveats`, `describePaymentMandate`, `PaymentMandateCaveatOpts`, `PaymentMandateConsent`, `buildRevokeDelegationCall`

**Read first:** [`CLAUDE.md`](../../packages/delegation/CLAUDE.md) · [`capability.manifest.json`](../../packages/delegation/capability.manifest.json) · [`src/index.ts`](../../packages/delegation/src/index.ts)

### `@agenticprimitives/entitlements`

Resource/action/field/purpose/classification authorization over VC-compatible entitlement credentials (spec 277 §10) — fail-closed matching engine + in-memory resolver. VC-proof/status/cache layers are additive.

**Public exports** (16): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `EntitlementAction`, `EntitlementClassification`, `EntitlementConstraints`, `AgenticEntitlementCredentialV1`, `EntitlementQuery`, `EntitlementReason`, `EntitlementDecision`, `EntitlementResolver`, `CLASSIFICATION_ORDER`, `SingleMatch`, `matchesEntitlement`, `resolveEntitlements`, `InMemoryEntitlementResolver`

**Read first:** [`CLAUDE.md`](../../packages/entitlements/CLAUDE.md) · [`capability.manifest.json`](../../packages/entitlements/capability.manifest.json) · [`src/index.ts`](../../packages/entitlements/src/index.ts)

### `@agenticprimitives/geo-features`

Off-chain geo CLAIM credentials + GeoFeatureRegistry helpers (spec 251). Features on chain; claims are private vault credentials pointing to a (featureId, version). Independent of agent-skills.

**Public exports** (24): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Uri`, `Hex32`, `GEO_KIND`, `GEO_KIND_URI`, `GEO_RELATION`, `GeoVisibility`, `computeFeatureId`, `geometryHash`, `GeoFeaturePublishInput`, `GeoFeatureRef`, `GeoClaimSubject`, `GeoClaimCredential`, `geoClaimId`, `GEO_ENDORSEMENT_TYPEHASH`, `geoEndorsementDigest`, `buildSelfGeoClaim`, `buildEndorsedGeoClaim`, `geoClaimHash`, `GEO_FEATURE_READ_ABI`, `ReadContractFn`, `geoFeatureExists`

**Read first:** [`CLAUDE.md`](../../packages/geo-features/CLAUDE.md) · [`capability.manifest.json`](../../packages/geo-features/capability.manifest.json) · [`src/index.ts`](../../packages/geo-features/src/index.ts)

### `@agenticprimitives/identity-directory`

Evidence-backed read model over canonical agents (ADR-0015 / spec 223): ports (Naming/OnChainRead/Indexer) + query API with provenance + assurance. Not authority; no getLogs; no fallback.

**Public exports** (16): `EvidenceSource`, `Evidence`, `AgentWithEvidence`, `Resolution`, `AgentView`, `EvidenceLink`, `OnChainReadPort`, `NamingPort`, `IndexerPort`, `DirectoryPorts`, `DirectoryOpts`, `IdentityDirectory`, `ASSURANCE_ORDER`, `compareAssurance`, `maxAssurance`, `createDirectory`

**Read first:** [`CLAUDE.md`](../../packages/identity-directory/CLAUDE.md) · [`capability.manifest.json`](../../packages/identity-directory/capability.manifest.json) · [`src/index.ts`](../../packages/identity-directory/src/index.ts)

### `@agenticprimitives/intent-marketplace`

Direct Lane intent marketplace — Intent + ConstraintSet (CSP-shaped) + AssumptionSet + ResolutionReceipt + IntentMatch + composite-score matchmaker. Pool/Proposal lanes deferred.

**Public exports** (23): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Hex32`, `IRI`, `IntentDirection`, `IntentStatus`, `VisibilityTier`, `Intent`, `ConstraintSource`, `ConstraintStrength`, `ConstraintEnforcement`, `ConstraintDomain`, `Constraint`, `ConstraintSet`, `NamedAssumption`, `AssumptionSet`, `ResolutionReceipt`, `IntentMatch`, `Commitment`, `isCompatible`, `composite`, `toMatchScore`

**Read first:** [`CLAUDE.md`](../../packages/intent-marketplace/CLAUDE.md) · [`capability.manifest.json`](../../packages/intent-marketplace/capability.manifest.json) · [`src/index.ts`](../../packages/intent-marketplace/src/index.ts)

### `@agenticprimitives/intent-resolver`

Resolver layer skeleton (W1) — IIntentResolver + ResolvedOrder + PassThroughResolver only. Full resolver engine deferred to W2.

**Public exports** (6): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `IIntentResolver`, `ResolvedOrder`, `PassThroughResolver`

**Read first:** [`CLAUDE.md`](../../packages/intent-resolver/CLAUDE.md) · [`capability.manifest.json`](../../packages/intent-resolver/capability.manifest.json) · [`src/index.ts`](../../packages/intent-resolver/src/index.ts)

### `@agenticprimitives/key-custody`

Envelope encryption + signers + HMAC providers. local-AES/AWS-KMS/GCP-KMS backends behind one A2AKeyProvider interface. No session lifecycle (that's delegation's).

**Public exports** (32): `A2AKeyProvider`, `KmsAccountBackend`, `KmsBackend`, `BuildOpts`, `Secret`, `loadSecret`, `loadSecretFromEnv`, `unwrapSecret`, `isSecret`, `buildKeyProvider`, `buildSignerBackend`, `buildToolExecutorBackendNoIsolation`, `buildMacProvider`, `deriveSubjectSigner`, `subjectCanonicalMessage`, `SubjectId`, `DeriveSubjectOpts`, `getRelayOnlySigner`, `createKmsAccount`, `createKmsViemAccount`, `createRelayerAccount`, `CreateRelayerAccountOpts`, `createSpendCappedAccount`, `SpendCapExceededError`, `CreateSpendCappedAccountOpts`, `canonicalContextBytes`, `LocalAesProvider`, `LocalSecp256k1Signer`, `GcpKmsProvider`, `GcpKmsSigner`, `Address`, `Hex`

**Read first:** [`CLAUDE.md`](../../packages/key-custody/CLAUDE.md) · [`capability.manifest.json`](../../packages/key-custody/capability.manifest.json) · [`src/index.ts`](../../packages/key-custody/src/index.ts)

### `@agenticprimitives/ontology`

Monorepo-wide formal vocabulary: T-box (RDFS/OWL) + C-box (SHACL/SKOS) + A-box. Off-chain source of truth the on-chain ontology (ADR-0009) instantiates. Ships TTL/JSON-LD + IRI constants.

**Public exports** (5): `NS`, `CLASS`, `PREDICATE`, `SHAPE`, `ONTOLOGY_VERSION`

**Read first:** [`CLAUDE.md`](../../packages/ontology/CLAUDE.md) · [`capability.manifest.json`](../../packages/ontology/capability.manifest.json) · [`src/index.ts`](../../packages/ontology/src/index.ts)

### `@agenticprimitives/payments`

PaymentMandate + ContextBinding + MandateConstraints + open/closed mode discrimination. Three W1 rails (x402, wallet, sponsored-userop). PaymentReceipt asserted into AttestationRegistry.

**Public exports** (57): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Hex32`, `PaymentRail`, `AssetRef`, `AmountPolicy`, `MandateConstraints`, `ContextBinding`, `PaymentMandateMode`, `PaymentMandate`, `assertContextBindingValid`, `assertClosedMandateInvariants`, `computeMandateId`, `PaymentRailExecutor`, `registerRail`, `getRail`, `x402`, `PAYMENT_MANDATE_DOMAIN_NAME`, `PAYMENT_MANDATE_DOMAIN_VERSION`, `PAYMENT_MANDATE_EIP712_TYPES`, `ERC1271_MAGIC`, `mandateAmount`, `hashContextBinding`, `paymentMandateDomain`, `buildPaymentMandateTypedData`, `paymentMandateDigest`, `signPaymentMandate`, `verifyPaymentMandateSignature`, `MandateDomainOpts`, `MandateSigner`, `Erc1271Reader`, `PAYMENT_RECEIPT_TYPE`, `settlementEpochBucket`, `buildPaymentReceiptCredential`, `PaymentReceiptInput`, `entitlement`, `ERC20_TRANSFER_ABI`, `buildErc20Transfer`, `buildNativeTransfer`, `TransferPlan`, `buildClosedMandate`, `ClosedMandateInput`, `wallet`, `invoice`, `buildRefund`, `RefundInput`, `RefundPlan`, `buildSplitPayout`, `BPS_DENOMINATOR`, `SplitRecipient`, `SplitLeg`, `ERC20_APPROVE_ABI`, `buildErc20Approve`, `escrow`, `recurring`, `ops`

**Read first:** [`CLAUDE.md`](../../packages/payments/CLAUDE.md) · [`capability.manifest.json`](../../packages/payments/capability.manifest.json) · [`src/index.ts`](../../packages/payments/src/index.ts)

### `@agenticprimitives/related-agents`

Private, holder-resident related-agent credentials (person↔org links as vault situation credentials, never on-chain edges — ADR-0025) + scoped-delegation read caveats + list-query shapes.

**Public exports** (22): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `RELATED_AGENT_DESCRIPTION`, `RelatedAgentBody`, `CustodyKind`, `CustodyDescriptor`, `buildCustodyDescriptor`, `relatedAgentWriteContentHash`, `hashRelatedAgentWriteChallenge`, `RelatedAgentCredential`, `BuildRelatedAgentCredentialArgs`, `buildRelatedAgentCredential`, `relatedAgentProofHash`, `RelatedAgentReadCaveatArgs`, `relatedAgentReadCaveats`, `RelatedAgentLink`, `ListRelatedAgentsResponse`, `DelegatedAgentLink`, `ListDelegatedAgentsResponse`, `Address`, `Hex`

**Read first:** [`CLAUDE.md`](../../packages/related-agents/CLAUDE.md) · [`capability.manifest.json`](../../packages/related-agents/capability.manifest.json) · [`src/index.ts`](../../packages/related-agents/src/index.ts)

### `@agenticprimitives/vault`

Agentic Delegated Data Vault seam (spec 277) — the Vault read/write/list interface + classification taxonomy + persisted envelope. Runtime-agnostic; storage/crypto/entitlement layers behind it.

**Public exports** (19): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `VaultClassification`, `VaultResource`, `VaultObject`, `VaultReadRequest`, `VaultWriteRequest`, `VaultRef`, `VaultObjectEnvelopeV1`, `SENSITIVE_CLASSIFICATIONS`, `isSensitiveClassification`, `Vault`, `createMemoryVault`, `projectFields`, `DekWrapper`, `SealedEnvelope`, `sealEnvelope`, `openEnvelope`

**Read first:** [`CLAUDE.md`](../../packages/vault/CLAUDE.md) · [`capability.manifest.json`](../../packages/vault/capability.manifest.json) · [`src/index.ts`](../../packages/vault/src/index.ts)

### `@agenticprimitives/verifiable-credentials`

W3C VC 2.0 envelope + Eip712Signature2026 proof + DOLCE+DnS Situation bases + ontology-shape schema registration. Substrate for layers 12-15 credential types.

**Public exports** (46): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `VC_CONTEXT_V2`, `EIP712_SIG_2026_CONTEXT`, `VC_DOMAIN_NAME`, `VC_DOMAIN_VERSION`, `VC_EIP712_TYPES`, `Hex32`, `ISODate`, `ProofType`, `Eip712Signature2026Proof`, `DelegatingSignerProof`, `Proof`, `CredentialStatus2021`, `VisibilityTier`, `DisclosurePolicy`, `VerifiableCredential`, `UnsignedCredential`, `jcsCanonicalize`, `canonicalHash`, `JcsError`, `assertSituationRolesPresent`, `buildSituation`, `Situation`, `DescriptionRef`, `RoleName`, `credentialHash`, `eip712Digest`, `isoToSeconds`, `signCredential`, `viemSignerFromWallet`, `kmsCredentialSigner`, `CredentialSigner`, `KmsSigningBackend`, `verifyCredentialStructural`, `VerificationResult`, `SHAPE_DID_PREFIX`, `buildShapeUri`, `parseShapeUri`, `shapeHash`, `verifyCredential`, `parseEip155Caip10`, `VerifyCredentialResult`, `Erc1271Verifier`, `Caip10Eip155`

**Read first:** [`CLAUDE.md`](../../packages/verifiable-credentials/CLAUDE.md) · [`capability.manifest.json`](../../packages/verifiable-credentials/capability.manifest.json) · [`src/index.ts`](../../packages/verifiable-credentials/src/index.ts)

### `@agenticprimitives/browser-identity`

Browser sign-in adapter seam: feature-detect FedCM and choose the browser-native path vs the guaranteed spec-259 fallback. FedCM-first, not FedCM-only (ADR-0031); strategies injected by the consumer.

**Public exports** (4): `fedcmAvailable`, `chooseSignIn`, `SignInStrategy`, `ChooseSignInOptions`

**Read first:** [`CLAUDE.md`](../../packages/browser-identity/CLAUDE.md) · [`capability.manifest.json`](../../packages/browser-identity/capability.manifest.json) · [`src/index.ts`](../../packages/browser-identity/src/index.ts)

### `@agenticprimitives/contracts`

Solidity contracts + ABIs + flattened sources + per-network deployment addresses. The on-chain enforcement layer for the agenticprimitives stack.

**Public exports** (22): `abi/AgentAccount.json`, `abi/AgentAccountFactory.json`, `abi/DelegationManager.json`, `abi/CustodyPolicy.json`, `abi/SmartAgentPaymaster.json`, `abi/UniversalSignatureValidator.json`, `abi/ApprovedHashRegistry.json`, `abi/AgentNameRegistry.json`, `abi/PermissionlessSubregistry.json`, `abi/AgentNameUniversalResolver.json`, `abi/AgentProfileResolver.json`, `abi/OntologyTermRegistry.json`, `abi/ShapeRegistry.json`, `abi/AttributeStorage.json`, `abi/RelationshipTypeRegistry.json`, `abi/AgentRelationship.json`, `abi/MultiSendCallOnly.json`, `abi/SignatureSlotRecovery.json`, `abi/P256Verifier.json`, `abi/WebAuthnLib.json`, `deployments-base-sepolia.json`, `deployments-anvil.json`

**Read first:** [`CLAUDE.md`](../../packages/contracts/CLAUDE.md) · [`capability.manifest.json`](../../packages/contracts/capability.manifest.json) · [`src/index.ts`](../../packages/contracts/src/index.ts)

### `@agenticprimitives/fulfillment`

FulfillmentCase lifecycle + Task/Message/Artifact (re-exported from mcp-runtime/a2a) + HandoffPolicy + EvidenceCredential + OutcomeCredential issuance.

**Public exports** (17): `PACKAGE_NAME`, `PACKAGE_STATUS`, `SPEC_REF`, `Hex32`, `FulfillmentLifecycle`, `canTransition`, `TaskState`, `canTaskTransition`, `FulfillmentCase`, `Task`, `HandoffPolicy`, `isHandoffAllowed`, `Artifact`, `OutcomeCredentialSubject`, `assertOutcomeCitations`, `SpanType`, `IntentTraceSpan`

**Read first:** [`CLAUDE.md`](../../packages/fulfillment/CLAUDE.md) · [`capability.manifest.json`](../../packages/fulfillment/capability.manifest.json) · [`src/index.ts`](../../packages/fulfillment/src/index.ts)

### `@agenticprimitives/mcp-runtime`

Authorization middleware around the official MCP SDK. withDelegation wrapper, JTI replay protection, classification routing. (withCrossDelegation removed in H7-B.8; resurfaces under ./experimental.)

**Public exports** (32): `withDelegation`, `declareResource`, `createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`, `MigratableJtiStore`, `verifyDelegationForResource`, `VerifyDelegationForResourceOpts`, `WithDelegationOpts`, `ProductionWithDelegationOpts`, `DevelopmentWithDelegationOpts`, `McpResourceVerifyConfig`, `ResourceDefinition`, `BetterSqlite3DatabaseLike`, `PgPoolLike`, `Address`, `Hex`, `Caveat`, `DataScopeGrant`, `Delegation`, `EnforcerAddressMap`, `JtiStore`, `ToolClassification`, `McpAuthError`, `McpAuthErrorCode`, `PrivateAuthFailureContext`, `generateServiceMac`, `verifyServiceMac`, `bodyDigestHex`, `MacProviderLike`, `ServiceMacContext`, `ServiceMacHeaders`

**Read first:** [`CLAUDE.md`](../../packages/mcp-runtime/CLAUDE.md) · [`capability.manifest.json`](../../packages/mcp-runtime/capability.manifest.json) · [`src/index.ts`](../../packages/mcp-runtime/src/index.ts)

### `@agenticprimitives/tool-policy`

Protocol-agnostic classification taxonomy + risk tiers + exact-call DSL + decision engine. Consumable by any tool runtime.

**Public exports** (22): `RiskTier`, `ToolClassification`, `ExactCallPolicy`, `PolicyContext`, `PolicyDecision`, `CaveatContext`, `CaveatLike`, `DelegationLike`, `declareTool`, `exactCall`, `matchesExactCall`, `evaluatePolicy`, `clampTtlForRiskTier`, `requiredCaveatsForRiskTier`, `lintClassification`, `LintResult`, `Address`, `Hex`, `ThresholdTier`, `ThresholdPolicyDecision`, `evaluateThresholdPolicy`, `RISK_TIER_REQUIREMENTS`

**Read first:** [`CLAUDE.md`](../../packages/tool-policy/CLAUDE.md) · [`capability.manifest.json`](../../packages/tool-policy/capability.manifest.json) · [`src/index.ts`](../../packages/tool-policy/src/index.ts)

### `@agenticprimitives/fedcm-idp`

FedCM IdP contract as pure builders + validators (web-identity, provider config, accounts, thin assertion, request validators). Generic; the app hosts + signs. Not authority (ADR-0031).

**Public exports** (22): `WebIdentityManifest`, `buildWebIdentity`, `FedcmBranding`, `ProviderConfig`, `ProviderConfigInput`, `buildProviderConfig`, `FedcmAccount`, `AccountsResponse`, `buildAccountsResponse`, `AssertionClaims`, `AssertionInput`, `buildAssertionClaims`, `buildTokenResponse`, `buildContinueResponse`, `FedcmErrorResponse`, `buildErrorResponse`, `assertionCorsHeaders`, `SET_LOGIN_HEADER`, `loginStatusHeader`, `isWebIdentityRequest`, `AssertionRequest`, `parseAssertionRequest`

**Read first:** [`CLAUDE.md`](../../packages/fedcm-idp/CLAUDE.md) · [`capability.manifest.json`](../../packages/fedcm-idp/capability.manifest.json) · [`src/index.ts`](../../packages/fedcm-idp/src/index.ts)

### `@agenticprimitives/fedcm-rp`

Relying-party FedCM wrapper: navigator.credentials.get({identity}) → IdP token. The FedCM strategy injected into browser-identity's chooseSignIn. Post-145; thin bootstrap, not authority (ADR-0031).

**Public exports** (5): `FedcmProvider`, `FedcmGetOptions`, `FedcmResult`, `fedcmSupported`, `fedcmGet`

**Read first:** [`CLAUDE.md`](../../packages/fedcm-rp/CLAUDE.md) · [`capability.manifest.json`](../../packages/fedcm-rp/capability.manifest.json) · [`src/index.ts`](../../packages/fedcm-rp/src/index.ts)

### `@agenticprimitives/identity-directory-adapters`

Port impls for identity-directory: NamingPort (wraps agent-naming), OnChainReadPort (viem readContract), IndexerPort (in-memory). The composition layer allowed to import agent-naming.

**Public exports** (10): `toCanonicalAgentId`, `addressOf`, `EIP155_NAMESPACE`, `makeNamingPort`, `NamingReads`, `makeOnChainReadPort`, `viemExists`, `OnChainReaders`, `createInMemoryIndexer`, `IndexerEntry`

**Read first:** [`CLAUDE.md`](../../packages/identity-directory-adapters/CLAUDE.md) · [`capability.manifest.json`](../../packages/identity-directory-adapters/capability.manifest.json) · [`src/index.ts`](../../packages/identity-directory-adapters/src/index.ts)

## Dependency graph

```
types                (leaf)
a2a                  → types, fulfillment, delegation
account-custody      → types
agent-account        → types, connect-auth
agent-naming         → types, connect-auth, agent-account
agent-profile        → types, connect-auth, agent-account
agent-relationships  → types, connect-auth, agent-account
agent-skills         → types, verifiable-credentials
agreements           → types, verifiable-credentials
attestations         → types, verifiable-credentials, delegation
audit                → types
connect              → types, connect-auth, identity-directory
connect-auth         → types
content-primitives   → types, verifiable-credentials
delegated-signer     → types, delegation, key-custody
delegation           → types, audit, connect-auth, agent-account, key-custody
entitlements         (leaf)
geo-features         → types, verifiable-credentials
identity-directory   → types, audit, ontology
intent-marketplace   → types, verifiable-credentials, delegation, intent-resolver
intent-resolver      → types, verifiable-credentials
key-custody          → types, audit, connect-auth
ontology             (leaf)
payments             → types, verifiable-credentials, attestations, delegation
related-agents       → types, verifiable-credentials, delegation
vault                (leaf)
verifiable-credentials → types, ontology
browser-identity     (leaf)
contracts            (leaf)
fulfillment          → types, verifiable-credentials, attestations, agreements, delegation
mcp-runtime          → types, audit, delegation, key-custody, tool-policy
tool-policy          → types
fedcm-idp            (leaf)
fedcm-rp             (leaf)
identity-directory-adapters → types, identity-directory, agent-naming
```
