// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {LokHandler} from "../handlers/LokHandler.sol";
import {LokAccountingModel} from "../reference/LokAccountingModel.sol";
import {LokDrawReference} from "../reference/LokDrawReference.sol";

contract LokAccountingInvariantTest is StdInvariant, Test {
    LokAccountingModel internal accounting;
    LokDrawReference internal draw;
    LokHandler internal handler;

    function setUp() external {
        accounting = new LokAccountingModel();
        draw = new LokDrawReference();
        handler = new LokHandler(accounting, draw);

        accounting.setController(address(handler));
        draw.setController(address(handler));
        targetContract(address(handler));
    }

    function invariant_AssetsCoverLiabilitiesAndPrincipal() external view {
        assertGe(accounting.totalAssets(), accounting.totalLiability());
        assertGe(accounting.totalLiability(), accounting.totalPrincipal());
    }

    function invariant_UserSumsMatchAggregates() external view {
        assertEq(accounting.sumBalances(), accounting.totalLiability());
        assertEq(accounting.sumPrincipalBalances(), accounting.totalPrincipal());
    }

    function invariant_CustodyIsAnExactPartition() external view {
        assertEq(
            accounting.totalAssets(),
            accounting.vaultAssets() + accounting.activeAdapterAssets() + accounting.retiringAdapterAssets()
        );
    }

    function invariant_PrizeCreditsAreConserved() external view {
        assertEq(draw.totalPrizeCredited(), draw.totalPrizeSettled());
        assertEq(draw.sumPrizeCredits(), draw.totalPrizeCredited());
    }

    function invariant_FortuneBoostIsBounded() external view {
        assertTrue(draw.allFortuneBoostsBounded());
    }

    function invariant_RiskTransitionsWereAuthorized() external view {
        assertTrue(accounting.lastRiskTransitionAuthorized());
    }

    function test_PartitionMapsEveryTicketExactlyOnce() external view {
        address[] memory users = handler.participants();
        uint256[] memory weights = new uint256[](3);
        weights[0] = 2;
        weights[1] = 3;
        weights[2] = 5;

        for (uint256 r; r < 10; ++r) {
            (address winner, uint256 matches) = draw.partitionWinner(users, weights, r);
            assertTrue(winner != address(0));
            assertEq(matches, 1);
        }
    }

    function test_ZeroWeightUserCannotWin() external view {
        address[] memory users = handler.participants();
        uint256[] memory weights = new uint256[](3);
        weights[0] = 0;
        weights[1] = 2;
        weights[2] = 3;

        for (uint256 r; r < 5; ++r) {
            (address winner, uint256 matches) = draw.partitionWinner(users, weights, r);
            assertTrue(winner != users[0]);
            assertEq(matches, 1);
        }
    }
}
