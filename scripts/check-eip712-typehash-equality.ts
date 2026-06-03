/**
 * check-eip712-typehash-equality.ts
 *
 * R10 P0.3 / R11.4 — surface the existing cross-stack EIP-712 typehash
 * equality test as a top-level CI gate that release / publish workflows
 * can require by name.
 *
 * The TEST already exists at
 *   `packages/delegation/test/integration/cross-stack-typehashes.test.ts`
 * (H7-D.9 / R1 closure 2026-05-30). It runs as part of the regular
 * vitest suite. The R10 audit-readiness ask was: make it CALLABLE BY
 * NAME from the release workflow so an external reviewer can find it
 * without grepping the test corpus.
 *
 * Why this matters: off-chain `@agenticprimitives/delegation` and
 * `@agenticprimitives/account-custody` compute typehashes that MUST
 * equal the Solidity-side constants. Drift = mismatched signed
 * digests = either denial-of-service or, worse, accepted-but-wrong
 * authority chain. The substrate-level test catches this; the gate
 * makes the catch a pre-publish requirement.
 *
 * Usage:
 *   pnpm check:eip712-typehash-equality
 *   # equivalent to:
 *   pnpm --filter @agenticprimitives/delegation test -- \
 *     test/integration/cross-stack-typehashes.test.ts
 */

import { execSync } from 'node:child_process';

// Each entry: a TS package + the cross-stack typehash test that reads the LIVE
// Solidity source and asserts byte-equality with the off-chain constant.
//   - delegation: DELEGATION_TYPEHASH / CAVEAT_TYPEHASH ↔ DelegationManager.sol
//   - agreements: TRANSITION_TYPEHASH ↔ AgreementRegistry.sol (RW1-3 / ADR-0027)
const SUITES: ReadonlyArray<{ pkg: string; test: string }> = [
  {
    pkg: '@agenticprimitives/delegation',
    test: 'test/integration/cross-stack-typehashes.test.ts',
  },
  {
    pkg: '@agenticprimitives/agreements',
    test: 'test/unit/cross-stack-transition-typehash.test.ts',
  },
  {
    pkg: '@agenticprimitives/attestations',
    test: 'test/unit/cross-stack-consent-typehash.test.ts',
  },
];

console.log('[eip712-typehash-equality] running cross-stack typehash invariant tests…');

try {
  for (const { pkg, test } of SUITES) {
    console.log(`[eip712-typehash-equality]   ${pkg} → ${test}`);
    execSync(`pnpm --filter ${pkg} exec vitest run ${test}`, { stdio: 'inherit' });
  }
  console.log('[eip712-typehash-equality] ✓ TS-side typehashes equal Solidity-side constants.');
} catch {
  console.error(
    '[eip712-typehash-equality] ✗ FAILED.\n\n' +
      'Cross-stack EIP-712 typehash drift detected. An off-chain typehash\n' +
      'computation no longer matches its Solidity-side constant:\n' +
      "  - delegation: `packages/delegation/src/hash.ts::DELEGATION_EIP712_TYPES`\n" +
      '      ↔ `DelegationManager.sol::DELEGATION_TYPEHASH` / `CAVEAT_TYPEHASH`\n' +
      "  - agreements: `packages/agreements/src/index.ts::TRANSITION_TYPEHASH`\n" +
      '      ↔ `AgreementRegistry.sol::TRANSITION_TYPEHASH` (RW1-3)\n' +
      "  - attestations: `packages/attestations/src/index.ts::JOINT_CONSENT_TYPEHASH`\n" +
      '      ↔ `AttestationRegistry.sol::JOINT_CONSENT_TYPEHASH` (RW1-1)\n\n' +
      'Causes (most likely):\n' +
      "  - A Solidity-side EIP-712 type string was edited without updating the TS side\n" +
      '  - A TS-side typehash/type set was edited without updating the contract\n' +
      '  - A new field was added on one side only\n\n' +
      'The two sides MUST converge before publish — a mismatch ships a silently\n' +
      'broken signing flow (DoS, or accepted-but-wrong authority). The test files\n' +
      'document what each constant represents and how viem encodes them.',
  );
  process.exit(1);
}
