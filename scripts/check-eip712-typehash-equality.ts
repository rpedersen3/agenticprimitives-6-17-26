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

console.log('[eip712-typehash-equality] running cross-stack typehash invariant test…');

try {
  execSync(
    'pnpm --filter @agenticprimitives/delegation exec vitest run test/integration/cross-stack-typehashes.test.ts',
    { stdio: 'inherit' },
  );
  console.log('[eip712-typehash-equality] ✓ TS-side typehashes equal Solidity-side constants.');
} catch {
  console.error(
    '[eip712-typehash-equality] ✗ FAILED.\n\n' +
      'Cross-stack EIP-712 typehash drift detected. The off-chain delegation\n' +
      "computation (`packages/delegation/src/hash.ts::DELEGATION_EIP712_TYPES`)\n" +
      'no longer matches the Solidity-side `DELEGATION_TYPEHASH` constant.\n\n' +
      'Causes (most likely):\n' +
      "  - Solidity-side EIP712 type string was edited without updating the TS types\n" +
      '  - TS-side DELEGATION_EIP712_TYPES was edited without updating the contract\n' +
      '  - A new field was added on one side only\n\n' +
      'The two sides MUST converge before publish — a mismatch ships a silently\n' +
      'broken delegation flow. The full test file at\n' +
      '  packages/delegation/test/integration/cross-stack-typehashes.test.ts\n' +
      'documents what each constant represents and how viem encodes them.',
  );
  process.exit(1);
}
