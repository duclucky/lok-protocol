// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {LokHandler} from "../handlers/LokHandler.sol";
import {LokAccountingModel} from "../reference/LokAccountingModel.sol";
import {LokDrawReference} from "../reference/LokDrawReference.sol";

contract LokFairnessInvariantTest is StdInvariant, Test {
    LokAccountingModel internal accounting;
    LokDrawReference internal draw;
    LokHandler internal handler;

    function setUp() external {
        accounting = new LokAccountingModel();
        draw = new LokDrawReference();
        handler = new LokHandler(accounting, draw);
        accounting.setController(address(handler));
        draw.setController(address(handler));

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.setTheta.selector;
        selectors[3] = handler.fundYield.selector;
        selectors[4] = handler.settleDraw.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_TierAFairnessObligations() external view {
        assertTrue(draw.allFortuneBoostsBounded(), "P-F5 Fortune bound");
        assertTrue(draw.lastPartitionExact(), "P-F7 partition gap/overlap");
        assertTrue(draw.lastPrefixWithinEuint64(), "P-S9 prefix overflow");
        assertEq(draw.totalPrizeCredited(), draw.totalPrizeSettled(), "P-S3 prize mismatch");
        assertEq(draw.sumPrizeCredits(), draw.totalPrizeCredited(), "P-S3 per-user credit sum mismatch");
    }

    function testFuzz_P_F7_ExactHalfOpenPartition(uint64 a, uint64 b, uint64 c, uint256 randomWord) external view {
        address[] memory users = handler.participants();
        uint256[] memory weights = new uint256[](3);
        weights[0] = uint256(a) % 1_000_001;
        weights[1] = uint256(b) % 1_000_001;
        weights[2] = uint256(c) % 1_000_001;
        uint256 total = weights[0] + weights[1] + weights[2];
        if (total == 0) return;

        (, uint256 matches) = draw.partitionWinner(users, weights, randomWord % total);
        assertEq(matches, 1);
    }

    function testFuzz_P_F9_FortuneSplitBound(uint64 principal, uint8 parts, uint8 fortune) external view {
        uint256 boundedPrincipal = uint256(principal) % 1_000_000_000_001;
        uint256 boundedParts = bound(uint256(parts), 1, 32);
        uint256 boundedFortune = uint256(fortune) % 53;
        assertTrue(draw.fortuneSplitBounded(boundedPrincipal, boundedParts, boundedFortune));
    }

    function test_P_L6_ExactEndBoundary() external view {
        uint256 start = 100;
        uint256 end = 200;
        uint256 balance = 7;
        uint256 expected = 700;
        assertEq(draw.snapshotWeight(start, end, end - 1, balance), expected);
        assertEq(draw.snapshotWeight(start, end, end, balance), expected);
        assertEq(draw.snapshotWeight(start, end, end + 1, balance), expected);
    }

    function test_P_S7_ZeroDenominatorVoids() external view {
        assertEq(draw.normalizedShare(100, 0), 0);
    }

    function testFuzz_P_S2_FundedAllocationNeverExceedsYield(
        uint64 realisedYield,
        uint32 baseRisk,
        uint32 directA,
        uint32 directB,
        uint32 slack
    ) external view {
        uint64[] memory directWeights = new uint64[](2);
        directWeights[0] = directA;
        directWeights[1] = directB;
        uint64 totalWeight = uint64(baseRisk) + uint64(directA) + uint64(directB) + uint64(slack) + 1;
        assertTrue(draw.fundedAllocationBounded(realisedYield, baseRisk, totalWeight, directWeights));
    }

    function test_P_S9_MaxFortunePrefixBoundary() external view {
        uint64 totalBase = uint64((1 << 58) - 1);
        uint64[] memory baseWeights = new uint64[](3);
        baseWeights[0] = totalBase / 3;
        baseWeights[1] = totalBase / 3;
        baseWeights[2] = totalBase - baseWeights[0] - baseWeights[1];
        uint8[] memory fortunes = new uint8[](3);
        fortunes[0] = 52;
        fortunes[1] = 52;
        fortunes[2] = 52;
        assertTrue(draw.effectiveTotalWithinBounds(baseWeights, fortunes));

        baseWeights[0] = 0;
        baseWeights[1] = 1;
        baseWeights[2] = 0;
        assertTrue(draw.effectiveTotalWithinBounds(baseWeights, fortunes));
    }

    function test_P_F6_WinnerResetsAndLosersIncrement() external {
        handler.deposit(0, 100);
        handler.deposit(1, 100);
        handler.deposit(2, 100);
        handler.fundYield(10);
        handler.settleDraw(0, 10);
        assertEq(draw.fortune(address(0x1001)), 0);
        assertEq(draw.fortune(address(0x1002)), 1);
        assertEq(draw.fortune(address(0x1003)), 1);
    }
}
