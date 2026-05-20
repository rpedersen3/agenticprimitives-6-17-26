# Use case 5 — Lost device recovery

> **Status:** stub. Implementation lands in phase 6c.2-e (T6
> Recovery flow) + 6c.5 (frontend) + phase 7 (recovery UX panel).

Maps to spec 207 § 4.1 use case #5. User loses laptop passkey, signs
in with phone passkey. Initiates `T6 Recovery` proposing removal of
the lost passkey + (optional) addition of a new one. Requires
guardian quorum + 48h timelock + 24h primary-owner cancel window.

This walkthrough will cover:

1. The user-facing trigger: "I lost a device."
2. Building the recovery proposal (`AdminAction` not yet defined —
   recovery has its own propose / execute / cancel triple per
   spec 207 § 8; lands in 6c.2-e).
3. Guardian quorum collection (`v=1` pre-approved-hash path for
   passkey-only guardians; `v=27/28` ECDSA for EOA guardians).
4. The 48h timelock + 24h primary-owner cancel window.
5. The "recovery wins" precedence rule: a T6 recovery executing
   invalidates any in-flight T5 admin proposal (spec § 9 row 13).

Code: `apps/demo-web-pro/src/flows/recovery/` (lands post-6c.2-e).
