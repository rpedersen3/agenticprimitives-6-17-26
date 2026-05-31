// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title P256Verifier
 * @notice Dispatcher for P-256 (secp256r1) signature verification.
 *
 *         **H7-C.2 / CON-P256-001 closure.** Previously this library
 *         silently fell through to the Daimo P256Verifier at the hardcoded
 *         address `0xc2b78104907F722DABAc4C69f826a522B2754De4` when the
 *         RIP-7212 precompile was absent. Two problems:
 *
 *           1. `try fast catch slow` pattern — direct ADR-0013 violation
 *              (one mechanism per security path; an attacker squatting that
 *              address on a fork made the on-chain verifier accept whatever
 *              the malicious contract returned).
 *           2. Un-version-pinned third-party dependency — if Daimo's
 *              upgrade keys (or address) ever change, every account on
 *              every chain that fell back becomes compromised in lockstep.
 *
 *         This library now uses **RIP-7212 only**. Chains without the
 *         precompile (e.g. pre-Pectra Ethereum mainnet) cannot use this
 *         verifier and MUST wire a separate, explicitly configured
 *         pure-Solidity P-256 verifier at the consumer layer. That config
 *         is intentionally NOT in this library — a hardcoded fallback in
 *         a security primitive is the exact pattern the audit rejected.
 *
 *         Live deployments at the time of H7-C.2:
 *           - Base / Base Sepolia       ✓ RIP-7212 native
 *           - Polygon zkEVM             ✓
 *           - Optimism (post-Granite)   ✓
 *           - Scroll, Linea             ✓
 *           - Anvil (with --odyssey)    ✓
 *           - Ethereum mainnet          ✗ (until Pectra activates RIP-7212)
 *
 *         Input layout: msgHash(32) || r(32) || s(32) || x(32) || y(32)
 *         Output: bool — true iff the signature verifies.
 */
library P256Verifier {
    address internal constant RIP7212_PRECOMPILE = address(0x100);

    function verify(bytes32 hash, uint256 r, uint256 s, uint256 x, uint256 y) internal view returns (bool) {
        bytes memory input = abi.encodePacked(hash, r, s, x, y);
        (bool ok, bytes memory out) = RIP7212_PRECOMPILE.staticcall(input);
        return ok && out.length >= 32 && uint256(bytes32(out)) == 1;
    }
}
