/* solhint-disable use-natspec, max-line-length, avoid-low-level-calls */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IMintableUnderlying is IERC20 {
    function mint(address to, uint256 amount) external;
}

interface IYieldReceiver {
    function notifyYield(uint64 amount) external;
}

/// @dev Test-only ERC-7984 wrapper that attempts one configured callback from every vault-facing value leg.
contract MaliciousConfidentialToken is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    address public callbackTarget;
    bytes public callbackData;
    bytes public callbackReturnData;
    bool public callbackArmed;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bool private _insideCallback;

    constructor(IERC20 underlying_) ERC7984("Lok Malicious cUSDC", "mcUSDC", "") ERC7984ERC20Wrapper(underlying_) {}

    function mintForTest(address to, uint64 amount) external returns (euint64) {
        IMintableUnderlying(underlying()).mint(address(this), uint256(amount) * rate());
        return _mint(to, FHE.asEuint64(amount));
    }

    function injectYield(address adapter, uint64 amount) external {
        IMintableUnderlying(underlying()).mint(address(this), uint256(amount) * rate());
        _mint(adapter, FHE.asEuint64(amount));
        IYieldReceiver(adapter).notifyYield(amount);
    }

    function armCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        callbackReturnData = "";
        callbackArmed = true;
        callbackAttempted = false;
        callbackSucceeded = false;
    }

    function confidentialTransferFrom(
        address from,
        address to,
        euint64 amount
    ) public override(ERC7984, IERC7984) returns (euint64 transferred) {
        _attemptCallback();
        return super.confidentialTransferFrom(from, to, amount);
    }

    function confidentialTransfer(
        address to,
        euint64 amount
    ) public override(ERC7984, IERC7984) returns (euint64 transferred) {
        _attemptCallback();
        return super.confidentialTransfer(to, amount);
    }

    function unwrap(address from, address to, euint64 amount) public override returns (bytes32 requestId) {
        _attemptCallback();
        return super.unwrap(from, to, amount);
    }

    function _attemptCallback() private {
        if (!callbackArmed || _insideCallback) return;
        callbackArmed = false;
        callbackAttempted = true;
        _insideCallback = true;
        (callbackSucceeded, callbackReturnData) = callbackTarget.call(callbackData);
        _insideCallback = false;
    }
}
