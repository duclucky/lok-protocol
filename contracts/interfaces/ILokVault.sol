/* solhint-disable use-natspec */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ebool, euint16, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";

/// @notice Draw-manager boundary for confidential accounting and exact draw checkpoints.
interface ILokVault {
    function participantCount() external view returns (uint256);

    function participantAt(uint256 index) external view returns (address);

    function preSync(address[] calldata users) external;

    function drawWeightsFor(address user) external view returns (euint128 ticketDelta, euint128 yieldDelta);

    function drawInputsFor(address user) external returns (euint128 ticketDelta, euint128 yieldDelta, euint16 fortune);

    function rollCheckpoint(address user) external;

    function creditDraw(address user, euint64 prizeCredit, euint64 directCredit, ebool win) external;

    function harvestRealisedYield() external returns (uint64 realisedYield);

    function onDrawOpened(uint64 drawId, uint64 tStart, uint64 tEnd) external;

    function onDrawClosed(uint64 drawId) external;

    function riskEpoch() external view returns (uint64);

    function lastSolventRiskEpoch() external view returns (uint64);

    function restricted() external view returns (bool);
}
