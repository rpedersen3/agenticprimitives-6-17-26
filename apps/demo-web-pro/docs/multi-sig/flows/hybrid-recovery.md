# Use case 1 — Individual user, seamless recovery

> **Status:** live baseline. The route deploys a `hybrid` account via `createAccountWithMode`, previews the deterministic address, accepts guardian chips, parses the deployment event, and prompts a backup passkey next step.

Maps to spec 207 § 4.1 use case #1. User creates a `single`-mode
account, then the very next step prompts: *"Add a backup so you don't
lose your agent account."* Adding a backup passkey flips the account
into `hybrid` mode. Low-risk actions stay 1-of-N; admin + recovery
actions become threshold.

This walkthrough will cover:

1. Creating an account with a single primary passkey.
2. The frontend's "add backup" prompt + the EIP-6963 / WebAuthn dance.
3. The `addPasskey` admin action (T4 in `hybrid` mode — 1-of-1 on the
   primary; later 2-of-N when more backups exist).
4. The mode-flip from `single` to `hybrid` (`AdminAction.ChangeMode`).
5. Verifying the recovery threshold is sane (≥ 1 guardian OR ≥ 2
   passkeys per spec § 8).

Code: `apps/demo-web-pro/src/flows/hybrid-recovery/`.
