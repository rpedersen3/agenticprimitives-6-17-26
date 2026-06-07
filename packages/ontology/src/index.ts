// @agenticprimitives/ontology — the monorepo-wide formal vocabulary.
//
// This package is DECLARATIVE: it ships the RDFS/OWL T-box + SHACL/SKOS C-box
// artifacts (the source of truth) and exposes their stable IRIs + paths as
// typed constants. It has NO runtime auth/policy logic and depends on nothing
// (the vocabulary root — ADR-0018; spec 225). SHACL-engine validation over
// arbitrary instances is Phase 2 (spec 225 §11).
//
// See:
//   - ../../specs/225-ontology.md — the contract
//   - ../../docs/architecture/decisions/0018-agenticprimitives-wide-formal-ontology.md
//   - ../../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md (the on-chain peer)
//
// This entry is BROWSER-SAFE (pure IRI constants — no Node builtins), so
// browser consumers (identity-directory → connect → demo-sso) can bundle it.
// The Node-only artifact loaders (`ARTIFACTS` paths + `artifactPath`, which use
// `node:url`/the filesystem) live in the `@agenticprimitives/ontology/artifacts`
// subpath — import those only server-side.

/** Bumped on any breaking change to the shipped vocabulary. */
export const ONTOLOGY_VERSION = '0.1.0' as const;

/**
 * Namespace IRIs, split per domain (mirrors the reference
 * `smartagent.io/ontology/<domain>#` scheme; spec 225 §4). Pinned base:
 * `https://agenticprimitives.dev/ns/`.
 *
 * Wave 1 (2026-06-02b) added the v2 coordination substrate namespaces per
 * spec 225 §11.5 (apint / apcst / apres / apagr / appay / apful / apatt /
 * apvc) — substrate-wide T-box vocabulary for the 15-layer coordination spine
 * (ADR-0024). Runtime SHACL shapes for each live in their owning packages
 * per PD-19.
 */
export const NS = {
  // Phase-1 (existing)
  ap: 'https://agenticprimitives.dev/ns/core#',
  apid: 'https://agenticprimitives.dev/ns/identity#',
  apcr: 'https://agenticprimitives.dev/ns/credential#',
  apdel: 'https://agenticprimitives.dev/ns/delegation#',
  apcus: 'https://agenticprimitives.dev/ns/custody#',
  apaud: 'https://agenticprimitives.dev/ns/audit#',
  apnam: 'https://agenticprimitives.dev/ns/naming#',
  aprel: 'https://agenticprimitives.dev/ns/relationships#',
  aporg: 'https://agenticprimitives.dev/ns/org#',
  // Phase-1.5 (v2 coordination substrate spine; spec 225 §11.5)
  apint: 'https://agenticprimitives.dev/ns/intent#',
  apcst: 'https://agenticprimitives.dev/ns/constraint#',
  apres: 'https://agenticprimitives.dev/ns/resolution#',
  apagr: 'https://agenticprimitives.dev/ns/agreement#',
  appay: 'https://agenticprimitives.dev/ns/payment#',
  apful: 'https://agenticprimitives.dev/ns/fulfillment#',
  apatt: 'https://agenticprimitives.dev/ns/attestation#',
  apvc: 'https://agenticprimitives.dev/ns/verifiable-credential#',
  // Generic skills + geo substrate (spec 251)
  aps: 'https://agenticprimitives.dev/ns/skill#',
  apg: 'https://agenticprimitives.dev/ns/geo#',
  // Generic verifiable-content substrate (spec 266) — content is scheme-anchored,
  // NOT a Smart Agent facet (ADR-0033). Zero vertical/faith vocabulary.
  apcnt: 'https://agenticprimitives.dev/ns/content#',
} as const;

/** Class IRIs (T-box). Each is `<namespace><LocalName>`. */
export const CLASS = {
  // Phase-1
  Agent: `${NS.ap}Agent`,
  CanonicalAgentId: `${NS.ap}CanonicalAgentId`,
  Facet: `${NS.ap}Facet`,
  Evidence: `${NS.ap}Evidence`,
  CredentialFacet: `${NS.apcr}CredentialFacet`,
  NameFacet: `${NS.apnam}NameFacet`,
  OidcSubject: `${NS.apid}OidcSubject`,
  Org: `${NS.aporg}Org`,
  // Phase-1.5: intent layer
  Desire: `${NS.apint}Desire`,
  Intent: `${NS.apint}Intent`,
  ReceiveIntent: `${NS.apint}ReceiveIntent`,
  GiveIntent: `${NS.apint}GiveIntent`,
  MatchInitiation: `${NS.apint}MatchInitiation`,
  IntentMatch: `${NS.apint}IntentMatch`,
  Commitment: `${NS.apint}Commitment`,
  Proposal: `${NS.apint}Proposal`,
  SolverBid: `${NS.apint}SolverBid`,
  // Phase-1.5: constraint layer
  ConstraintSet: `${NS.apcst}ConstraintSet`,
  Constraint: `${NS.apcst}Constraint`,
  HardConstraint: `${NS.apcst}HardConstraint`,
  SoftConstraint: `${NS.apcst}SoftConstraint`,
  ConstraintDomain: `${NS.apcst}ConstraintDomain`,
  EnumDomain: `${NS.apcst}EnumDomain`,
  RangeDomain: `${NS.apcst}RangeDomain`,
  SetDomain: `${NS.apcst}SetDomain`,
  PredicateDomain: `${NS.apcst}PredicateDomain`,
  AssumptionSet: `${NS.apcst}AssumptionSet`,
  NamedAssumption: `${NS.apcst}NamedAssumption`,
  ValidationRequirement: `${NS.apcst}ValidationRequirement`,
  // Phase-1.5: resolution layer
  Resolver: `${NS.apres}Resolver`,
  ResolvedOrder: `${NS.apres}ResolvedOrder`,
  ResolutionReceipt: `${NS.apres}ResolutionReceipt`,
  PolicyCheckResult: `${NS.apres}PolicyCheckResult`,
  ToolCallTrace: `${NS.apres}ToolCallTrace`,
  // Phase-1.5: agreement layer
  AgreementCommitment: `${NS.apagr}AgreementCommitment`,
  AgreementCredential: `${NS.apagr}AgreementCredential`,
  AgreementStatus: `${NS.apagr}AgreementStatus`,
  // Phase-1.5: payment layer
  PaymentMandate: `${NS.appay}PaymentMandate`,
  OpenPaymentMandate: `${NS.appay}OpenPaymentMandate`,
  ClosedPaymentMandate: `${NS.appay}ClosedPaymentMandate`,
  PaymentReceipt: `${NS.appay}PaymentReceipt`,
  MandateConstraints: `${NS.appay}MandateConstraints`,
  ContextBinding: `${NS.appay}ContextBinding`,
  PaymentRail: `${NS.appay}PaymentRail`,
  // Phase-1.5: fulfillment layer
  FulfillmentCase: `${NS.apful}FulfillmentCase`,
  FulfillmentTopology: `${NS.apful}FulfillmentTopology`,
  Task: `${NS.apful}Task`,
  HandoffPolicy: `${NS.apful}HandoffPolicy`,
  Message: `${NS.apful}Message`,
  Artifact: `${NS.apful}Artifact`,
  ArtifactKind: `${NS.apful}ArtifactKind`,
  IntentTraceSpan: `${NS.apful}IntentTraceSpan`,
  // Phase-1.5: attestation layer
  Attestation: `${NS.apatt}Attestation`,
  EvidenceCredential: `${NS.apatt}EvidenceCredential`,
  OutcomeCredential: `${NS.apatt}OutcomeCredential`,
  ValidationCredential: `${NS.apatt}ValidationCredential`,
  Validator: `${NS.apatt}Validator`,
  ValidatorKind: `${NS.apatt}ValidatorKind`,
  TrustUpdate: `${NS.apatt}TrustUpdate`,
  AssociationCredential: `${NS.apatt}AssociationCredential`,
  // Phase-1.5: VC envelope
  VerifiableCredential: `${NS.apvc}VerifiableCredential`,
  // Verifiable-content substrate (spec 266; FRBR Work/Manifestation/Item)
  CanonicalLocus: `${NS.apcnt}CanonicalLocus`,
  CorpusManifest: `${NS.apcnt}CorpusManifest`,
  ContentDescriptor: `${NS.apcnt}ContentDescriptor`,
  CitationAssertion: `${NS.apcnt}CitationAssertion`,
  Entitlement: `${NS.apcnt}Entitlement`,
} as const;

/** Predicate / property IRIs (T-box). */
export const PREDICATE = {
  // Phase-1
  isFacetOf: `${NS.apid}isFacetOf`,
  controls: `${NS.apcr}controls`,
  hasEvidence: `${NS.ap}hasEvidence`,
  assurance: `${NS.ap}assurance`,
  controlStatus: `${NS.ap}controlStatus`,
  resolvesTo: `${NS.apnam}resolvesTo`,
  memberOf: `${NS.aporg}memberOf`,
  delegatesTo: `${NS.apdel}delegatesTo`,
  // Phase-1.5: intent
  direction: `${NS.apint}direction`,
  object: `${NS.apint}object`,
  topic: `${NS.apint}topic`,
  expressedBy: `${NS.apint}expressedBy`,
  addressedTo: `${NS.apint}addressedTo`,
  hasConstraintSet: `${NS.apint}hasConstraintSet`,
  hasAssumptionSet: `${NS.apint}hasAssumptionSet`,
  expectedOutcome: `${NS.apint}expectedOutcome`,
  visibility: `${NS.apint}visibility`,
  status: `${NS.apint}status`,
  matchedWith: `${NS.apint}matchedWith`,
  // Phase-1.5: constraint
  variable: `${NS.apcst}variable`,
  domain: `${NS.apcst}domain`,
  source: `${NS.apcst}source`,
  rationale: `${NS.apcst}rationale`,
  strength: `${NS.apcst}strength`,
  enforcement: `${NS.apcst}enforcement`,
  fieldDisclosure: `${NS.apcst}fieldDisclosure`,
  resolverId: `${NS.apcst}resolverId`,
  trustLevel: `${NS.apcst}trustLevel`,
  risk: `${NS.apcst}risk`,
  evidenceRef: `${NS.apcst}evidenceRef`,
  // Phase-1.5: resolution
  resolvedFrom: `${NS.apres}resolvedFrom`,
  canonicalConstraints: `${NS.apres}canonicalConstraints`,
  expandedAssumptions: `${NS.apres}expandedAssumptions`,
  resolverAgent: `${NS.apres}resolverAgent`,
  resolverVersion: `${NS.apres}resolverVersion`,
  modelName: `${NS.apres}modelName`,
  confidence: `${NS.apres}confidence`,
  requiresUserConfirmation: `${NS.apres}requiresUserConfirmation`,
  userConfirmedAt: `${NS.apres}userConfirmedAt`,
  policyVersion: `${NS.apres}policyVersion`,
  hasPolicyCheck: `${NS.apres}hasPolicyCheck`,
  hasToolCall: `${NS.apres}hasToolCall`,
  // Phase-1.5: agreement
  hasIssuer: `${NS.apagr}hasIssuer`,
  hasParty: `${NS.apagr}hasParty`,
  agreementCommitmentHash: `${NS.apagr}agreementCommitmentHash`,
  schemaHash: `${NS.apagr}schemaHash`,
  agreementStatus: `${NS.apagr}status`,
  createdEpochBucket: `${NS.apagr}createdEpochBucket`,
  fromIntentMatch: `${NS.apagr}fromIntentMatch`,
  // Phase-1.5: payment
  payer: `${NS.appay}payer`,
  payee: `${NS.appay}payee`,
  granter: `${NS.appay}granter`,
  rail: `${NS.appay}rail`,
  mode: `${NS.appay}mode`,
  requiresClosedMandateForFinalCharge: `${NS.appay}requiresClosedMandateForFinalCharge`,
  contextBindingIntent: `${NS.appay}contextBindingIntent`,
  contextBindingAgreement: `${NS.appay}contextBindingAgreement`,
  chain: `${NS.appay}chain`,
  maxAggregateAmount: `${NS.appay}maxAggregateAmount`,
  nonce: `${NS.appay}nonce`,
  maxRedemptions: `${NS.appay}maxRedemptions`,
  expiresAt: `${NS.appay}expiresAt`,
  // Phase-1.5: fulfillment
  hasParentAgreement: `${NS.apful}hasParentAgreement`,
  topology: `${NS.apful}topology`,
  taskState: `${NS.apful}taskState`,
  assignee: `${NS.apful}assignee`,
  assigneeKind: `${NS.apful}assigneeKind`,
  permissionGrantRef: `${NS.apful}permissionGrantRef`,
  paymentMandateRef: `${NS.apful}paymentMandateRef`,
  sender: `${NS.apful}sender`,
  bodyRef: `${NS.apful}bodyRef`,
  bodyHash: `${NS.apful}bodyHash`,
  artifactKind: `${NS.apful}artifactKind`,
  disclosurePolicy: `${NS.apful}disclosurePolicy`,
  spanType: `${NS.apful}spanType`,
  parentSpan: `${NS.apful}parentSpan`,
  // Phase-1.5: attestation
  uid: `${NS.apatt}uid`,
  credentialType: `${NS.apatt}credentialType`,
  credentialHash: `${NS.apatt}credentialHash`,
  refUID: `${NS.apatt}refUID`,
  bilateralConsentRef: `${NS.apatt}bilateralConsentRef`,
  basedOnIntent: `${NS.apatt}basedOnIntent`,
  basedOnArtifact: `${NS.apatt}basedOnArtifact`,
  citesEvidence: `${NS.apatt}citesEvidence`,
  citesValidation: `${NS.apatt}citesValidation`,
  validatorKind: `${NS.apatt}validatorKind`,
  offchainCredentialStatusList: `${NS.apatt}offchainCredentialStatusList`,
  // Verifiable-content substrate (spec 266)
  locusOf: `${NS.apcnt}locusOf`,
  renderedBy: `${NS.apcnt}renderedBy`,
  commitsTo: `${NS.apcnt}commitsTo`,
  retrievalPointer: `${NS.apcnt}retrievalPointer`,
  corpusRoot: `${NS.apcnt}corpusRoot`,
  issuedBy: `${NS.apcnt}issuedBy`,
  accessPolicy: `${NS.apcnt}accessPolicy`,
  proofPolicy: `${NS.apcnt}proofPolicy`,
  citesLocus: `${NS.apcnt}citesLocus`,
  underEntitlement: `${NS.apcnt}underEntitlement`,
} as const;

/** SHACL shape IRIs (C-box).
 *
 * NOTE: substrate-spine runtime SHACL shapes live in their OWNING packages
 * per PD-19, NOT in this package. The shape IRIs below are only the ones
 * the ontology package itself ships (identity / core layer); for spine
 * shapes (intents, constraints, agreement, payment, fulfillment, credentials,
 * a2a-task), import from the owning package.
 */
export const SHAPE = {
  CanonicalAgentId: `${NS.ap}CanonicalAgentIdShape`,
  CredentialFacet: `${NS.apcr}CredentialFacetShape`,
  // Verifiable-content substrate (spec 266) — encodes ADR-0033 R3 (no inline text).
  ContentDescriptor: `${NS.apcnt}ContentDescriptorShape`,
} as const;

// `ARTIFACTS` + `artifactPath` (Node-only, `node:url`) live in the
// `@agenticprimitives/ontology/artifacts` subpath — keep this entry browser-safe.
