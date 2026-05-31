# Post-deploy governance handoff (H7-C.9 / EXT3-009)

When `script/Deploy.s.sol` lands, the system is in a **bootstrap** state:

- `TimelockController(24h)` — proposers = `[deployer]`, executors = `[deployer]`, admin = `deployer`.
- `AgenticGovernance` — guardian = `deployer`, initial signers = `[deployer]`.
- Every `GovernanceManaged` contract (Factory, Paymaster, DelegationManager via the pause hook) sees `AgenticGovernance` as its `governance`.

This bootstrap state is INTENDED FOR THE DEPLOY WINDOW ONLY. Before the system handles real value, the operator MUST run the **handoff sequence** below.

## Step 0 — Production deploy preflight (mandatory)

```bash
pnpm check:production-deploy
```

Closes CON-PAYMASTER-001 / CON-FACTORY-001: refuses to mark the deployment "live" while `governance` is an EOA, or while `deployer` is still in the timelock proposer/executor sets.

## Step 1 — Deploy the long-lived governance multisig

Per the CLAUDE.md hard rule ("no third-party multi-sig"), the multisig is an `AgentAccount` deployed by the factory whose `CustodyPolicy` requires M-of-N custodians:

```ts
// e.g., 3-of-5 multisig
const params: AgentAccountInitParams = {
  mode: 2, // threshold
  custodians: [keyA, keyB, keyC, keyD, keyE],
  trustees: [],
  initialPasskeyCredentialIdDigest: zeroBytes32,
  initialPasskeyX: 0n,
  initialPasskeyY: 0n,
  initialPasskeyRpIdHash: zeroBytes32,
};
const tl: [number, number, number, number, number, number, number] =
  [0, 0, 0, 0, 24 * 3600, 24 * 3600, 48 * 3600]; // T4 24h, T5 24h, T6 48h

const govMultisig = await factory.write.createAgentAccount([params, tl, GOV_SALT]);
```

Approvals for the threshold (3-of-5) are configured via the CustodyPolicy install-data. Custodians M of N must sign every governance proposal before the timelock will accept it.

## Step 2 — Wire the multisig into the timelock

```ts
const PROPOSER_ROLE = await timelock.read.PROPOSER_ROLE();
const EXECUTOR_ROLE = await timelock.read.EXECUTOR_ROLE();

// Grant the new multisig
await timelock.write.grantRole([PROPOSER_ROLE, govMultisig]);
await timelock.write.grantRole([EXECUTOR_ROLE, govMultisig]);

// Revoke deployer
await timelock.write.revokeRole([PROPOSER_ROLE, deployer]);
await timelock.write.revokeRole([EXECUTOR_ROLE, deployer]);
```

After this, ONLY the multisig can schedule + execute timelocked governance ops.

## Step 3 — Rotate the guardian

The guardian role (fast-path emergency pause) is held by the deployer at bootstrap. Replace with a guardian-only key (kept off-line; only retrieved to pause during an incident). Pause-only authority is by design — the guardian CANNOT unpause without the timelock.

```solidity
// Through the timelock: schedule + 24h + execute
gov.execute(
  address(governance),
  abi.encodeWithSignature("...", productionGuardian), // requires AgenticGovernance.setGuardian — see C9 follow-up
  0
);
```

> **Open item:** AgenticGovernance v1 sets `guardian` as immutable. Rotation requires redeploying AgenticGovernance + transferring every GovernanceManaged contract's pointer. A "soft" guardian rotation (without redeploy) is a v2 enhancement (write `mapping(address => bool) guardians` instead of `immutable address guardian`). Track as follow-up.

## Step 4 — Renounce timelock admin

```ts
const TIMELOCK_ADMIN_ROLE = await timelock.read.TIMELOCK_ADMIN_ROLE();
await timelock.write.renounceRole([TIMELOCK_ADMIN_ROLE, deployer]);
```

After this the timelock is permanently sealed — no entity can grant roles outside of governance-scheduled actions.

## Step 5 — Document the handoff

Update `packages/contracts/deployments-<network>.json` with:

```jsonc
{
  // … existing addresses …
  "governance": "0x…",        // AgenticGovernance
  "timelock":   "0x…",        // TimelockController
  "govMultisig": "0x…",       // AgentAccount that proposes + executes
  "guardian": "0x…",          // Pause-only role
  "handoffComplete": true,    // Set by Step 4
  "handoffSha": "0x…",        // git SHA at handoff
  "handoffTimestamp": 1700000000
}
```

## Incident-mode (post-handoff)

| Scenario | Lever |
|---|---|
| Active exploit in progress | Guardian calls `gov.pause()` (no delay). All `whenNotPaused` write surfaces freeze. |
| Confirmed exploit; investigation done | Governance proposes `gov.unpause()` → 24h timelock → multisig 3-of-5 executes. |
| Need to rotate paymaster signing key | Governance proposes `gov.execute(paymaster, setVerifyingSigner(newSigner))` → 24h → execute. |
| Need to upgrade factory governance role | Redeploy factory. (Governance is immutable per spec.) |

## Acceptance for "production-ready" status

- [x] AgenticGovernance + TimelockController deployed (Deploy.s.sol).
- [x] Factory + Paymaster + DelegationManager all gated by `whenNotPaused`.
- [ ] **Step 1**: Multisig AA deployed with custodian set + threshold.
- [ ] **Step 2**: Timelock proposer/executor switched to multisig.
- [ ] **Step 3**: Guardian rotated (or accepted as deployer = guardian risk).
- [ ] **Step 4**: Deployer renounced timelock admin.
- [ ] **Step 5**: `deployments-<network>.json` updated with `handoffComplete: true`.
- [ ] `pnpm check:production-deploy` exits 0.

Until every checkbox above is ticked, the deployment is "testnet-grade" — DO NOT route real-value traffic.
