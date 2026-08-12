/* solhint-disable use-natspec, max-states-count, immutable-vars-naming, gas-indexed-events, gas-strict-inequalities */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, ebool, euint16, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILokVault} from "./interfaces/ILokVault.sol";

contract LokDrawManager is ZamaEthereumConfig, Ownable2Step, ReentrancyGuard {
    error AlreadyRevealed();
    error BatchOutOfRange();
    error CommitmentMismatch();
    error DrawsPaused();
    error InvalidAddress();
    error InvalidCleartextLength(uint256 actual);
    error InvalidState();
    error InvalidTiming();
    error ParticipantsNotSynced();
    error RevealWindowActive();
    error RevealWindowClosed();
    error RiskEpochNotAuthorized();
    error SettlementInProgress();
    error StateDeadlineActive();
    error TooEarly();

    enum DrawState {
        IDLE,
        OPEN,
        SWEEP_A,
        AWAIT_TOTAL,
        REVEAL,
        RANDOM_SET,
        SWEEP_B,
        SETTLED
    }

    struct Draw {
        uint64 tStart;
        uint64 tEnd;
        bool strict;
        bool settled;
        bool aborted;
        bool totalsSubmitted;
        bool noWinner;
        euint64 cumRunning;
        euint64 cumBaseRiskRunning;
        euint64 cumYieldRunning;
        euint64 cumPrizeCredits;
        uint64 totalTickets;
        uint64 totalBaseRiskWeight;
        uint64 totalYieldWeight;
        uint64 realisedYield;
        uint64 prizeAmount;
        uint128 directRate;
        euint64 r;
    }

    event DrawAborted(uint64 indexed drawId, DrawState indexed previousState);
    event DrawOpened(uint64 indexed drawId, uint64 tStart, uint64 tEnd, bool strict);
    event DrawSettled(uint64 indexed drawId, uint64 realisedYield, uint64 prizeAmount);
    event PrizeCredited(uint64 indexed drawId, address indexed user);
    event RandomnessCommitted(uint64 indexed drawId, bytes32 indexed handle, uint256 indexed blockNumber);

    uint64 public constant MIN_DRAW_PERIOD = 60 seconds;
    uint64 public constant MAX_DRAW_PERIOD = 1 << 20;
    uint64 public constant MIN_SETTLE_DELAY_FLOOR = 24 seconds;
    uint64 public constant MIN_REVEAL_WINDOW = 120 seconds;
    uint64 public constant MIN_STATE_TIMEOUT = 300 seconds;
    uint256 public constant BATCH_A_MAX = 3;
    uint256 public constant BATCH_B_MAX = 2;
    uint256 public constant PRESYNC_BATCH_MAX = 4;
    uint256 public constant MIN_PARTICIPANTS = 5;
    uint8 public constant TICKET_SCALE_BITS = 26;
    uint16 public constant FORTUNE_CAP = 52;
    uint64 public constant FORTUNE_STEP = 43_303_842_570_871;

    ILokVault public immutable vault;
    uint64 public immutable DRAW_PERIOD;
    uint64 public immutable MIN_SETTLE_DELAY;
    uint64 public immutable REVEAL_WINDOW;
    uint64 public immutable STATE_TIMEOUT;
    DrawState public state;
    uint64 public drawId;
    uint64 public stateDeadline;
    uint64 public revealDeadline;
    bytes32 public revealAcc;
    uint256 public cursor;
    uint256 public preSyncCursor;
    uint256 public participantSnapshot;
    bool public paused;

    mapping(uint64 id => Draw draw) private _draws;
    mapping(uint64 id => mapping(address user => bytes32 commitment)) public entropyCommit;
    mapping(uint64 id => mapping(address user => bool revealed)) public entropyRevealed;
    mapping(uint64 id => mapping(address user => euint64 credit)) public prizeCredit;
    mapping(uint64 id => mapping(address user => euint64 weight)) private _directWeight;
    mapping(uint64 id => mapping(address user => euint64 start)) private _rangeStart;
    mapping(uint64 id => mapping(address user => euint64 end)) private _rangeEnd;
    euint64 private _nonDustRunning;

    constructor(
        ILokVault vault_,
        address initialOwner,
        uint64 drawPeriod_,
        uint64 minSettleDelay_,
        uint64 revealWindow_,
        uint64 stateTimeout_
    ) Ownable(initialOwner) {
        if (address(vault_) == address(0) || initialOwner == address(0)) revert InvalidAddress();
        if (
            drawPeriod_ < MIN_DRAW_PERIOD ||
            drawPeriod_ > MAX_DRAW_PERIOD ||
            minSettleDelay_ < MIN_SETTLE_DELAY_FLOOR ||
            revealWindow_ < MIN_REVEAL_WINDOW ||
            stateTimeout_ < MIN_STATE_TIMEOUT
        ) revert InvalidTiming();
        vault = vault_;
        DRAW_PERIOD = drawPeriod_;
        MIN_SETTLE_DELAY = minSettleDelay_;
        REVEAL_WINDOW = revealWindow_;
        STATE_TIMEOUT = stateTimeout_;
    }

    function openDraw(bool strict) external nonReentrant {
        if (paused) revert DrawsPaused();
        if (state != DrawState.IDLE && state != DrawState.SETTLED) revert InvalidState();
        if (vault.restricted() || vault.lastSolventRiskEpoch() != vault.riskEpoch()) {
            revert RiskEpochNotAuthorized();
        }

        ++drawId;
        uint64 start = uint64(block.timestamp);
        uint64 end = start + DRAW_PERIOD;
        Draw storage draw = _draws[drawId];
        draw.tStart = start;
        draw.tEnd = end;
        draw.strict = strict;
        draw.cumRunning = FHE.asEuint64(0);
        draw.cumBaseRiskRunning = FHE.asEuint64(0);
        draw.cumYieldRunning = FHE.asEuint64(0);
        draw.cumPrizeCredits = FHE.asEuint64(0);
        _nonDustRunning = FHE.asEuint64(0);
        _persistPassA(draw);
        FHE.allowThis(draw.cumPrizeCredits);
        FHE.allowThis(_nonDustRunning);

        state = DrawState.OPEN;
        stateDeadline = end + MIN_SETTLE_DELAY + STATE_TIMEOUT;
        revealDeadline = 0;
        revealAcc = bytes32(0);
        cursor = 0;
        preSyncCursor = 0;
        participantSnapshot = vault.participantCount();
        vault.onDrawOpened(drawId, start, end);
        emit DrawOpened(drawId, start, end, strict);
    }

    function pauseDraws() external onlyOwner nonReentrant {
        paused = true;
    }

    function unpauseDraws() external onlyOwner nonReentrant {
        paused = false;
    }

    function abortDraw() external nonReentrant {
        DrawState previous = state;
        if (previous == DrawState.IDLE || previous == DrawState.SETTLED) revert InvalidState();
        if (previous == DrawState.SWEEP_B && cursor > 0) revert SettlementInProgress();
        if (block.timestamp < stateDeadline) revert StateDeadlineActive();

        _draws[drawId].aborted = true;
        vault.onDrawClosed(drawId);
        state = DrawState.IDLE;
        stateDeadline = 0;
        revealDeadline = 0;
        revealAcc = bytes32(0);
        cursor = 0;
        preSyncCursor = 0;
        participantSnapshot = 0;
        emit DrawAborted(drawId, previous);
    }

    function remainingInSweep() external view returns (uint256) {
        if (state != DrawState.SWEEP_A && state != DrawState.SWEEP_B) return 0;
        return participantSnapshot - cursor;
    }

    function drawInfo(uint64 id) external view returns (Draw memory) {
        return _draws[id];
    }

    function batchCaps() external pure returns (uint256 a, uint256 b) {
        return (BATCH_A_MAX, BATCH_B_MAX);
    }

    function preSyncA(uint256 batch) external nonReentrant {
        if (state != DrawState.OPEN && state != DrawState.SWEEP_A) revert InvalidState();
        if (batch == 0 || batch > PRESYNC_BATCH_MAX) revert BatchOutOfRange();

        Draw storage draw = _draws[drawId];
        if (block.timestamp < draw.tEnd) revert TooEarly();
        if (preSyncCursor >= participantSnapshot) revert InvalidState();

        uint256 end = preSyncCursor + batch;
        if (end > participantSnapshot) end = participantSnapshot;
        address[] memory users = new address[](end - preSyncCursor);
        for (uint256 i = preSyncCursor; i < end; ++i) {
            users[i - preSyncCursor] = vault.participantAt(i);
        }
        vault.preSync(users);
        preSyncCursor = end;
        stateDeadline = uint64(block.timestamp) + STATE_TIMEOUT;
    }

    function commitEntropy(bytes32 commitment) external nonReentrant {
        Draw storage draw = _draws[drawId];
        if (state != DrawState.OPEN || !draw.strict) revert InvalidState();
        if (block.timestamp >= draw.tEnd) revert TooEarly();
        entropyCommit[drawId][msg.sender] = commitment;
    }

    function revealEntropy(bytes32 entropy, bytes32 salt) external nonReentrant {
        if (state != DrawState.REVEAL) revert InvalidState();
        if (block.timestamp >= revealDeadline) revert RevealWindowClosed();
        if (entropyRevealed[drawId][msg.sender]) revert AlreadyRevealed();
        if (keccak256(abi.encodePacked(entropy, salt)) != entropyCommit[drawId][msg.sender]) {
            revert CommitmentMismatch();
        }
        entropyRevealed[drawId][msg.sender] = true;
        revealAcc = revealAcc ^ entropy;
    }

    function enterReveal() external nonReentrant {
        Draw storage draw = _draws[drawId];
        if (state != DrawState.AWAIT_TOTAL || !draw.strict || !draw.totalsSubmitted || draw.totalTickets == 0)
            revert InvalidState();
        revealAcc = bytes32(0);
        revealDeadline = uint64(block.timestamp) + REVEAL_WINDOW;
        stateDeadline = revealDeadline + STATE_TIMEOUT;
        state = DrawState.REVEAL;
    }

    function crankA(uint256 batch) external nonReentrant {
        if (state != DrawState.OPEN && state != DrawState.SWEEP_A) revert InvalidState();
        if (batch == 0 || batch > BATCH_A_MAX) revert BatchOutOfRange();

        Draw storage draw = _draws[drawId];
        if (block.timestamp < draw.tEnd + MIN_SETTLE_DELAY) revert TooEarly();
        if (participantSnapshot == 0) {
            state = DrawState.SWEEP_A;
            stateDeadline = uint64(block.timestamp) + STATE_TIMEOUT;
            _completePassA(draw);
            return;
        }
        _crankAUsers(draw, batch);
    }

    function _crankAUsers(Draw storage draw, uint256 batch) private {
        if (cursor >= participantSnapshot) revert InvalidState();

        state = DrawState.SWEEP_A;
        uint256 end = cursor + batch;
        if (end > participantSnapshot) end = participantSnapshot;
        if (end > preSyncCursor) revert ParticipantsNotSynced();
        for (uint256 i = cursor; i < end; ++i) {
            _processPassA(draw, vault.participantAt(i));
        }
        cursor = end;
        stateDeadline = uint64(block.timestamp) + STATE_TIMEOUT;

        if (end == participantSnapshot) {
            _completePassA(draw);
        }
    }

    function submitTotals(bytes calldata abiEncodedCleartexts, bytes calldata decryptionProof) external nonReentrant {
        if (state != DrawState.AWAIT_TOTAL) revert InvalidState();
        if (abiEncodedCleartexts.length != 96) revert InvalidCleartextLength(abiEncodedCleartexts.length);

        Draw storage draw = _draws[drawId];
        bytes32[] memory handles = new bytes32[](3);
        handles[0] = FHE.toBytes32(draw.cumRunning);
        handles[1] = FHE.toBytes32(draw.cumBaseRiskRunning);
        handles[2] = FHE.toBytes32(draw.cumYieldRunning);
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof);

        (uint64 totalTickets, uint64 totalBaseRiskWeight, uint64 totalYieldWeight) = abi.decode(
            abiEncodedCleartexts,
            (uint64, uint64, uint64)
        );
        draw.totalTickets = totalTickets;
        draw.totalBaseRiskWeight = totalBaseRiskWeight;
        draw.totalYieldWeight = totalYieldWeight;
        draw.totalsSubmitted = true;

        if (totalYieldWeight == 0) {
            draw.settled = true;
            vault.onDrawClosed(drawId);
            state = DrawState.IDLE;
            stateDeadline = 0;
            revealDeadline = 0;
            cursor = 0;
            preSyncCursor = 0;
            participantSnapshot = 0;
            emit DrawSettled(drawId, 0, 0);
            return;
        }

        uint64 realisedYield = vault.harvestRealisedYield();
        draw.realisedYield = realisedYield;
        draw.prizeAmount = uint64((uint256(realisedYield) * uint256(totalBaseRiskWeight)) / uint256(totalYieldWeight));
        draw.directRate = uint128((uint256(realisedYield) << TICKET_SCALE_BITS) / uint256(totalYieldWeight));
        draw.noWinner = totalTickets == 0;
        cursor = 0;
        stateDeadline = uint64(block.timestamp) + STATE_TIMEOUT;

        if (draw.noWinner) {
            state = DrawState.SWEEP_B;
        } else if (!draw.strict) {
            state = DrawState.RANDOM_SET;
        }
    }

    function openRandom() external nonReentrant {
        Draw storage draw = _draws[drawId];
        if (!draw.totalsSubmitted || draw.totalTickets == 0) revert InvalidState();
        if (draw.strict) {
            if (state != DrawState.REVEAL) revert InvalidState();
            if (block.timestamp < revealDeadline) revert RevealWindowActive();
        } else if (state != DrawState.RANDOM_SET) {
            revert InvalidState();
        }

        euint64 raw = FHE.randEuint64();
        if (draw.strict) {
            raw = FHE.xor(raw, uint64(uint256(revealAcc)));
        }
        draw.r = FHE.rem(raw, draw.totalTickets);
        FHE.allowThis(draw.r);
        emit RandomnessCommitted(drawId, FHE.toBytes32(draw.r), block.number);

        cursor = 0;
        stateDeadline = uint64(block.timestamp) + STATE_TIMEOUT;
        state = DrawState.SWEEP_B;
    }

    function crankB(uint256 batch) external nonReentrant {
        if (state != DrawState.SWEEP_B) revert InvalidState();
        if (batch == 0 || batch > BATCH_B_MAX) revert BatchOutOfRange();
        if (cursor >= participantSnapshot) revert InvalidState();

        Draw storage draw = _draws[drawId];
        uint256 end = cursor + batch;
        if (end > participantSnapshot) end = participantSnapshot;
        for (uint256 i = cursor; i < end; ++i) {
            _processPassB(draw, vault.participantAt(i));
        }
        cursor = end;
        stateDeadline = uint64(block.timestamp) + STATE_TIMEOUT;

        if (end == participantSnapshot) {
            _completePassB(draw);
        }
    }

    function _processPassB(Draw storage draw, address user) private {
        ebool win;
        if (draw.noWinner) {
            win = FHE.asEbool(false);
        } else {
            win = FHE.and(FHE.le(_rangeStart[drawId][user], draw.r), FHE.lt(draw.r, _rangeEnd[drawId][user]));
        }

        euint64 userPrize = FHE.select(win, FHE.asEuint64(draw.prizeAmount), FHE.asEuint64(0));
        euint128 directWide = FHE.mul(FHE.asEuint128(_directWeight[drawId][user]), draw.directRate);
        euint64 directCredit = FHE.asEuint64(FHE.shr(directWide, TICKET_SCALE_BITS));
        prizeCredit[drawId][user] = userPrize;
        draw.cumPrizeCredits = FHE.add(draw.cumPrizeCredits, userPrize);

        FHE.allowThis(userPrize);
        FHE.allow(userPrize, user);
        FHE.allowThis(draw.cumPrizeCredits);
        FHE.allowTransient(userPrize, address(vault));
        FHE.allowTransient(directCredit, address(vault));
        FHE.allowTransient(win, address(vault));
        vault.creditDraw(user, userPrize, directCredit, win);
        emit PrizeCredited(drawId, user);
    }

    function _completePassB(Draw storage draw) private {
        FHE.makePubliclyDecryptable(draw.cumPrizeCredits);
        if (!draw.noWinner) {
            FHE.makePubliclyDecryptable(draw.r);
        }
        draw.settled = true;
        vault.onDrawClosed(drawId);
        state = DrawState.SETTLED;
        stateDeadline = 0;
        cursor = participantSnapshot;
        emit DrawSettled(drawId, draw.realisedYield, draw.prizeAmount);
    }

    function _processPassA(Draw storage draw, address user) private {
        (euint128 ticketDelta, euint128 yieldDelta, euint16 fortune) = vault.drawInputsFor(user);

        euint64 baseRisk = FHE.asEuint64(FHE.shr(ticketDelta, TICKET_SCALE_BITS + 2));
        euint64 yieldWeight = FHE.asEuint64(FHE.shr(yieldDelta, TICKET_SCALE_BITS));
        euint64 directWeight = FHE.sub(yieldWeight, baseRisk);
        euint64 boundedFortune = FHE.min(FHE.asEuint64(fortune), FHE.asEuint64(uint64(FORTUNE_CAP)));
        euint64 proportional = FHE.div(FHE.mul(baseRisk, boundedFortune), uint64(2 * FORTUNE_CAP));
        euint64 boost = FHE.min(proportional, FHE.shr(baseRisk, 1));
        euint64 effective = FHE.add(baseRisk, boost);

        _directWeight[drawId][user] = directWeight;
        _rangeStart[drawId][user] = draw.cumRunning;
        draw.cumRunning = FHE.add(draw.cumRunning, effective);
        draw.cumBaseRiskRunning = FHE.add(draw.cumBaseRiskRunning, baseRisk);
        draw.cumYieldRunning = FHE.add(draw.cumYieldRunning, yieldWeight);
        _rangeEnd[drawId][user] = draw.cumRunning;

        ebool nonDust = FHE.gt(yieldWeight, 0);
        _nonDustRunning = FHE.add(_nonDustRunning, FHE.select(nonDust, FHE.asEuint64(1), FHE.asEuint64(0)));
        _persistPassA(draw);
        FHE.allowThis(_directWeight[drawId][user]);
        FHE.allowThis(_rangeStart[drawId][user]);
        FHE.allowThis(_rangeEnd[drawId][user]);
        FHE.allowThis(_nonDustRunning);
        vault.rollCheckpoint(user);
    }

    function _completePassA(Draw storage draw) private {
        ebool enough = FHE.ge(_nonDustRunning, uint64(MIN_PARTICIPANTS));
        euint64 zero = FHE.asEuint64(0);
        // Distinct identity operations keep the three-handle proof tuple stable when every total is zero.
        draw.cumRunning = FHE.add(FHE.select(enough, draw.cumRunning, zero), uint64(0));
        draw.cumBaseRiskRunning = FHE.sub(FHE.select(enough, draw.cumBaseRiskRunning, zero), uint64(0));
        draw.cumYieldRunning = FHE.xor(FHE.select(enough, draw.cumYieldRunning, zero), uint64(0));
        _persistPassA(draw);
        FHE.makePubliclyDecryptable(draw.cumRunning);
        FHE.makePubliclyDecryptable(draw.cumBaseRiskRunning);
        FHE.makePubliclyDecryptable(draw.cumYieldRunning);
        state = DrawState.AWAIT_TOTAL;
    }

    function _persistPassA(Draw storage draw) private {
        FHE.allowThis(draw.cumRunning);
        FHE.allowThis(draw.cumBaseRiskRunning);
        FHE.allowThis(draw.cumYieldRunning);
    }
}
