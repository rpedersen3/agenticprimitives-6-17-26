# Public Open Review Announcement — June 2026

Use this as the launch copy once the review commit/tag and reporting channel are final.

## Short Announcement

`agenticprimitives` is opening its June 2026 public self-audit for community review.

The packet covers the alpha Smart Agent substrate: ERC-4337 accounts, custody/recovery, EIP-712 delegation, on-chain caveats, MCP/A2A authorization, naming, attestations, and testnet operational posture.

Start here:

- Self-audit report: `docs/audits/self-audit-2026-06.md`
- Evidence index: `docs/audits/audit-evidence-index.md`
- Review instructions: `docs/audits/open-review-2026-06.md`
- Bounty terms: `docs/audits/bug-bounty-2026-06.md`
- Validation ledger: `docs/audits/validation-results-2026-06.md`

Known upfront: this is an alpha/testnet review. The disclosed testnet deployer key is an accepted testnet risk and an open production blocker. Production requires clean KMS-backed keys, multisig/timelock governance, and retained external audit evidence.

## Suggested Channels

- GitHub Discussions or Issues with labels: `security-review`, `audit-finding`, `needs-triage`.
- Ethereum Magicians.
- r/ethdev.
- r/smartcontractsecurity.
- X / Farcaster.
- Audit and formal-verification Discords.

## Launch Checklist

- Freeze review commit.
- Create tag, for example `self-audit-2026-06-rc1`.
- Confirm private reporting path for critical/high findings.
- Confirm bounty pool or mark rewards discretionary.
- Link retained CI artifacts for Echidna, Medusa, Slither, Aderyn, CodeQL, and SBOM.
- Post announcement copy.
- Triage daily during the review window.
- Publish closing report after the window ends.
