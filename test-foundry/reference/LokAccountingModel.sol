// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

contract LokAccountingModel {
    uint256 public constant MAX_ACTION_AMOUNT = 1_000_000e6;
    uint64 public constant WITHDRAW_WINDOW = 2;

    address public immutable admin;
    address public controller;

    mapping(address user => uint256 amount) public balanceOf;
    mapping(address user => uint256 amount) public principalOf;
    mapping(address user => bool registered) private _registered;
    address[] private _participants;

    uint256 public totalAssets;
    uint256 public totalLiability;
    uint256 public totalPrincipal;
    uint256 public availableYield;

    uint256 public vaultAssets;
    uint256 public activeAdapterAssets;
    uint256 public retiringAdapterAssets;

    uint64 public accountingVersion;
    uint64 public riskEpoch = 1;
    uint64 public lastSolventRiskEpoch;
    bool public restricted;

    uint64 public clock;
    bool public swapQueued;
    uint64 public swapReadyAt;
    bool public retiringAdapterPresent;
    bool public lastRiskTransitionAuthorized = true;
    bool public drawIdle = true;
    bool public paused;

    bool public checkpointPending;
    bool public pendingCheckpointResult;
    uint64 public pendingCheckpointRiskEpoch;
    uint64 public checkpointNonce;
    bool public lastForgedCheckpointRejected = true;
    bool public lastReentrantMutationBlocked = true;

    error Unauthorized();

    constructor() {
        admin = msg.sender;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert Unauthorized();
        _;
    }

    function setController(address controller_) external {
        if (msg.sender != admin || controller != address(0)) revert Unauthorized();
        controller = controller_;
    }

    function deposit(address user, uint256 moved) external onlyController {
        moved %= MAX_ACTION_AMOUNT + 1;
        _register(user);

        balanceOf[user] += moved;
        principalOf[user] += moved;
        totalLiability += moved;

        totalPrincipal += moved;
        totalAssets += moved;

        if (_riskAuthorized()) activeAdapterAssets += moved;
        else vaultAssets += moved;
        ++accountingVersion;
    }

    function withdraw(address user, uint256 moved) external onlyController {
        uint256 userBalance = balanceOf[user];
        if (moved > userBalance) moved = userBalance;
        if (moved > totalAssets) moved = totalAssets;

        balanceOf[user] = userBalance - moved;
        totalLiability -= moved;

        uint256 principalDebit = moved < principalOf[user] ? moved : principalOf[user];
        principalOf[user] -= principalDebit;
        totalPrincipal -= principalDebit;
        _debitCustody(moved);
        ++accountingVersion;
    }

    function fundYield(uint256 amount) external onlyController {
        amount %= MAX_ACTION_AMOUNT + 1;
        vaultAssets += amount;
        totalAssets += amount;
        availableYield += amount;
        ++accountingVersion;
    }

    function creditFundedYield(address user, uint256 amount) external onlyController {
        if (amount > availableYield) amount = availableYield;
        _register(user);
        availableYield -= amount;
        balanceOf[user] += amount;
        totalLiability += amount;
        ++accountingVersion;
    }

    function moveVaultToActive(uint256 amount) external onlyController {
        if (!_riskAuthorized()) return;
        if (amount > vaultAssets) amount = vaultAssets;
        vaultAssets -= amount;
        activeAdapterAssets += amount;
        ++accountingVersion;
    }

    function openCheckpoint() external onlyController {
        checkpointPending = true;
        pendingCheckpointResult = totalAssets >= totalLiability;
        pendingCheckpointRiskEpoch = riskEpoch;
        ++checkpointNonce;
    }

    function submitCheckpoint(bool claimedSolvent) external onlyController {
        if (!checkpointPending) return;
        if (pendingCheckpointRiskEpoch != riskEpoch || claimedSolvent != pendingCheckpointResult) return;

        checkpointPending = false;
        if (claimedSolvent) {
            lastSolventRiskEpoch = riskEpoch;
            restricted = false;
        } else {
            restricted = true;
        }
    }

    function submitForgedCheckpoint() external onlyController {
        uint64 authorizedBefore = lastSolventRiskEpoch;
        bool restrictedBefore = restricted;
        lastForgedCheckpointRejected = true;
        assert(lastSolventRiskEpoch == authorizedBefore && restricted == restrictedBefore);
    }

    function attemptReentrantMutation() external onlyController {
        uint256 liabilityBefore = totalLiability;
        uint256 principalBefore = totalPrincipal;
        uint64 epochBefore = riskEpoch;
        lastReentrantMutationBlocked = true;
        assert(totalLiability == liabilityBefore && totalPrincipal == principalBefore && riskEpoch == epochBefore);
    }

    function proposeAdapter() external onlyController {
        if (swapQueued || !drawIdle || !_riskAuthorized()) return;
        swapQueued = true;
        swapReadyAt = clock + WITHDRAW_WINDOW;
    }

    function advanceTime(uint64 delta) external onlyController {
        uint64 bounded = delta % 4;
        clock += bounded;
    }

    function activateAdapter() external onlyController returns (bool activated) {
        bool authorized = _riskAuthorized();
        if (!drawIdle || !swapQueued || clock < swapReadyAt || !authorized || retiringAdapterPresent) return false;

        retiringAdapterPresent = true;
        retiringAdapterAssets = activeAdapterAssets;
        activeAdapterAssets = 0;
        swapQueued = false;
        lastRiskTransitionAuthorized = authorized;
        ++riskEpoch;
        ++accountingVersion;
        return true;
    }

    function drainRetiringAdapter() external onlyController {
        if (!retiringAdapterPresent) return;
        vaultAssets += retiringAdapterAssets;
        retiringAdapterAssets = 0;
        ++accountingVersion;
    }

    function removeRetiringAdapter() external onlyController returns (bool removed) {
        bool authorized = _riskAuthorized();
        if (!drawIdle || !retiringAdapterPresent || retiringAdapterAssets != 0 || !authorized) return false;

        retiringAdapterPresent = false;
        lastRiskTransitionAuthorized = authorized;
        ++riskEpoch;
        ++accountingVersion;
        return true;
    }

    function sumBalances() external view returns (uint256 sum) {
        for (uint256 i; i < _participants.length; ++i) {
            sum += balanceOf[_participants[i]];
        }
    }

    function sumPrincipalBalances() external view returns (uint256 sum) {
        for (uint256 i; i < _participants.length; ++i) {
            sum += principalOf[_participants[i]];
        }
    }

    function participants() external view returns (address[] memory) {
        return _participants;
    }

    function riskAuthorized() external view returns (bool) {
        return _riskAuthorized();
    }

    function setPaused(bool value) external onlyController {
        paused = value;
    }

    function openDraw() external onlyController {
        if (paused || !drawIdle || !_riskAuthorized()) return;
        drawIdle = false;
    }

    function abortDraw() external onlyController {
        if (drawIdle) return;
        drawIdle = true;
    }

    function allUsersRecoverPrincipal() external view returns (bool) {
        if (totalAssets < totalLiability) return false;
        for (uint256 i; i < _participants.length; ++i) {
            address user = _participants[i];
            if (principalOf[user] > balanceOf[user]) return false;
        }
        return true;
    }

    function _riskAuthorized() private view returns (bool) {
        return !restricted && lastSolventRiskEpoch == riskEpoch;
    }

    function _register(address user) private {
        if (_registered[user]) return;
        _registered[user] = true;
        _participants.push(user);
    }

    function _debitCustody(uint256 amount) private {
        uint256 fromVault = amount < vaultAssets ? amount : vaultAssets;
        vaultAssets -= fromVault;
        amount -= fromVault;

        uint256 fromActive = amount < activeAdapterAssets ? amount : activeAdapterAssets;
        activeAdapterAssets -= fromActive;
        amount -= fromActive;

        retiringAdapterAssets -= amount;
        totalAssets -= fromVault + fromActive + amount;
    }
}
