---
"@agenticprimitives/related-agents": minor
---

NEW-RAG-2 (security): add `relatedAgentWriteContentHash` + `hashRelatedAgentWriteChallenge` — the bound,
one-shot challenge a person-SA custodian signs to authorize an external-custodian related-agent write
(replaces the replayable constant challenge in the demo-sso `related-orgs` write path). Client and server
derive the digest identically so they can't drift.
