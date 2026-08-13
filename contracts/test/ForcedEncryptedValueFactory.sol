// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ForcedEncryptedValueFactory is ZamaEthereumConfig {
    euint64 private _lastHandle;

    function lastHandle() external view returns (euint64) {
        return _lastHandle;
    }

    function makeFor(address grantee, uint64 value) external {
        _lastHandle = FHE.asEuint64(value);
        FHE.allowThis(_lastHandle);
        FHE.allow(_lastHandle, grantee);
    }
}
