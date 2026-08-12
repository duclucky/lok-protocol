// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {LokAccountingModel} from "../reference/LokAccountingModel.sol";
import {LokDrawReference} from "../reference/LokDrawReference.sol";

contract LokHandler {
    uint256 private constant MAX_ACTION_AMOUNT = 1_000_000e6;

    LokAccountingModel public immutable accounting;
    LokDrawReference public immutable draw;

    address[] private _participants;
    mapping(address user => uint8 theta) public theta;

    uint256 public depositCalls;
    uint256 public withdrawCalls;
    uint256 public drawCalls;
    uint256 public settleDrawCalls;

    mapping(address user => uint256 amount) public netDeposits;

    constructor(LokAccountingModel accounting_, LokDrawReference draw_) {
        accounting = accounting_;
        draw = draw_;
        _participants.push(address(0x1001));
        _participants.push(address(0x1002));
        _participants.push(address(0x1003));
        theta[address(0x1001)] = 4;
        theta[address(0x1002)] = 4;
        theta[address(0x1003)] = 4;
    }

    function participants() external view returns (address[] memory) {
        return _participants;
    }

    function deposit(uint256 userSeed, uint256 rawAmount) external {
        address user = _user(userSeed);
        uint256 moved = _amount(rawAmount);
        accounting.deposit(user, moved);
        netDeposits[user] += moved;
        ++depositCalls;
    }

    function withdraw(uint256 userSeed, uint256 rawAmount) external {
        address user = _user(userSeed);
        uint256 moved = rawAmount % (accounting.balanceOf(user) + 1);
        accounting.withdraw(user, moved);
        _debitNetDeposit(user, moved);
        ++withdrawCalls;
    }

    function emergencyWithdraw(uint256 userSeed) external {
        address user = _user(userSeed);
        uint256 moved = accounting.balanceOf(user);
        accounting.withdraw(user, moved);
        _debitNetDeposit(user, moved);
        ++withdrawCalls;
    }

    function exit(uint256 userSeed) external {
        address user = _user(userSeed);
        uint256 moved = accounting.balanceOf(user);
        accounting.withdraw(user, moved);
        _debitNetDeposit(user, moved);
        ++withdrawCalls;
    }

    function setTheta(uint256 userSeed, uint8 rawTheta) external {
        theta[_user(userSeed)] = rawTheta % 5;
    }

    function fundYield(uint256 rawAmount) external {
        accounting.fundYield(_amount(rawAmount));
    }

    function directCredit(uint256 userSeed, uint256 rawAmount) external {
        uint256 available = accounting.availableYield();
        uint256 amount = rawAmount % (available + 1);
        accounting.creditFundedYield(_user(userSeed), amount);
    }

    function openCheckpoint() external {
        accounting.openCheckpoint();
    }

    function submitCheckpoint(bool claimedSolvent) external {
        accounting.submitCheckpoint(claimedSolvent);
    }

    function submitForgedCheckpoint() external {
        accounting.submitForgedCheckpoint();
    }

    function submitForgedTotals() external {
        draw.rejectForgedOutcome();
    }

    function moveCustody(uint256 rawAmount) external {
        uint256 amount = rawAmount % (accounting.vaultAssets() + 1);
        accounting.moveVaultToActive(amount);
    }

    function proposeAdapter() external {
        accounting.proposeAdapter();
    }

    function advanceTime(uint64 delta) external {
        accounting.advanceTime(delta);
    }

    function activateAdapter() external {
        accounting.activateAdapter();
    }

    function drainRetiringAdapter() external {
        accounting.drainRetiringAdapter();
    }

    function removeRetiringAdapter() external {
        accounting.removeRetiringAdapter();
    }

    function pause(bool value) external {
        accounting.setPaused(value);
    }

    function openDraw() external {
        accounting.openDraw();
    }

    function abortDraw() external {
        accounting.abortDraw();
    }

    function attemptReentrantMutation() external {
        accounting.attemptReentrantMutation();
    }

    function settleDraw(uint256 randomWord, uint256 rawPrize) external {
        ++settleDrawCalls;
        uint256 available = accounting.availableYield();
        uint256 prize = rawPrize % (available + 1);
        if (prize == 0) {
            _assertSettlementSafety();
            return;
        }

        uint256[] memory weights = new uint256[](_participants.length);
        uint256 totalWeight;
        for (uint256 i; i < _participants.length; ++i) {
            address user = _participants[i];
            weights[i] = (accounting.balanceOf(user) * uint256(theta[user])) / 4;
            totalWeight += weights[i];
        }
        if (totalWeight == 0) {
            _assertSettlementSafety();
            return;
        }

        address winner = draw.settle(_participants, weights, randomWord, prize);
        if (winner == address(0)) {
            _assertSettlementSafety();
            return;
        }
        accounting.creditFundedYield(winner, prize);
        ++drawCalls;
        _assertSettlementSafety();
    }

    function allNetDepositsRecoverable() external view returns (bool) {
        for (uint256 i; i < _participants.length; ++i) {
            address user = _participants[i];
            if (accounting.balanceOf(user) < netDeposits[user]) return false;
        }
        return true;
    }

    function _user(uint256 seed) private view returns (address) {
        return _participants[seed % _participants.length];
    }

    function _amount(uint256 rawAmount) private pure returns (uint256) {
        return rawAmount % (MAX_ACTION_AMOUNT + 1);
    }

    function _debitNetDeposit(address user, uint256 moved) private {
        uint256 debit = moved < netDeposits[user] ? moved : netDeposits[user];
        netDeposits[user] -= debit;
    }

    function _assertSettlementSafety() private view {
        assert(accounting.totalAssets() >= accounting.totalLiability());
        assert(accounting.totalLiability() >= accounting.totalPrincipal());
        assert(accounting.sumBalances() == accounting.totalLiability());
        assert(accounting.sumPrincipalBalances() == accounting.totalPrincipal());
        assert(this.allNetDepositsRecoverable());
    }
}
