# Open Review Bug Bounty Terms — June 2026

| Field | Value |
|---|---|
| Status | Draft terms for public open review |
| Program type | Small community bounty / open review |
| Related packet | [`self-audit-2026-06.md`](./self-audit-2026-06.md) |
| Review instructions | [`open-review-2026-06.md`](./open-review-2026-06.md) |

## Important Note

These terms are intended for a low-cost public review period before a paid firm audit or public contest. They are not a replacement for a professional audit.

If no bounty pool has been funded, treat these terms as the recommended bounty structure to publish once funding is approved.

## Eligible Findings

Eligible findings must affect an in-scope package, contract, or demo authority path and must not be already disclosed in the self-audit packet.

Examples:

- Unauthorized account control, custody mutation, or upgrade.
- Incorrect ERC-1271 or EIP-712 signature verification.
- Delegation/caveat bypass.
- Paymaster abuse that drains sponsored funds beyond documented limits.
- Recovery/custody quorum bypass.
- WebAuthn/P-256 verification bypass.
- Naming registry authorization bypass.
- Private vault or PII disclosure beyond granted scope.
- Audit-durability gaps that let security-critical signing/minting succeed without required evidence.

## Ineligible Findings

Ineligible:

- Already disclosed findings unless the report proves higher impact.
- Attacks requiring leaked testnet demo keys where the leak is the disclosed precondition.
- Pure testnet griefing without authority, privacy, or fund impact.
- UI copy, layout, or accessibility issues without security impact.
- Spam/rate-limit issues without a plausible resource-exhaustion path.
- Vulnerabilities in third-party services unless caused by this repo's integration.
- Reports generated only by automated tools without exploitability analysis.

## Severity Guide

| Severity | Description |
|---|---|
| Critical | Direct unauthorized control of Smart Agents, custody/recovery bypass, arbitrary upgrade/admin execution, or theft/drain of protected funds in a production-equivalent configuration. |
| High | Delegation or caveat bypass, material private data disclosure, signer/key misuse, governance/paymaster abuse, or issue that blocks safe external pilots. |
| Medium | Security invariant not enforced under realistic but bounded conditions, privacy leakage with limited impact, important CI/evidence gap, or denial of service against a critical workflow. |
| Low | Hardening issue, documentation drift with limited security effect, weak error handling, or defense-in-depth gap. |

## Suggested Rewards

Set final amounts before launch. Suggested low-cost ranges:

| Severity | Suggested reward |
|---|---:|
| Critical | $1,000-$2,500 |
| High | $250-$1,000 |
| Medium | $50-$250 |
| Low | Acknowledgment / swag / discretionary |

If the bounty is unfunded, publish this as an open-review acknowledgment program and clearly say that rewards are discretionary.

## Disclosure Rules

- Report critical/high findings privately first.
- Allow maintainers time to triage and remediate before public disclosure.
- Do not exploit live services beyond the minimum proof needed.
- Do not access, modify, or exfiltrate real user data.
- Do not publish working exploit code for active critical/high findings before remediation.

## Report Template

```markdown
## Summary

## Severity

## Affected files/contracts

## Preconditions

## Reproduction or proof sketch

## Impact

## Suggested remediation

## Is this already disclosed?
```

## Triage Outcomes

Each report receives one outcome:

- Accepted
- Duplicate
- Already disclosed
- Informational
- Needs more information
- Not applicable / out of scope

Accepted findings should be tracked in [`product-readiness-audit.md`](../architecture/product-readiness-audit.md) or the relevant package `AUDIT.md`, then closed only after a fix and regression evidence land.
