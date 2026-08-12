/* solhint-disable use-natspec */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

contract MockYieldAdapter is ZamaEthereumConfig, IYieldAdapter, Ownable2Step, ReentrancyGuard {
    error AlreadyBound();
    error InvalidVault();
    error OnlyAsset();
    error OnlyVault();
    error PendingYieldRequiresFullReturn();

    event VaultBound(address indexed vault);
    event YieldFunded(uint64 indexed amount);
    event YieldHarvested(uint64 indexed amount);

    IERC7984 private immutable _ASSET;
    address public vault;
    uint64 public fundedYieldInAdapter;
    uint64 public fundedYieldInVault;

    constructor(IERC7984 asset_, address initialOwner) Ownable(initialOwner) {
        if (address(asset_) == address(0)) revert InvalidVault();
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
        if (vault_ == address(0)) revert InvalidVault();
        vault = vault_;
        emit VaultBound(vault_);
    }

    function notifyYield(uint64 amount) external {
        if (msg.sender != address(_ASSET)) revert OnlyAsset();
        fundedYieldInAdapter += amount;
        emit YieldFunded(amount);
    }

    function confidentialAssets() external onlyVault returns (euint64 assets) {
        assets = _ASSET.confidentialBalanceOf(address(this));
        FHE.allowTransient(assets, msg.sender);
    }

    function withdrawToVault(euint64 requested) external onlyVault nonReentrant returns (euint64 moved) {
        if (fundedYieldInAdapter != 0) revert PendingYieldRequiresFullReturn();
        FHE.allowTransient(requested, address(_ASSET));
        moved = _ASSET.confidentialTransfer(vault, requested);
        FHE.allowTransient(moved, vault);
    }

    function withdrawAllToVault() external onlyVault nonReentrant returns (euint64 moved) {
        euint64 balance = _ASSET.confidentialBalanceOf(address(this));
        if (!FHE.isInitialized(balance)) {
            moved = FHE.asEuint64(0);
            FHE.allowTransient(moved, vault);
            return moved;
        }
        moved = _ASSET.confidentialTransfer(vault, balance);
        FHE.allowTransient(moved, vault);

        fundedYieldInVault += fundedYieldInAdapter;
        fundedYieldInAdapter = 0;
    }

    function harvest() external onlyVault nonReentrant returns (uint64 realisedYield) {
        uint64 inAdapter = fundedYieldInAdapter;
        realisedYield = inAdapter + fundedYieldInVault;

        fundedYieldInAdapter = 0;
        fundedYieldInVault = 0;

        if (inAdapter != 0) {
            euint64 requested = FHE.asEuint64(inAdapter);
            FHE.allowTransient(requested, address(_ASSET));
            euint64 moved = _ASSET.confidentialTransfer(vault, requested);
            FHE.allowTransient(moved, vault);
        }

        emit YieldHarvested(realisedYield);
    }
}
