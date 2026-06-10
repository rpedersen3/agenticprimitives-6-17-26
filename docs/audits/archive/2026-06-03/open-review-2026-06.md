# Open Review Instructions — June 2026

| Field | Value |
|---|---|
| Status | Draft for public review launch |
| Review artifact | [`self-audit-2026-06.md`](./self-audit-2026-06.md) |
| Evidence index | [`audit-evidence-index.md`](./audit-evidence-index.md) |
| Bounty terms | [`bug-bounty-2026-06.md`](./bug-bounty-2026-06.md) |

## Purpose

This open review invites security researchers, smart-contract auditors, formal-methods practitioners, and protocol engineers to review the `agenticprimitives` alpha substrate before a paid audit or contest.

The review is a public self-audit plus open community review. It is not a claim that the system is production-ready for real funds.

## Review Scope

High-value areas:

- Smart Agent account authority and upgrade controls.
- Custody and recovery policy.
- Delegation hashing, caveats, revocation, and ERC-1271 verification.
- Paymaster sponsorship controls.
- WebAuthn/P-256 verification.
- Naming registry authorization and reverse resolution.
- MCP/A2A delegation-token verification and audit durability.
- KMS/key-custody assumptions.
- Privacy boundaries around related agents and public relationship assertions.

Lower-priority but welcome:

- Documentation drift that could mislead an auditor.
- CI gaps where a security invariant is documented but not enforced.
- Reproducibility gaps in the audit evidence.

Out of scope:

- Testnet-only inconvenience bugs without authority, privacy, or audit impact.
- UI copy/polish unless it causes consent or custody confusion.
- Social engineering, spam, phishing, or attacks on third-party platforms.
- Issues already explicitly disclosed in [`self-audit-2026-06.md`](./self-audit-2026-06.md), unless you add a new exploit path or materially higher impact.

## How To Review

Recommended reading order:

1. [`self-audit-2026-06.md`](./self-audit-2026-06.md)
2. [`audit-evidence-index.md`](./audit-evidence-index.md)
3. [`packages/contracts/AUDIT.md`](../../packages/contracts/AUDIT.md)
4. [`threat-model.md`](./threat-model.md)
5. [`evidence-checklist.md`](./evidence-checklist.md)
6. Package-specific `AUDIT.md` files for the surface you are reviewing.

Recommended local command set:

```bash
pnpm install --frozen-lockfile
cd packages/contracts && bash setup.sh && cd ../..
pnpm check:all
pnpm check:abi-sync
pnpm check:api-surface
pnpm check:contracts
pnpm check:forge-coverage
pnpm check:storage-layouts
pnpm check:contracts-halmos
pnpm check:contracts-lint
pnpm check:eip712-typehash-equality
pnpm check:supply-chain
```

Use Node 22 for the full recursive/e2e command. The package and contracts checks run under Node 20, but `tests/e2e` starts Wrangler, and current Wrangler refuses Node versions below 22.

Optional deep fuzzing:

```bash
cd packages/contracts
pnpm echidna
pnpm medusa
```

Echidna and Medusa are long-running; CI artifacts may be used instead of local runs.

## Reporting Findings

Use a private report channel for suspected critical or high severity findings if one is available for the review window. If no private channel is configured yet, open a GitHub issue with only a high-level title and request a private contact path before posting exploit details.

For medium/low findings, GitHub Issues or Discussions are appropriate.

Include:

- Affected files and contracts/packages.
- Severity and impact.
- Preconditions.
- Reproduction steps or proof sketch.
- Whether the issue is already disclosed.
- Suggested remediation.

Do not include:

- Mainnet exploit instructions.
- Private keys, secrets, or third-party account data.
- Live attacks against deployed demo services.

## Triage Process

Maintainers should triage daily during the review window:

1. Acknowledge receipt.
2. Classify severity using [`bug-bounty-2026-06.md`](./bug-bounty-2026-06.md).
3. Mark as duplicate, accepted, needs information, invalid, or already disclosed.
4. Add accepted findings to the relevant audit document.
5. Patch and add regression evidence.
6. Publish a closing report after the review window.

## Closing Report

After the review period, publish a short closing report with:

- Review dates and commit hash.
- Number of reports received.
- Accepted findings by severity.
- Fixed findings and retest evidence.
- Rejected/duplicate findings summary.
- Remaining open blockers.
- Updated production-readiness verdict.
