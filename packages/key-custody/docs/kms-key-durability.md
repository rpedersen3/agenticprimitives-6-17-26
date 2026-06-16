# KMS key-durability runbook

**Audience:** operators wiring `key-custody` with a managed KMS backend (GCP-KMS / AWS-KMS / Azure Key Vault / HSM) for a production deployment.

**Why this doc exists:** the package gives you the primitives (`A2AKeyProvider`, `KmsAccountBackend`, MAC providers). It does NOT make policy decisions about key durability — those are operator decisions with multi-year consequences. This runbook documents the load-bearing decisions you MUST make BEFORE the first real-value session encrypts anything, and the failure modes you're signing up for if you skip them.

---

## The single hardest fact

> If you lose your master encrypt key, every envelope-encrypted session at rest is **permanently unrecoverable**. Not "hard to recover." Not "needs forensic work." Unrecoverable — that's the property the encryption gives you.

Plan as if the key WILL eventually become unavailable. The rest of this doc is about bounding the blast radius when it does.

---

## Three distinct keys (don't conflate them)

Per the `@agenticprimitives/key-custody` security invariants (see [CLAUDE.md](../CLAUDE.md) → "Master-key separation"), three IAM-isolated KMS keys exist:

| Key | Used by | Lose this → |
| --- | --- | --- |
| **Master signer key** | Bundler relayer, paymaster envelope signer. `LocalSecp256k1Signer` (dev) / `GcpKmsSigner` (prod). (`AwsKmsSigner` is not yet implemented — R11.3.) | Cannot submit new userOps; cannot sign paymaster envelopes. Existing on-chain state survives; UX halts. |
| **Session data-key wrap key** | Envelope encryption for session keypairs at rest. `LocalAesProvider.generateSessionDataKey` / `GcpKmsProvider`. | Every in-flight session is dead; users must re-authenticate; existing delegations remain valid (they're standalone signed artifacts). |
| **Service-MAC key** | HMAC between a2a-worker → mcp-worker (audit C1). `buildMacProvider`. | All a2a→mcp calls 401 until rotated. Recoverable in minutes; no data loss. |

The three keys MUST live in distinct IAM scopes. A single principal that can use both the signer key AND the wrap key can decrypt sessions AND sign as the bundler — gives them a forgery path. This is enforced at deploy time by the boot check.

---

## Decisions you must make BEFORE first production traffic

### 1. Backup-key strategy for the session data-key wrap

The wrap key is the highest-blast-radius key (loss = all sessions dead). You have three credible options:

**Option A: HA-replicated single key (recommended for managed-KMS deploys).**
- GCP-KMS: `protection_level = HSM`, `algorithm = GOOGLE_SYMMETRIC_ENCRYPTION`, multi-regional location (e.g., `us` or `europe`).
- AWS-KMS: `Origin = AWS_KMS`, multi-region key (`MultiRegion = true`), replicas in ≥ 2 regions.
- Azure: HSM-backed key vault with geo-redundant SKU.
- **Pro:** simple; one key id everywhere; rotation via KMS-native primitives.
- **Con:** if your KMS account is compromised at the project level, attacker has all replicas. Mitigate with KMS audit logging + alert on `Decrypt` rate anomalies.

**Option B: Two-of-three key shares (Shamir-style).**
- Generate three independent KMS keys in three independent cloud accounts / clouds.
- Wrap the actual encrypt key with a 2-of-3 Shamir split; store one share in each KMS.
- `generateSessionDataKey` reassembles on-demand by fetching any 2 shares.
- **Pro:** survives any single cloud/account compromise. Survives any single cloud outage.
- **Con:** operationally complex; rotation requires coordinated 3-party action; latency budget doubles.
- **When to pick:** real-value workloads where session compromise = > $100K liability per user.

**Option C: KMS + offline cold backup (Yubikey / paper / HSM-in-safe).**
- KMS holds the active wrap key.
- An offline copy lives in a tamper-evident safe (e.g., Yubikey-stored or paper-printed key share).
- Quarterly drill: rotate, verify the offline copy can decrypt a known-old session.
- **Pro:** survives total KMS-provider outage.
- **Con:** offline copy IS a liability; physical security required; doesn't survive a "the building burned" event without geographic redundancy of the cold backup too.

If you don't pick one of these before going live, you've defaulted to "if KMS loses my key I'm done." That's a business decision; make it deliberately.

### 2. Rotation cadence

- **Master signer key:** rotate every 90 days. Old version stays valid for already-mined txs (signatures are immutable); new version signs new userOps.
- **Session data-key wrap:** rotate every 90 days. Old version stays valid for already-encrypted sessions until they're decrypted-and-re-wrapped on next access. After 12 months without access, treat the session as cold storage; either re-wrap during a maintenance window or accept that sessions older than 12 months may be unrecoverable if the old key version is destroyed.
- **Service-MAC:** rotate every 30 days. Overlapping-version support (active + standby) means zero-downtime rotation; both workers should accept either key-id during the rotation window.

### 3. Destruction policy

KMS providers offer "schedule destruction" with a grace period (GCP: 24h–30d; AWS: 7–30d). USE THE LONGEST GRACE PERIOD AVAILABLE. A scheduled-destruction event is a recoverable mistake; an actually-destroyed key is not.

### 4. Quorum for sensitive KMS operations

GCP-KMS: do NOT use IAM roles that grant `cloudkms.cryptoKeys.destroy` or `cloudkms.cryptoKeyVersions.update` to any single human. Require a 2-of-N approval workflow (e.g., a CI pipeline that requires two engineer sign-offs to run the destroy command).

AWS-KMS: equivalent via SCP + multi-party approval CloudFormation stacks.

---

## Drills you must run BEFORE first production traffic

### Drill 1: "the active wrap key is destroyed" — restore from backup

1. Encrypt a known-test session.
2. Schedule the active wrap key for destruction (do NOT actually destroy — schedule).
3. Follow your backup-key restore runbook to recover the wrap key into a new key-id.
4. Reconfigure `key-custody` to use the new key-id.
5. Verify the test session decrypts.
6. Cancel the scheduled destruction.

Run quarterly. If you can't do this in under 4 hours, your runbook isn't real.

### Drill 2: "service-MAC key rotation under load"

1. Generate a new MAC key-id; deploy to both workers with old key-id still active.
2. Verify both new and old key-id traffic flows.
3. Cut over the active default to the new key-id.
4. Wait 24h with both still accepted.
5. Remove the old key-id from both workers.
6. Confirm zero auth failures during the window.

Run every 30 days during the rotation cadence.

### Drill 3: "master signer key compromise"

1. Identify the leaked key-id.
2. Disable in KMS (do NOT destroy — keep audit trail).
3. Provision new signer key.
4. Sweep any in-flight userOps that used the old signer.
5. Rotate `paymaster.verifyingSigner()` on chain via the governance path (this is a separate process — costs gas, takes a confirmation cycle).
6. Audit log: every signature emitted by the old key for at least 30 days back. Look for unauthorized ops.

Run as a fire-drill quarterly. If you don't have a working sweep tool, build it before going live.

---

## What this package DOES enforce at runtime

The boot check (`assertLocalProviderAllowedInProduction` in `providers/local.ts`) refuses to start with the local-aes provider in production unless an opt-in env var is set, and emits a one-time warn when the opt-in is used. This is a backstop against "we forgot to configure KMS before deploy"; it is NOT a substitute for the above runbook decisions.

The MAC primitive is intentionally NOT gated (HMAC over a wrangler-secret is a legitimate production pattern for service-to-service auth). Encryption primitives ARE gated.

---

## What this package does NOT enforce

- Backup-key existence (decision: yours)
- Rotation cadence (operational: yours)
- IAM scoping between the three keys (boot check on key-id matching; doesn't verify IAM policy itself)
- Cross-region replication (yours)
- Audit-log retention (the audit emissions are durable IF you wire a durable `AuditSink`; that's outside this package)

---

## Recommended pre-launch checklist

- [ ] Three distinct KMS keys provisioned (master signer / data-key wrap / service-MAC).
- [ ] IAM scoped so no single principal can use both signer + wrap.
- [ ] Backup-key strategy selected from {A, B, C} above and documented.
- [ ] Rotation cadence documented and at least one rotation rehearsed end-to-end.
- [ ] Drill 1 (key-destruction recovery) successfully completed in under 4 hours.
- [ ] Drill 2 (MAC rotation) successfully completed.
- [ ] Drill 3 (signer compromise response) runbook written + dry-run.
- [ ] KMS audit logging enabled + alerting wired (`Decrypt` rate anomaly + any `Destroy` event).
- [ ] `A2A_ALLOW_LOCAL_MASTER_KEY` and `A2A_ALLOW_LOCAL_ENVELOPE_KEY` env vars confirmed UNSET in production.

Until every box is ticked, you do not yet have a production-ready key-custody deployment. The package itself can't tell you that — the runbook is the load-bearing artifact.
