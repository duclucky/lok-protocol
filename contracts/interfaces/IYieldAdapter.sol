/* solhint-disable use-natspec */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @notice Bounded confidential-custody boundary used by LokVault.
interface IYieldAdapter {
    function asset() external view returns (address);

    /// @dev Not view: the adapter must grant the calling vault transient ACL access to the returned handle.
    function confidentialAssets() external returns (euint64 assets);

    function withdrawToVault(euint64 requested) external returns (euint64 moved);

    function withdrawAllToVault() external returns (euint64 moved);

    function harvest() external returns (uint64 realisedYield);
}
