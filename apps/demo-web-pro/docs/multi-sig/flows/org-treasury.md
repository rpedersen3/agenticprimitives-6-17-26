# Use case 3 — Org treasury

> **Status:** stub. Implementation lands in phase 6c.5 (`org` mode
> frontend) + phase 6e (treasury contract + caveats) + phase 7
> (admin panel UX).

Maps to spec 207 § 4.1 use case #3. Org creates an `org`-mode
account with 3 admins. Threshold: 2-of-3 for treasury actions;
3-of-3 for trust-root changes. Agent drafts payments (propose) but
cannot execute without threshold approval. Low-risk reads stay
1-of-N. Enterprise-style separation of duties on T5 actions.

This walkthrough will cover:

1. Deploying an `org`-mode account with 3 owners + 3 guardians.
2. Threshold defaults (2-of-3 routine, 3-of-3 trust-root, 2-of-3
   recovery via guardians).
3. Proposing a treasury withdraw → other admins approve → agent
   executes.
4. Separation-of-duties enforcement on T5 admin actions (the same
   admin can't both propose and execute).
5. The audit trail: every propose / approve / execute / cancel
   visible by correlation ID.

Code: `apps/demo-web-pro/src/flows/org-treasury/` (lands with 6c.5
+ 6e).
