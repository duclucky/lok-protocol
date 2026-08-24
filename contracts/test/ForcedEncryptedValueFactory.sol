// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ForcedEncryptedValueFactory
/// @author Lok Protocol
/// @notice Test-only helper that creates encrypted values and grants them to a target account.
contract ForcedEncryptedValueFactory is ZamaEthereumConfig {
    euint64 private _lastHandle;

    /// @notice Returns the most recently created encrypted handle.
    function lastHandle() external view returns (euint64) {
        return _lastHandle;
    }

    /// @notice Creates an encrypted value and grants decryption access to a test grantee.
    /// @param grantee Account receiving access to the encrypted handle.
    /// @param value Plain test value to wrap into an encrypted handle.
    function makeFor(address grantee, uint64 value) external {
        _lastHandle = FHE.asEuint64(value);
        FHE.allowThis(_lastHandle);
        FHE.allow(_lastHandle, grantee);
    }
}
