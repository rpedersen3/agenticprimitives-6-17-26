// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title UniversalSignatureValidator
 * @notice Universal ERC-1271 / ERC-6492 / ECDSA signature verifier.
 *
 *   Accepts three signature shapes — the caller never needs to know which:
 *     1. Plain EOA signature (65 bytes) — ECDSA.recover, supports both raw
 *        and eth-signed-message hash forms.
 *     2. ERC-1271 signature — `signer` already has code; the verifier
 *        invokes `IERC1271(signer).isValidSignature(hash, sig)` and checks
 *        for the magic value (0x1626ba7e).
 *     3. ERC-6492 signature — `sig` ends with the 32-byte magic
 *        0x6492…6492. The prefix is `abi.encode(factory, factoryCalldata,
 *        innerSig)`. If `signer` has no code, the verifier deploys it via
 *        `factory.call(factoryCalldata)` and then recurses into ERC-1271
 *        verification with `innerSig`.
 *
 *   Matches the reference `UniversalSigValidator` in the ERC-6492 spec.
 *   Ported from smart-agent `packages/contracts/src/UniversalSignatureValidator.sol`
 *   (branch 003-intent-marketplace-proposal); kept byte-compatible.
 *
 *   Two entry points:
 *     - `isValidSig`     — state-changing; the 6492 path may deploy.
 *     - `isValidSigView` — view-only; safe to call from static contexts but
 *                          cannot perform 6492 deploys (returns false in
 *                          that case unless the account already has code).
 *
 *   Doctrine: per spec 130 §7 and feedback memory
 *   "demo-a2a is signer-agnostic", the demo-a2a server verifies user
 *   signatures by calling THIS contract, never by parsing the signature
 *   bytes itself. Passkey vs EOA vs anything else is decided here on-chain.
 */
contract UniversalSignatureValidator {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    /// @dev 32-byte ERC-6492 magic suffix — `0x6492…6492` repeated.
    bytes32 private constant ERC6492_MAGIC =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    error DeployFailed();

    /// @notice State-changing verifier: counterfactually deploys the
    ///         signer's account if it isn't deployed yet, then validates
    ///         via ERC-1271. Use from a call that can mutate state
    ///         (relayer pre-flight, demo-a2a's siwe-verify endpoint).
    function isValidSig(
        address signer,
        bytes32 hash,
        bytes calldata sig
    ) external returns (bool) {
        if (_has6492Magic(sig)) {
            (address factory, bytes memory factoryCalldata, bytes memory innerSig) =
                _decode6492(sig[:sig.length - 32]);
            if (signer.code.length == 0) {
                (bool ok, ) = factory.call(factoryCalldata);
                if (!ok || signer.code.length == 0) revert DeployFailed();
            }
            return _erc1271(signer, hash, innerSig);
        }
        if (signer.code.length > 0) {
            return _erc1271(signer, hash, sig);
        }
        return _ecdsaRecover(signer, hash, sig);
    }

    /// @notice View-only verifier — skips 6492 deploy (cannot mutate
    ///         state). Returns false if a 6492-wrapped sig is presented
    ///         and the account isn't already deployed.
    function isValidSigView(
        address signer,
        bytes32 hash,
        bytes calldata sig
    ) external view returns (bool) {
        if (_has6492Magic(sig)) {
            (, , bytes memory innerSig) = _decode6492(sig[:sig.length - 32]);
            if (signer.code.length == 0) return false;
            return _erc1271(signer, hash, innerSig);
        }
        if (signer.code.length > 0) {
            return _erc1271(signer, hash, sig);
        }
        return _ecdsaRecover(signer, hash, sig);
    }

    // ─── Internals ───────────────────────────────────────────────────

    function _has6492Magic(bytes calldata sig) private pure returns (bool) {
        if (sig.length < 32) return false;
        return bytes32(sig[sig.length - 32:]) == ERC6492_MAGIC;
    }

    function _decode6492(bytes calldata prefix)
        private
        pure
        returns (address factory, bytes memory factoryCalldata, bytes memory innerSig)
    {
        (factory, factoryCalldata, innerSig) =
            abi.decode(prefix, (address, bytes, bytes));
    }

    function _erc1271(
        address signer,
        bytes32 hash,
        bytes memory sig
    ) private view returns (bool) {
        try IERC1271(signer).isValidSignature(hash, sig) returns (bytes4 mv) {
            return mv == ERC1271_MAGIC;
        } catch {
            return false;
        }
    }

    function _ecdsaRecover(
        address signer,
        bytes32 hash,
        bytes memory sig
    ) private pure returns (bool) {
        if (sig.length != 65) return false;
        // Try raw hash first.
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        // Then try the eth-signed prefix variant — many wallets sign this
        // form even when the caller passes a raw digest.
        bytes32 prefixed = hash.toEthSignedMessageHash();
        (recovered, err, ) = ECDSA.tryRecover(prefixed, sig);
        return err == ECDSA.RecoverError.NoError && recovered == signer;
    }
}
