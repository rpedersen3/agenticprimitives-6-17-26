---
"@agenticprimitives/content-primitives": patch
"@agenticprimitives/verifiable-credentials": patch
---

Issuer-delegated content signing: optional `delegatingSigner` on `ContentDescriptor`
and on the VC `Eip712Signature2026Proof`, so content can be signed by an
issuer-AUTHORIZED operational key (e.g. a Cloud KMS key) instead of the issuer's
own custodian, while trust still roots in the issuer Smart Agent.

- content-primitives: `ContentDescriptor.delegatingSigner { delegatorIssuer,
  delegateKey, delegationLeaf }`; `buildContentDescriptor` attaches it;
  `verifyContentDescriptor` does leaf-then-delegate via an injected
  `verifyDelegatedAuthority` (the package stays delegation-agnostic) and requires
  `issuer.address == delegatorIssuer` so a delegate can never re-attribute an issuer.
- verifiable-credentials: `Eip712Signature2026Proof.delegatingSigner` (carried in
  the proof, which is stripped from the credential hash — does not change the signed
  digest); `signCredential` accepts it.

Backward-compatible — both fields are optional; existing direct-issuer signing is
unchanged. Enables per-edition issuers (e.g. lbsb descriptors attributed to
lbsb.impact, not bsb.impact) with no held issuer key.
