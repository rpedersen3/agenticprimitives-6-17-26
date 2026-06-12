// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title MockUSDC
 * @notice Test USDC for the Base Sepolia x402 demos (spec 272, PAY-CON-3). 6 decimals, open mint +
 *         faucet, and full EIP-3009 (`transferWithAuthorization` / `receiveWithAuthorization` /
 *         `cancelAuthorization` / `authorizationState`) so the Wave-5 Coinbase-x402 interop adapter
 *         is a no-redeploy add (X402-D2 / PAY-WIRE-4).
 *
 * @dev    DEV-ONLY: `mint`/`faucet` are open. NEVER a production asset. Wave-1 settlement is
 *         delegation-native (the {PaymentEnforcer}-gated `transfer`), so EIP-3009 is present but
 *         unused until Wave 5; shipping it now avoids a token redeploy.
 */
contract MockUSDC is ERC20 {
    using ECDSA for bytes32;

    // EIP-3009 type hashes
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    /// @notice EIP-3009: authorizer => nonce => used-or-canceled.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthNotYetValid();
    error AuthExpired();
    error AuthUsedOrCanceled();
    error InvalidSignature();
    error CallerMustBePayee();

    constructor() ERC20("Mock USD Coin", "USDC") {
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ── dev faucet ──
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    // ── EIP-3009 ──

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _CACHED_CHAIN_ID ? _CACHED_DOMAIN_SEPARATOR : _computeDomainSeparator();
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);
        _verify(
            from,
            keccak256(
                abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
            ),
            signature
        );
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _requireValidAuthorization(from, nonce, validAfter, validBefore);
        _verify(
            from,
            keccak256(
                abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
            ),
            signature
        );
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, bytes calldata signature) external {
        if (authorizationState[authorizer][nonce]) revert AuthUsedOrCanceled();
        _verify(authorizer, keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)), signature);
        authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    // ── internals ──

    function _requireValidAuthorization(address from, bytes32 nonce, uint256 validAfter, uint256 validBefore)
        private
        view
    {
        if (block.timestamp <= validAfter) revert AuthNotYetValid();
        if (block.timestamp >= validBefore) revert AuthExpired();
        if (authorizationState[from][nonce]) revert AuthUsedOrCanceled();
    }

    function _markAuthorizationUsed(address from, bytes32 nonce) private {
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }

    function _verify(address signer, bytes32 structHash, bytes calldata signature) private view {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (digest.recover(signature) != signer) revert InvalidSignature();
    }

    function _computeDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Mock USD Coin")),
                keccak256(bytes("2")),
                block.chainid,
                address(this)
            )
        );
    }
}
