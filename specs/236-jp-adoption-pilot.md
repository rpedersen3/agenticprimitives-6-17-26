# Spec 236 — Joshua Project "Adopt-a-People-Group" pilot (demo-jp)

Status: PLANNED 2026-05-29. Architect-of-record for **`apps/demo-jp`** — a relying app for JP's
Frontier-People-Group **ADOPT** brokerage, built on agenticprimitives. Public UX (à la
`joshuaproject.net/adopt`) + two onboarding flows (**adopter**, **facilitator**) that push the user
into **Impact (demo-sso)** to connect, create an org, add personal + org data, and sign the
**ADOPT MOU** + **WEA Statement of Faith** — all **held in Impact** — then return to one of two
**demo-jp intranets** (adopter / facilitator) that read the member's data via a **scoped
delegation**. demo-jp never custodies identity or holds the source-of-truth data; Impact does.

Source: Paul's pilot scoping doc (`JP-Adopt-People-Group-Pilot-Scoping-Doc`, 2026-05-29). That doc
proposes Privy/EAS/PROV-O; this spec implements the SAME domain model on our substrate (person/org
ERC-4337 SAs, ERC-7710 delegation, EIP-712 attestations, on-chain relationships).

## 1. The mapping (doc concept → agenticprimitives)

| JP scoping-doc concept | agenticprimitives |
| --- | --- |
| Person identity (Privy user + EOA) | The **person Smart Agent** = the member's Impact home (demo-sso), custodied by passkey/wallet/Google-KMS |
| Organization (adopter org / facilitator org) | A **child Smart Agent** created via Impact (`createChildAgentForSite`, custodied by the person's ROOT credential — same as demo-org orgs) |
| Account / AccountControlPolicy | The SA's custodian set + `account-custody` policy (mode/custodians/trustees) |
| DelegationGrant (person→org role; org→site) | **ERC-7710 scoped delegations** (delegation pkg). org→demo-jp = a `site-login`/data-scope grant (like demo-org) |
| AgreementAttestation (MOU / WEA) | **EIP-712 signed acceptance**, signed by the member's credential, **stored in Impact** + a derived **attestation/assertion** pushed to demo-jp (§4) |
| AdoptionCommitment / FacilitatorCoverage | A **relationship / declaration** the person/org SA records (on-chain `AgentRelationship` edge + off-chain capacity matrix in Impact) |
| Introduction / DisclosureGrant | A **broker-approved scoped delegation** releasing contact/capacity data adopter↔facilitator (later phase) |
| PeopleGroupSegment (PGS) / FPG | A **public anchor** (a named entity / id; not a person-org secret) — config + a public registry |
| JP staff / broker | An **operator** that approves matches + releases introductions (human-curated v1) |

**Reference (patterns to port):** `apps/demo-org` is the relying-app template (public gateway →
connect-with-Impact → `createChildAgentForSite` org creation → scoped `org→site` delegation →
`readPersonData`/`readOrgData` over the delegation). demo-jp reuses that wholesale + adds the JP
domain (adopter/facilitator flows, MOU/WEA signing, adoption/coverage declarations, the two
intranets). smart-agent analog: the org-governance + delegation flows already ported into
agent-account/delegation/account-custody.

## 2. Doctrine fit (ADR-0021)

demo-jp is an **app** → all JP/faith vertical content lives here: the public copy (à la JP /adopt),
the **ADOPT MOU** text, the **WEA Statement of Faith** text, people-group vocabulary, the
adopter/facilitator capacity matrices. The GENERIC primitives it consumes — person/child SA,
delegation, `account-custody`, the **document-attestation signing** capability (§4, document-
agnostic, lives in demo-sso/a generic helper), relationships — carry NO JP/faith content.
demo-jp centralizes its domain literals (hostnames, MOU/WEA, PGS anchors) in one config module.

## 3. The two onboarding flows (public → Impact → intranet)

Both mirror demo-org's connect ceremony, extended with data + signing. The PUBLIC demo-jp pages
explain the capability (adopt / facilitate); the CTA hands off to Impact:

**Adopter** (`/adopt`): public capability page → "Adopt with Impact" → Impact: connect (or create
home) → [if org/church/network] create the **adopter org** → add **personal profile** + **org
profile** data → sign **ADOPT MOU** (+ **WEA Statement of Faith** for org/network) → return to
demo-jp **adopter intranet** with a scoped delegation. Then declare an **AdoptionCommitment** for a
chosen FPG/PGS (with `wantFacilitatorConnection`).

**Facilitator** (`/facilitate-adoption`): public page → "Facilitate with Impact" → Impact: connect
→ create/claim the **facilitator org** → add org profile + **capacity matrix** (adopter types ×
size bands, ministryAreas, fpgSelections) → sign **ADOPT MOU** + **WEA** (named signatory) → return
to demo-jp **facilitator intranet** with a scoped delegation. Then declare **FacilitatorCoverage**.

The member's data + signatures **stay in Impact**; demo-jp holds only the scoped delegation +
demo-jp-local records (the declarations it brokers). Reads happen over the delegation (`readPersonData`/`readOrgData` pattern).

## 4. MOU + WEA signing (held in Impact, attested to demo-jp)

A **document-agnostic AgreementAttestation** capability in Impact (demo-sso):
- `AgreementTemplate` = { kind: `ADOPT_MOU` | `WEA_STATEMENT`, version, canonical text URI, content
  **hash**, effective dates }. The MOU/WEA TEXT is demo-jp config; the signing engine is generic.
- The member signs an **EIP-712** typed acceptance (doc §8 shape): `{ subjectPersonId,
  representedOrgId|null, agreementKind, agreementVersion, agreementHash, permissionsAcknowledged[],
  signedAt, nonce }`, signed by their credential (passkey/wallet/Google-KMS via the custody path).
- Impact **stores** the signed attestation (the audit-grade record stays with the member's home);
  demo-jp receives a **derived assertion/attestation** ("Org C accepted ADOPT MOU v1 under Person
  B's signatory authority at T1; hash H") — enough to gate adoption/coverage without holding the
  PII. Evidence progression (doc §8): v1 = EIP-712 from the credential; v1.5 = org SA ERC-1271;
  v2 = portable (EAS/VC). On-chain anchor = the hash only, never confidential association content.

## 5. Confidentiality tiers (doc §7)

Public: PGS/FPG anchors, org public profile, the aggregate "X of N FPGs adopted" counter.
Confidential: which adopter adopted which PGS, person contact data, org confidential profile, the
signed attestations' signatory/profile (existence may be public, content not). Top-secret/out of
scope v1: worker-identity/field data. Impact enforces the boundary (the data lives there, released
only via Introduction/DisclosureGrant delegations).

## 6. Demo success criteria (doc §14, on our stack)

Single FPG/PGS, 2 test orgs, 4 persons: (a) Person A connects to Impact, creates facilitator org F,
signs MOU+WEA for F (org:signatory delegation), declares FacilitatorCoverage for PGS X with a
capacity matrix; (b) Person B connects, registers church C, signs MOU+WEA, submits AdoptionCommitment
for PGS X with `wantFacilitatorConnection`; (c) broker confirms the match → Introduction → scoped
DisclosureGrant; (d) C and F see each other's released fields, nobody else; (e) public counter
increments; (f) provenance view ("C adopted under MOU v1 signed by B at T1 under grant D1; …");
(g) withdrawal decrements + preserves history (revision, not deletion).

## 7. Phases

- **P1 — App + public UX + onboarding handoff + intranets (delegated read).** Scaffold `apps/demo-jp`
  from the demo-org template. Public `/adopt` + `/facilitate-adoption` capability pages. Two CTAs →
  Impact connect/create-org (reuse demo-org's central-auth + `createChildAgentForSite`). Two
  signed-in **intranets** (adopter / facilitator) reading the member's person+org data over the
  scoped delegation. (No MOU/WEA, no declarations yet — proves identity + org + delegation + data.)
- **P2 — MOU + WEA signing in Impact + attestation to demo-jp.** The generic AgreementAttestation
  engine (demo-sso) + the MOU/WEA templates (demo-jp config) + the intranets gate on the attestation.
- **P3 — Declarations: AdoptionCommitment + FacilitatorCoverage** (capacity matrix; on-chain
  relationship + Impact-held data) surfaced in the intranets + the public counter.
- **P4 — Introduction + DisclosureGrant** (broker approval → scoped adopter↔facilitator data release).
- **P5 — Provenance/audit view + withdrawal (revision-not-deletion)**; v1.5 org-SA custody (N-of-M).

## 8. Open questions (route to JP — doc §13)

MOU custodian (JP vs Impact-held, accessible to JP?); is facilitator coverage self-declared vs
JP-delegated (PGSDelegationGrant); automated vs broker-only introduction release; PGS id scheme
(PeopleID3/PGAC). These gate P3/P4; P1/P2 proceed without them.

## 9. Out of scope (v1)

Worker-identity/field-routing data; automated contact release without broker approval; full
EAS/VC portability; production custody migration. (Doc §15.)
