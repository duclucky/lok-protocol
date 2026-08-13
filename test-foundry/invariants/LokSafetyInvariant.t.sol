// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {LokHandler} from "../handlers/LokHandler.sol";
import {LokAccountingModel} from "../reference/LokAccountingModel.sol";
import {LokDrawReference} from "../reference/LokDrawReference.sol";

contract LokSafetyInvariantTest is StdInvariant, Test {
    LokAccountingModel internal accounting;
    LokDrawReference internal draw;
    LokHandler internal handler;

    function setUp() external {
        accounting = new LokAccountingModel();
        draw = new LokDrawReference();
        handler = new LokHandler(accounting, draw);
        accounting.setController(address(handler));
        draw.setController(address(handler));

        bytes4[] memory selectors = new bytes4[](22);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.emergencyWithdraw.selector;
        selectors[3] = handler.exit.selector;
        selectors[4] = handler.setTheta.selector;
        selectors[5] = handler.fundYield.selector;
        selectors[6] = handler.directCredit.selector;
        selectors[7] = handler.openCheckpoint.selector;
        selectors[8] = handler.submitCheckpoint.selector;
        selectors[9] = handler.submitForgedCheckpoint.selector;
        selectors[10] = handler.moveCustody.selector;
        selectors[11] = handler.proposeAdapter.selector;
        selectors[12] = handler.advanceTime.selector;
        selectors[13] = handler.activateAdapter.selector;
        selectors[14] = handler.drainRetiringAdapter.selector;
        selectors[15] = handler.removeRetiringAdapter.selector;
        selectors[16] = handler.pause.selector;
        selectors[17] = handler.openDraw.selector;
        selectors[18] = handler.abortDraw.selector;
        selectors[19] = handler.attemptReentrantMutation.selector;
        selectors[20] = handler.submitForgedTotals.selector;
        selectors[21] = handler.settleDraw.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_TierASafetyObligations() external view {
        assertGe(accounting.totalAssets(), accounting.totalLiability(), "P-S2 assets < liabilities");
        assertGe(accounting.totalLiability(), accounting.totalPrincipal(), "P-S2 liabilities < principal");
        assertEq(accounting.sumBalances(), accounting.totalLiability(), "P-S2 liability sum mismatch");
        assertEq(accounting.sumPrincipalBalances(), accounting.totalPrincipal(), "P-S2 principal sum mismatch");
        assertEq(
            accounting.totalAssets(),
            accounting.vaultAssets() + accounting.activeAdapterAssets() + accounting.retiringAdapterAssets(),
            "P-S2 custody partition mismatch"
        );
        assertTrue(accounting.allUsersRecoverPrincipal(), "P-S1 user principal not recoverable");
        assertTrue(handler.allNetDepositsRecoverable(), "P-S1 net deposits not recoverable");
        assertTrue(accounting.lastRiskTransitionAuthorized(), "P-A8 unauthorized risk transition");
        assertTrue(accounting.lastForgedCheckpointRejected(), "P-O1 forged checkpoint accepted");
        assertTrue(accounting.lastReentrantMutationBlocked(), "P-S8 reentrant mutation accepted");
        assertTrue(draw.lastForgedOutcomeRejected(), "P-O1 forged outcome accepted");
        assertTrue(draw.lastPassAExactlyOnce(), "P-S2 PASS A cursor consumed a participant twice");
        assertTrue(draw.lastPassBExactlyOnce(), "P-S2 PASS B cursor consumed a participant twice");
        assertTrue(draw.lastFundedAllocationBounded(), "P-S2 settlement exceeded realised funded yield");
        assertTrue(handler.lastPostEndIsolationHeld(), "P-S2 PASS A used state changed after tEnd");
        assertEq(draw.totalPrizeCredited(), draw.totalPrizeSettled(), "P-S3 prize mismatch");
        assertEq(draw.sumPrizeCredits(), draw.totalPrizeCredited(), "P-S3 credit sum mismatch");
    }

    function test_P_A4_ExitDuringAdapterDelay() external {
        handler.deposit(0, 100);
        handler.openCheckpoint();
        handler.submitCheckpoint(true);
        handler.proposeAdapter();
        handler.emergencyWithdraw(0);
        assertEq(accounting.balanceOf(address(0x1001)), 0);
        assertEq(accounting.principalOf(address(0x1001)), 0);
    }

    function test_P_A8_NonIdleActivationRejected() external {
        handler.openCheckpoint();
        handler.submitCheckpoint(true);
        handler.proposeAdapter();
        handler.openDraw();
        handler.advanceTime(2);
        handler.activateAdapter();
        assertEq(accounting.riskEpoch(), 1);
        assertTrue(accounting.drawIdle() == false);
    }

    function test_P_O1_RiskStaleCheckpointRejected() external {
        handler.openCheckpoint();
        handler.submitCheckpoint(true);
        handler.openCheckpoint();
        handler.proposeAdapter();
        handler.advanceTime(2);
        handler.activateAdapter();
        assertEq(accounting.riskEpoch(), 2);
        handler.submitCheckpoint(true);
        assertEq(accounting.lastSolventRiskEpoch(), 1);
    }

    function test_P_S8_ReentrantMutationIsNoOp() external {
        handler.deposit(0, 100);
        uint256 liabilityBefore = accounting.totalLiability();
        handler.attemptReentrantMutation();
        assertEq(accounting.totalLiability(), liabilityBefore);
        assertTrue(accounting.lastReentrantMutationBlocked());
    }

    function test_P_S2_SettlementAllocatesZeroRiskDirectYield() external {
        handler.deposit(0, 100);
        handler.deposit(1, 200);
        handler.deposit(2, 300);
        handler.setTheta(0, 0);
        handler.setTheta(1, 0);
        handler.setTheta(2, 0);
        handler.fundYield(99);

        handler.settleDraw(17, 1);

        assertLt(accounting.availableYield(), 99, "P-S2 settlement skipped funded direct yield");
        assertGt(accounting.balanceOf(address(0x1001)), 100, "P-S2 first direct credit missing");
        assertGt(accounting.balanceOf(address(0x1002)), 200, "P-S2 second direct credit missing");
        assertGt(accounting.balanceOf(address(0x1003)), 300, "P-S2 third direct credit missing");
    }
}
