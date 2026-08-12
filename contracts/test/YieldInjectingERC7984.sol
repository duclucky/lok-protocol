/* solhint-disable one-contract-per-file, use-natspec, max-line-length */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IYieldNotificationReceiver {
    function notifyYield(uint64 amount) external;
}

contract MockUSDC is ERC20 {
    constructor() ERC20("Lok Demo USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Sepolia/demo cUSDC fixture. Yield injection can only add assets and is intentionally permissionless.
contract YieldInjectingERC7984 is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(IERC20 underlying_) ERC7984("Lok Demo cUSDC", "cUSDC", "") ERC7984ERC20Wrapper(underlying_) {}

    function mintForTest(address to, uint64 amount) external returns (euint64) {
        MockUSDC(underlying()).mint(address(this), uint256(amount) * rate());
        return _mint(to, FHE.asEuint64(amount));
    }

    function injectYield(address adapter, uint64 amount) external {
        MockUSDC(underlying()).mint(address(this), uint256(amount) * rate());
        _mint(adapter, FHE.asEuint64(amount));
        IYieldNotificationReceiver(adapter).notifyYield(amount);
    }
}
