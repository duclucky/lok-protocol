/* solhint-disable one-contract-per-file, use-natspec, immutable-vars-naming */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

// Test-only harnesses stay together so the probe remains a single disposable artifact.

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

interface IProbeAssetSource {
    function confidentialAssetBalance() external returns (euint64);
}

/// @dev Test-only ERC-7984 harness used to create real encrypted balance handles.
contract ProbeERC7984 is ZamaEthereumConfig, ERC7984 {
    constructor() ERC7984("Lok Probe cUSDC", "pcUSDC", "") {}

    function mint(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        return _mint(to, FHE.fromExternal(encryptedAmount, inputProof));
    }
}

/// @dev Adapter-like source that proves a balance handle needs an explicit cross-contract ACL handoff.
contract ProbeAssetSource is ZamaEthereumConfig, IProbeAssetSource {
    IERC7984 public immutable token;
    bool public immutable grantAccess;

    constructor(IERC7984 token_, bool grantAccess_) {
        token = token_;
        grantAccess = grantAccess_;
    }

    function confidentialAssetBalance() external returns (euint64 balance) {
        balance = token.confidentialBalanceOf(address(this));
        if (grantAccess) {
            FHE.allowTransient(balance, msg.sender);
        }
    }
}

/// @dev Non-production probe for aggregate solvency public decryption and proof binding.
contract SolvencyCheckpointProbe is ZamaEthereumConfig {
    error InvalidCleartextLength(uint256 actual);
    error NoPendingCheckpoint();
    error Unauthorized(address caller);
    error WrongEpoch(uint64 expected, uint64 actual);
    error WrongNonce(uint64 expected, uint64 actual);

    event CheckpointOpened(uint64 indexed epoch, uint64 indexed nonce, bytes32 indexed handle);
    event CheckpointSubmitted(uint64 indexed epoch, uint64 indexed nonce, bool indexed isSolvent);

    IProbeAssetSource public immutable assetSource;
    address public immutable admin;

    uint64 public riskEpoch;
    uint64 public pendingEpoch;
    uint64 public pendingNonce;
    bytes32 public pendingHandle;
    bool public hasPending;

    uint64 public lastSubmittedEpoch;
    bool public lastResult;

    euint64 private _liability;

    constructor(IProbeAssetSource assetSource_) {
        assetSource = assetSource_;
        admin = msg.sender;
    }

    function setLiability(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        _liability = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(_liability);
    }

    function setRiskEpoch(uint64 epoch) external {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        riskEpoch = epoch;
    }

    function openCheckpoint(uint64 epoch) external {
        if (epoch != riskEpoch) revert WrongEpoch(riskEpoch, epoch);

        euint64 assets = assetSource.confidentialAssetBalance();
        ebool isSolvent = FHE.ge(assets, _liability);
        FHE.allowThis(isSolvent);
        FHE.makePubliclyDecryptable(isSolvent);

        pendingEpoch = epoch;
        ++pendingNonce;
        pendingHandle = FHE.toBytes32(isSolvent);
        hasPending = true;

        emit CheckpointOpened(epoch, pendingNonce, pendingHandle);
    }

    function submitCheckpoint(
        uint64 epoch,
        uint64 nonce,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external {
        if (!hasPending) revert NoPendingCheckpoint();
        if (epoch != riskEpoch || epoch != pendingEpoch) revert WrongEpoch(riskEpoch, epoch);
        if (nonce != pendingNonce) revert WrongNonce(pendingNonce, nonce);
        if (abiEncodedCleartexts.length != 32) revert InvalidCleartextLength(abiEncodedCleartexts.length);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingHandle;
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof);

        bool isSolvent = abi.decode(abiEncodedCleartexts, (bool));
        hasPending = false;
        lastSubmittedEpoch = epoch;
        lastResult = isSolvent;

        emit CheckpointSubmitted(epoch, nonce, isSolvent);
    }
}
