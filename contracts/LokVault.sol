/* solhint-disable use-natspec, max-states-count, immutable-vars-naming, gas-strict-inequalities */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {
    FHE,
    ebool,
    euint8,
    euint16,
    euint64,
    euint128,
    externalEuint8,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IYieldAdapter} from "./interfaces/IYieldAdapter.sol";

interface IBoundYieldAdapter is IYieldAdapter {
    function vault() external view returns (address);
}

interface ILokERC20Wrapper is IERC7984ERC20Wrapper {
    function unwrap(address from, address to, euint64 amount) external returns (bytes32);
}

contract LokVault is ZamaEthereumConfig, Ownable2Step, ReentrancyGuard {
    error AdapterAssetMismatch();
    error AdapterNotBound();
    error AdapterNotDrained();
    error AdapterProposalMissing();
    error AdapterTimelockActive();
    error DrawManagerAlreadySet();
    error DrawNotIdle();
    error ExitAlreadyPending();
    error ExitRequestMissing();
    error InvalidAddress();
    error InvalidCleartextLength(uint256 actual);
    error InvalidDrawWindow();
    error NoPendingCheckpoint();
    error NoRetiringAdapter();
    error OnlyDrawManager();
    error ParticipantRemovalNotPending();
    error RetiringAdapterExists();
    error RiskEpochNotSolvent();
    error SyncBatchTooLarge(uint256 actual, uint256 maximum);
    error WrongEpoch(uint64 expected, uint64 actual);
    error WrongNonce(uint64 expected, uint64 actual);

    event AdapterActivated(address indexed active, address indexed retiring, uint64 indexed riskEpoch);
    event AdapterProposed(address indexed adapter, uint64 indexed activateAfter);
    event AdapterRetired(address indexed adapter, uint64 indexed riskEpoch);
    event Deposited(address indexed user);
    event DrawManagerSet(address indexed drawManager);
    event ExitFinalized(address indexed user, bytes32 indexed requestId);
    event ExitRequested(address indexed user, bytes32 indexed requestId);
    event SolvencyCheckpointOpened(uint64 indexed riskEpoch, uint64 indexed nonce, bytes32 indexed handle);
    event SolvencyCheckpointSubmitted(uint64 indexed riskEpoch, uint64 indexed nonce, bool indexed isSolvent);
    event ThetaChanged(address indexed user);
    event Withdrawn(address indexed user);

    uint64 public constant ADAPTER_DELAY = 1 days;
    uint8 public constant THETA_DENOM = 4;
    uint8 public constant TICKET_SCALE_BITS = 26;
    uint128 public constant RATE_CAP = 1 << 52;
    uint256 public constant PRESYNC_CAP = 4;

    IERC7984 public immutable cToken;
    address public drawManager;

    mapping(address user => euint64 balance) private _balance;
    mapping(address user => euint64 principalBalance) private _principalBalance;
    mapping(address user => euint128 value) private _accTickets;
    mapping(address user => euint128 value) private _accYield;
    mapping(address user => euint128 value) private _rate;
    mapping(address user => euint8 value) private _theta;
    mapping(address user => euint16 value) private _fortune;
    mapping(address user => bool initialized) private _thetaInitialized;
    mapping(address user => bool initialized) private _fortuneInitialized;
    mapping(address user => uint64 timestamp) public lastUpdate;
    mapping(address user => euint128 value) private _ckptTickets;
    mapping(address user => euint128 value) private _prevCkptTickets;
    mapping(address user => euint128 value) private _ckptYield;
    mapping(address user => euint128 value) private _prevCkptYield;
    mapping(address user => euint128 value) private _drawTicketDelta;
    mapping(address user => euint128 value) private _drawYieldDelta;
    mapping(address user => bool initialized) private _drawWeightInitialized;
    mapping(address user => uint64 drawId) public ckptDrawId;
    mapping(address user => ebool status) private _lastActionStatus;
    euint64 private _encryptedTotalPrincipal;
    euint64 private _encryptedTotalLiability;

    address[] public participants;
    mapping(address participant => uint256 index) public participantIndex;
    mapping(address participant => bool pendingParticipantRemoval) public pendingParticipantRemoval;

    uint64 public accountingVersion;
    uint64 public riskEpoch = 1;
    uint64 public lastSolventRiskEpoch;
    uint64 public pendingSolvencyRiskEpoch;
    uint64 public pendingSolvencyAccountingVersion;
    uint64 public solvencyCheckpointNonce;
    bytes32 public pendingSolvencyHandle;
    bool public hasPendingSolvencyCheckpoint;
    bool public restricted;

    IYieldAdapter public activeAdapter;
    IYieldAdapter public retiringAdapter;
    IYieldAdapter public proposedAdapter;
    uint64 public adapterActivateAfter;
    bool public retiringAdapterDrained;
    bool private _drawIdle = true;

    uint64 public currentDrawId;
    uint64 public currentDrawStart;
    uint64 public currentDrawEnd;

    mapping(address user => bytes32 requestId) public pendingExitRequest;
    mapping(bytes32 requestId => address user) public exitRequestOwner;

    ebool private _pendingSolvencyResult;

    constructor(IERC7984 cToken_, IYieldAdapter initialAdapter, address initialOwner) Ownable(initialOwner) {
        if (address(cToken_) == address(0) || initialOwner == address(0)) revert InvalidAddress();
        if (address(initialAdapter) != address(0) && initialAdapter.asset() != address(cToken_)) {
            revert AdapterAssetMismatch();
        }
        cToken = cToken_;
        activeAdapter = initialAdapter;
    }

    modifier onlyDrawManager() {
        if (msg.sender != drawManager) revert OnlyDrawManager();
        _;
    }

    function setDrawManager(address drawManager_) external onlyOwner {
        if (drawManager != address(0)) revert DrawManagerAlreadySet();
        if (drawManager_ == address(0)) revert InvalidAddress();
        drawManager = drawManager_;
        emit DrawManagerSet(drawManager_);
    }

    function participantCount() external view returns (uint256) {
        return participants.length;
    }

    function participantAt(uint256 index) external view returns (address) {
        return participants[index];
    }

    function confidentialBalanceOf(address user) external view returns (euint64) {
        return _balance[user];
    }

    function principalBalanceOf(address user) external view returns (euint64) {
        return _principalBalance[user];
    }

    function thetaOf(address user) external view returns (euint8) {
        return _theta[user];
    }

    function fortuneOf(address user) external view returns (euint16) {
        return _fortune[user];
    }

    function rateOf(address user) external view returns (euint128) {
        return _rate[user];
    }

    function lastActionStatus(address user) external view returns (ebool) {
        return _lastActionStatus[user];
    }

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external nonReentrant {
        pendingParticipantRemoval[msg.sender] = false;
        _syncUser(msg.sender);
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(cToken));
        euint64 moved = cToken.confidentialTransferFrom(msg.sender, address(this), requested);

        _balance[msg.sender] = FHE.add(_balance[msg.sender], moved);
        _principalBalance[msg.sender] = FHE.add(_principalBalance[msg.sender], moved);
        _encryptedTotalLiability = FHE.add(_encryptedTotalLiability, moved);
        _encryptedTotalPrincipal = FHE.add(_encryptedTotalPrincipal, moved);
        ++accountingVersion;

        _persistUserAccounting(msg.sender);
        _setActionStatus(msg.sender, FHE.eq(moved, requested));
        _recomputeRate(msg.sender);
        if (participantIndex[msg.sender] == 0) {
            participants.push(msg.sender);
            participantIndex[msg.sender] = participants.length;
            _ensureFortune(msg.sender);
            _ensureDrawWeights(msg.sender);
        }

        if (address(activeAdapter) != address(0) && !restricted && lastSolventRiskEpoch == riskEpoch) {
            cToken.confidentialTransfer(address(activeAdapter), moved);
            ++accountingVersion;
        }

        emit Deposited(msg.sender);
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external nonReentrant {
        _syncUser(msg.sender);
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        _withdrawSynced(msg.sender, requested);
    }

    function withdrawAll() external nonReentrant {
        _syncUser(msg.sender);
        _withdrawSynced(msg.sender, _balance[msg.sender]);
    }

    function emergencyWithdraw() external nonReentrant {
        _syncUser(msg.sender);
        _withdrawSynced(msg.sender, _balance[msg.sender]);
    }

    function exit() external nonReentrant {
        if (pendingExitRequest[msg.sender] != bytes32(0)) revert ExitAlreadyPending();
        _syncUser(msg.sender);
        _collectLiquidity();

        euint64 requested = _balance[msg.sender];
        FHE.allowTransient(requested, address(cToken));
        bytes32 requestId = ILokERC20Wrapper(address(cToken)).unwrap(address(this), msg.sender, requested);
        euint64 moved = ILokERC20Wrapper(address(cToken)).unwrapAmount(requestId);

        _debitAccounting(msg.sender, requested, moved);
        pendingExitRequest[msg.sender] = requestId;
        exitRequestOwner[requestId] = msg.sender;
        emit ExitRequested(msg.sender, requestId);
    }

    function finalizeExit(bytes32 requestId, uint64 clearAmount, bytes calldata decryptionProof) external nonReentrant {
        address user = exitRequestOwner[requestId];
        if (user == address(0) || pendingExitRequest[user] != requestId) revert ExitRequestMissing();

        ILokERC20Wrapper(address(cToken)).finalizeUnwrap(requestId, clearAmount, decryptionProof);
        delete pendingExitRequest[user];
        delete exitRequestOwner[requestId];
        if (_drawIdle) {
            _removeParticipant(user);
        } else {
            pendingParticipantRemoval[user] = true;
        }

        emit ExitFinalized(user, requestId);
    }

    function finalizeParticipantRemoval(address user) external {
        if (!_drawIdle) revert DrawNotIdle();
        if (!pendingParticipantRemoval[user]) revert ParticipantRemovalNotPending();
        pendingParticipantRemoval[user] = false;
        _removeParticipant(user);
    }

    function setTheta(externalEuint8 encryptedTheta, bytes calldata inputProof) external nonReentrant {
        _syncUser(msg.sender);
        euint8 supplied = FHE.fromExternal(encryptedTheta, inputProof);
        _theta[msg.sender] = FHE.min(supplied, FHE.asEuint8(THETA_DENOM));
        _thetaInitialized[msg.sender] = true;
        FHE.allowThis(_theta[msg.sender]);
        FHE.allow(_theta[msg.sender], msg.sender);
        _recomputeRate(msg.sender);
        emit ThetaChanged(msg.sender);
    }

    function openSolvencyCheckpoint() external nonReentrant {
        euint64 assets = cToken.confidentialBalanceOf(address(this));
        if (address(activeAdapter) != address(0)) {
            assets = FHE.add(assets, activeAdapter.confidentialAssets());
        }
        if (address(retiringAdapter) != address(0)) {
            assets = FHE.add(assets, retiringAdapter.confidentialAssets());
        }

        _pendingSolvencyResult = FHE.ge(assets, _encryptedTotalLiability);
        FHE.allowThis(_pendingSolvencyResult);
        FHE.makePubliclyDecryptable(_pendingSolvencyResult);

        pendingSolvencyRiskEpoch = riskEpoch;
        pendingSolvencyAccountingVersion = accountingVersion;
        ++solvencyCheckpointNonce;
        pendingSolvencyHandle = FHE.toBytes32(_pendingSolvencyResult);
        hasPendingSolvencyCheckpoint = true;

        emit SolvencyCheckpointOpened(riskEpoch, solvencyCheckpointNonce, pendingSolvencyHandle);
    }

    function submitSolvencyCheckpoint(
        uint64 epoch,
        uint64 nonce,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external nonReentrant {
        if (!hasPendingSolvencyCheckpoint) revert NoPendingCheckpoint();
        if (epoch != riskEpoch || epoch != pendingSolvencyRiskEpoch) revert WrongEpoch(riskEpoch, epoch);
        if (nonce != solvencyCheckpointNonce) revert WrongNonce(solvencyCheckpointNonce, nonce);
        if (abiEncodedCleartexts.length != 32) revert InvalidCleartextLength(abiEncodedCleartexts.length);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingSolvencyHandle;
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof);

        bool isSolvent = abi.decode(abiEncodedCleartexts, (bool));
        hasPendingSolvencyCheckpoint = false;
        if (isSolvent) {
            lastSolventRiskEpoch = riskEpoch;
            restricted = false;
        } else {
            restricted = true;
        }

        emit SolvencyCheckpointSubmitted(epoch, nonce, isSolvent);
    }

    function proposeAdapter(IYieldAdapter adapter) external onlyOwner {
        if (!_drawIdle) revert DrawNotIdle();
        if (restricted || lastSolventRiskEpoch != riskEpoch) revert RiskEpochNotSolvent();
        if (address(retiringAdapter) != address(0)) revert RetiringAdapterExists();
        if (address(adapter) == address(0)) revert InvalidAddress();
        if (adapter.asset() != address(cToken)) revert AdapterAssetMismatch();
        if (IBoundYieldAdapter(address(adapter)).vault() != address(this)) revert AdapterNotBound();

        proposedAdapter = adapter;
        adapterActivateAfter = uint64(block.timestamp) + ADAPTER_DELAY;
        emit AdapterProposed(address(adapter), adapterActivateAfter);
    }

    function activateAdapter() external onlyOwner {
        if (!_drawIdle) revert DrawNotIdle();
        if (restricted || lastSolventRiskEpoch != riskEpoch) revert RiskEpochNotSolvent();
        if (address(proposedAdapter) == address(0)) revert AdapterProposalMissing();
        if (block.timestamp < adapterActivateAfter) revert AdapterTimelockActive();
        if (address(retiringAdapter) != address(0)) revert RetiringAdapterExists();

        retiringAdapter = activeAdapter;
        retiringAdapterDrained = address(retiringAdapter) == address(0);
        activeAdapter = proposedAdapter;
        proposedAdapter = IYieldAdapter(address(0));
        adapterActivateAfter = 0;
        ++riskEpoch;

        emit AdapterActivated(address(activeAdapter), address(retiringAdapter), riskEpoch);
    }

    function drainRetiringAdapter() external nonReentrant {
        if (address(retiringAdapter) == address(0)) revert NoRetiringAdapter();
        retiringAdapter.withdrawAllToVault();
        retiringAdapterDrained = true;
        ++accountingVersion;
    }

    function removeRetiringAdapter() external onlyOwner {
        if (!_drawIdle) revert DrawNotIdle();
        if (!retiringAdapterDrained) revert AdapterNotDrained();
        if (restricted || lastSolventRiskEpoch != riskEpoch) revert RiskEpochNotSolvent();

        address removed = address(retiringAdapter);
        retiringAdapter = IYieldAdapter(address(0));
        retiringAdapterDrained = false;
        ++riskEpoch;
        emit AdapterRetired(removed, riskEpoch);
    }

    function harvestRealisedYield() external onlyDrawManager nonReentrant returns (uint64 realisedYield) {
        if (address(activeAdapter) == address(0)) return 0;
        return activeAdapter.harvest();
    }

    function preSync(address[] calldata users) external onlyDrawManager {
        if (users.length > PRESYNC_CAP) revert SyncBatchTooLarge(users.length, PRESYNC_CAP);
        for (uint256 i; i < users.length; ++i) {
            _syncUser(users[i]);
        }
    }

    function drawWeightsFor(address user) external view returns (euint128 ticketDelta, euint128 yieldDelta) {
        return (_drawTicketDelta[user], _drawYieldDelta[user]);
    }

    function drawInputsFor(
        address user
    ) external onlyDrawManager returns (euint128 ticketDelta, euint128 yieldDelta, euint16 fortune) {
        ticketDelta = _drawTicketDelta[user];
        yieldDelta = _drawYieldDelta[user];
        fortune = _fortune[user];
        FHE.allowTransient(ticketDelta, msg.sender);
        FHE.allowTransient(yieldDelta, msg.sender);
        FHE.allowTransient(fortune, msg.sender);
    }

    function rollCheckpoint(address user) external onlyDrawManager {
        _prevCkptTickets[user] = _ckptTickets[user];
        _prevCkptYield[user] = _ckptYield[user];
        FHE.allowThis(_prevCkptTickets[user]);
        FHE.allowThis(_prevCkptYield[user]);
    }

    function creditDraw(address user, euint64 prizeCredit, euint64 directCredit, ebool win) external onlyDrawManager {
        pendingParticipantRemoval[user] = false;
        _syncUser(user);
        euint64 totalCredit = FHE.add(prizeCredit, directCredit);
        _balance[user] = FHE.add(_balance[user], totalCredit);
        _encryptedTotalLiability = FHE.add(_encryptedTotalLiability, totalCredit);
        euint16 incremented = FHE.min(FHE.add(_fortune[user], FHE.asEuint16(1)), FHE.asEuint16(52));
        _fortune[user] = FHE.select(win, FHE.asEuint16(0), incremented);
        ++accountingVersion;

        _persistUserAccounting(user);
        _recomputeRate(user);
        FHE.allowThis(_fortune[user]);
        FHE.allow(_fortune[user], user);
        FHE.allow(directCredit, user);
    }

    function onDrawOpened(uint64 drawId, uint64 tStart, uint64 tEnd) external onlyDrawManager {
        if (tEnd <= tStart) revert InvalidDrawWindow();
        currentDrawId = drawId;
        currentDrawStart = tStart;
        currentDrawEnd = tEnd;
        _drawIdle = false;
    }

    function onDrawClosed(uint64) external onlyDrawManager {
        _drawIdle = true;
    }

    function _withdrawSynced(address user, euint64 requested) private {
        _collectLiquidity();

        euint64 available = FHE.min(requested, _balance[user]);
        FHE.allowTransient(available, address(cToken));
        euint64 moved = cToken.confidentialTransfer(user, available);
        _debitAccounting(user, requested, moved);
        emit Withdrawn(user);
    }

    function _collectLiquidity() private {
        if (address(activeAdapter) != address(0)) {
            activeAdapter.withdrawAllToVault();
            ++accountingVersion;
        }
        if (address(retiringAdapter) != address(0)) {
            retiringAdapter.withdrawAllToVault();
            retiringAdapterDrained = true;
            ++accountingVersion;
        }
    }

    function _debitAccounting(address user, euint64 requested, euint64 moved) private {
        euint64 principalDebit = FHE.min(moved, _principalBalance[user]);

        _balance[user] = FHE.sub(_balance[user], moved);
        _principalBalance[user] = FHE.sub(_principalBalance[user], principalDebit);
        _encryptedTotalLiability = FHE.sub(_encryptedTotalLiability, moved);
        _encryptedTotalPrincipal = FHE.sub(_encryptedTotalPrincipal, principalDebit);
        ++accountingVersion;

        _persistUserAccounting(user);
        _setActionStatus(user, FHE.eq(moved, requested));
        _recomputeRate(user);
    }

    function _persistUserAccounting(address user) private {
        FHE.allowThis(_balance[user]);
        FHE.allow(_balance[user], user);
        FHE.allowThis(_principalBalance[user]);
        FHE.allow(_principalBalance[user], user);
        FHE.allowThis(_encryptedTotalLiability);
        FHE.allowThis(_encryptedTotalPrincipal);
    }

    function _setActionStatus(address user, ebool status) private {
        _lastActionStatus[user] = status;
        FHE.allowThis(status);
        FHE.allow(status, user);
    }

    function _ensureTheta(address user) private {
        if (_thetaInitialized[user]) return;
        _theta[user] = FHE.asEuint8(THETA_DENOM);
        _thetaInitialized[user] = true;
        FHE.allowThis(_theta[user]);
        FHE.allow(_theta[user], user);
    }

    function _ensureFortune(address user) private {
        if (_fortuneInitialized[user]) return;
        _fortune[user] = FHE.asEuint16(0);
        _fortuneInitialized[user] = true;
        FHE.allowThis(_fortune[user]);
    }

    function _ensureDrawWeights(address user) private {
        if (_drawWeightInitialized[user]) return;
        _drawTicketDelta[user] = FHE.asEuint128(0);
        _drawYieldDelta[user] = FHE.asEuint128(0);
        _drawWeightInitialized[user] = true;
        FHE.allowThis(_drawTicketDelta[user]);
        FHE.allowThis(_drawYieldDelta[user]);
    }

    function _recomputeRate(address user) private {
        _ensureTheta(user);
        euint128 raw = FHE.mul(FHE.asEuint128(_balance[user]), FHE.asEuint128(_theta[user]));
        _rate[user] = FHE.min(raw, FHE.asEuint128(RATE_CAP));
        FHE.allowThis(_rate[user]);
    }

    function _syncUser(address user) private {
        _ensureTheta(user);
        uint64 nowTimestamp = uint64(block.timestamp);
        uint64 previous = lastUpdate[user];
        if (previous == 0) {
            if (currentDrawId != 0 && nowTimestamp >= currentDrawStart) {
                _setDrawStartBaseline(user);
            }
            lastUpdate[user] = nowTimestamp;
            return;
        }

        // Exclude IDLE/settlement time by lazily anchoring each draw at its exact start.
        if (
            currentDrawId != 0 &&
            ckptDrawId[user] != currentDrawId &&
            previous <= currentDrawStart &&
            nowTimestamp >= currentDrawStart
        ) {
            _setDrawStartBaseline(user);
            previous = currentDrawStart;
        }

        if (
            currentDrawId != 0 &&
            previous < currentDrawEnd &&
            nowTimestamp >= currentDrawEnd &&
            ckptDrawId[user] != currentDrawId
        ) {
            _accrue(user, currentDrawEnd - previous);
            _ckptTickets[user] = _accTickets[user];
            _ckptYield[user] = _accYield[user];
            _drawTicketDelta[user] = FHE.sub(_ckptTickets[user], _prevCkptTickets[user]);
            _drawYieldDelta[user] = FHE.sub(_ckptYield[user], _prevCkptYield[user]);
            ckptDrawId[user] = currentDrawId;
            previous = currentDrawEnd;
            _persistCheckpoint(user);
        }

        // Settlement and IDLE time are outside every draw window and need no encrypted roll-forward.
        if (currentDrawId != 0 && ckptDrawId[user] == currentDrawId && nowTimestamp >= currentDrawEnd) {
            lastUpdate[user] = nowTimestamp;
            return;
        }

        if (nowTimestamp > previous) {
            _accrue(user, nowTimestamp - previous);
        }
        lastUpdate[user] = nowTimestamp;
    }

    function _accrue(address user, uint64 elapsed) private {
        euint128 ticketTerm = FHE.mul(_rate[user], uint128(elapsed));
        euint128 yieldTerm = FHE.mul(FHE.asEuint128(_balance[user]), uint128(elapsed));
        _accTickets[user] = FHE.add(_accTickets[user], ticketTerm);
        _accYield[user] = FHE.add(_accYield[user], yieldTerm);
        FHE.allowThis(_accTickets[user]);
        FHE.allowThis(_accYield[user]);
    }

    function _persistCheckpoint(address user) private {
        FHE.allowThis(_ckptTickets[user]);
        FHE.allowThis(_ckptYield[user]);
        FHE.allowThis(_drawTicketDelta[user]);
        FHE.allowThis(_drawYieldDelta[user]);
    }

    function _setDrawStartBaseline(address user) private {
        _prevCkptTickets[user] = _accTickets[user];
        _prevCkptYield[user] = _accYield[user];
        FHE.allowThis(_prevCkptTickets[user]);
        FHE.allowThis(_prevCkptYield[user]);
    }

    function _removeParticipant(address user) private {
        uint256 oneBasedIndex = participantIndex[user];
        if (oneBasedIndex == 0) return;

        uint256 index = oneBasedIndex - 1;
        uint256 lastIndex = participants.length - 1;
        if (index != lastIndex) {
            address movedUser = participants[lastIndex];
            participants[index] = movedUser;
            participantIndex[movedUser] = oneBasedIndex;
        }
        participants.pop();
        delete participantIndex[user];
    }
}
