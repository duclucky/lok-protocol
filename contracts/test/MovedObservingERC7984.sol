// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

import {YieldInjectingERC7984} from "./YieldInjectingERC7984.sol";

/// @title MovedObservingERC7984
/// @author Lok Protocol
/// @notice Test-only observer for the encrypted amount actually returned by ERC-7984 transferFrom.
contract MovedObservingERC7984 is YieldInjectingERC7984 {
    euint64 private _lastMovedForTest;

    constructor(IERC20 underlying_) YieldInjectingERC7984(underlying_) {}

    /// @notice Returns the encrypted amount most recently moved by confidentialTransferFrom.
    function lastMovedForTest() external view returns (euint64) {
        return _lastMovedForTest;
    }

    /// @notice Transfers confidential tokens and records the encrypted amount actually moved.
    /// @param from Source account.
    /// @param to Destination account.
    /// @param amount Requested encrypted amount.
    /// @return transferred Encrypted amount actually moved by the underlying ERC-7984 logic.
    function confidentialTransferFrom(
        address from,
        address to,
        euint64 amount
    ) public override(ERC7984, IERC7984) returns (euint64 transferred) {
        transferred = super.confidentialTransferFrom(from, to, amount);
        _lastMovedForTest = transferred;
        FHE.allowThis(_lastMovedForTest);
    }
}
