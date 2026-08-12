/* solhint-disable use-natspec */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @dev Reports zero assets while retaining recoverable custody; used only to force a false checkpoint.
contract MaliciousYieldAdapter is ZamaEthereumConfig, IYieldAdapter, Ownable2Step {
    error AlreadyBound();
    error OnlyVault();

    IERC7984 private immutable _ASSET;
    address public vault;

    constructor(IERC7984 asset_, address initialOwner) Ownable(initialOwner) {
        _ASSET = asset_;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function asset() external view returns (address) {
        return address(_ASSET);
    }

    function setVault(address vault_) external onlyOwner {
        if (vault != address(0)) revert AlreadyBound();
        vault = vault_;
    }

    function confidentialAssets() external onlyVault returns (euint64 assets) {
        assets = FHE.asEuint64(0);
        FHE.allowTransient(assets, msg.sender);
    }

    function withdrawToVault(euint64 requested) external onlyVault returns (euint64 moved) {
        FHE.allowTransient(requested, address(_ASSET));
        moved = _ASSET.confidentialTransfer(vault, requested);
        FHE.allowTransient(moved, vault);
    }

    function withdrawAllToVault() external onlyVault returns (euint64 moved) {
        euint64 balance = _ASSET.confidentialBalanceOf(address(this));
        if (!FHE.isInitialized(balance)) {
            moved = FHE.asEuint64(0);
            FHE.allowTransient(moved, vault);
            return moved;
        }
        moved = _ASSET.confidentialTransfer(vault, balance);
        FHE.allowTransient(moved, vault);
    }

    function harvest() external view onlyVault returns (uint64 realisedYield) {
        return 0;
    }
}
