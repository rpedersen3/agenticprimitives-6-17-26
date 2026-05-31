---
'@agenticprimitives/types': patch
'@agenticprimitives/audit': patch
'@agenticprimitives/connect-auth': patch
'@agenticprimitives/connect': patch
'@agenticprimitives/key-custody': patch
'@agenticprimitives/account-custody': patch
'@agenticprimitives/agent-account': patch
'@agenticprimitives/delegation': patch
'@agenticprimitives/tool-policy': patch
'@agenticprimitives/mcp-runtime': patch
'@agenticprimitives/agent-naming': patch
'@agenticprimitives/agent-profile': patch
'@agenticprimitives/agent-relationships': patch
'@agenticprimitives/identity-directory': patch
'@agenticprimitives/identity-directory-adapters': patch
'@agenticprimitives/ontology': patch
'@agenticprimitives/contracts': patch
---

R4.9 verification — first publish via OIDC Trusted Publishing.

No code changes — this prerelease bump only exists to exercise the new
auth path end-to-end. After this lands at `0.1.0-alpha.3` on npm via the
Release workflow's `Publish via changesets` step, R4 is fully verified:

  - permissions.id-token: write produces a Sigstore OIDC token
  - changesets/action delegates to pnpm publish
  - pnpm publish authenticates to registry.npmjs.org via that token
  - npm matches the token against the `npm trust github` configuration
    landed in R4.7 (workflow file = `release.yml`, repo =
    `agentictrustlabs/agenticprimitives`, permission = `publish`)
  - Sigstore provenance attestation is signed by the same OIDC token
    and published to the transparency log
  - Per-package CycloneDX SBOM is attached to the GH Release

Rollback path (if the publish step fails): the bootstrap publishes
landed at `0.1.0-alpha.2`, so consumers on that pin stay frozen. The
`NPM_TOKEN` repo secret can be re-set + the env line re-added to
`release.yml` to revert R4.8.
