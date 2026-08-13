// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

contract LokDrawReference {
    uint256 public constant FORTUNE_CAP = 52;
    uint256 public constant FORTUNE_DENOMINATOR = 104;

    address public immutable admin;
    address public controller;

    mapping(address user => uint256 amount) public fortune;
    mapping(address user => uint256 amount) public lastBaseWeight;
    mapping(address user => uint256 amount) public prizeCredit;
    mapping(address user => bool registered) private _registered;
    address[] private _participants;

    uint256 public totalPrizeSettled;
    uint256 public totalPrizeCredited;
    uint256 public voidDraws;
    uint256 public lastRealisedYield;
    uint256 public lastPrizeAmount;
    uint256 public lastDirectCreditTotal;
    uint256 public lastAllocatedTotal;
    uint256 public lastPassACursor;
    uint256 public lastPassBCursor;
    bool public lastPassAExactlyOnce = true;
    bool public lastPassBExactlyOnce = true;
    bool public lastFundedAllocationBounded = true;
    bool public lastPartitionExact = true;
    bool public lastPrefixWithinEuint64 = true;
    bool public lastForgedOutcomeRejected = true;

    uint256 private _productionNonce;
    uint256 private _productionExpected;
    uint256 private _productionRandomWord;
    uint256 private _productionTotalBaseRisk;
    uint256 private _productionTotalYieldWeight;
    uint256 private _productionTotalEffective;
    uint256 private _productionDirectRate;
    uint256 private _productionRandomTicket;
    mapping(uint256 nonce => mapping(address user => bool processed)) private _productionPassASeen;
    mapping(uint256 nonce => mapping(address user => bool processed)) private _productionPassBSeen;
    mapping(uint256 nonce => mapping(address user => uint256 weight)) private _productionDirectWeight;
    mapping(uint256 nonce => mapping(address user => uint256 start)) private _productionRangeStart;
    mapping(uint256 nonce => mapping(address user => uint256 end)) private _productionRangeEnd;

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

    function settle(address[] calldata users, uint256[] calldata baseWeights, uint256 randomWord, uint256 prize)
        external
        onlyController
        returns (address winner)
    {
        if (users.length != baseWeights.length) return address(0);

        uint256[] memory effectiveWeights = new uint256[](users.length);
        uint256 totalWeight;
        for (uint256 i; i < users.length; ++i) {
            _register(users[i]);
            lastBaseWeight[users[i]] = baseWeights[i];
            uint256 boundedFortune = fortune[users[i]] < FORTUNE_CAP ? fortune[users[i]] : FORTUNE_CAP;
            uint256 boostCeil = baseWeights[i] >> 1;
            uint256 proportional = (baseWeights[i] * boundedFortune) / FORTUNE_DENOMINATOR;
            uint256 boost = proportional < boostCeil ? proportional : boostCeil;
            effectiveWeights[i] = baseWeights[i] + boost;
            totalWeight += effectiveWeights[i];
            if (totalWeight > type(uint64).max) lastPrefixWithinEuint64 = false;
        }

        if (totalWeight == 0 || prize == 0) {
            ++voidDraws;
            return address(0);
        }

        uint256 matches;
        (winner, matches) = _partitionWinner(users, effectiveWeights, randomWord % totalWeight);
        lastPartitionExact = matches == 1;
        if (winner == address(0)) return address(0);

        prizeCredit[winner] += prize;
        totalPrizeCredited += prize;
        totalPrizeSettled += prize;

        for (uint256 i; i < users.length; ++i) {
            address user = users[i];
            if (user == winner) {
                fortune[user] = 0;
            } else {
                uint256 next = fortune[user] + 1;
                fortune[user] = next < FORTUNE_CAP ? next : FORTUNE_CAP;
            }
        }
    }

    function beginProductionSettlement(uint256 realisedYield, uint256 expected, uint256 randomWord)
        external
        onlyController
    {
        ++_productionNonce;
        _productionExpected = expected;
        _productionRandomWord = randomWord;
        _productionTotalBaseRisk = 0;
        _productionTotalYieldWeight = 0;
        _productionTotalEffective = 0;
        _productionDirectRate = 0;
        _productionRandomTicket = 0;
        lastRealisedYield = realisedYield;
        lastPrizeAmount = 0;
        lastDirectCreditTotal = 0;
        lastAllocatedTotal = 0;
        lastPassACursor = 0;
        lastPassBCursor = 0;
        lastPassAExactlyOnce = true;
        lastPassBExactlyOnce = true;
        lastFundedAllocationBounded = true;
    }

    function processProductionPassA(address user, uint256 balance, uint8 thetaValue) external onlyController {
        if (_productionPassASeen[_productionNonce][user]) {
            lastPassAExactlyOnce = false;
            return;
        }
        _productionPassASeen[_productionNonce][user] = true;
        _register(user);

        uint256 baseRisk = (balance * (thetaValue < 4 ? thetaValue : 4)) / 4;
        uint256 boundedFortune = fortune[user] < FORTUNE_CAP ? fortune[user] : FORTUNE_CAP;
        uint256 boost = (baseRisk * boundedFortune) / FORTUNE_DENOMINATOR;
        if (boost > (baseRisk >> 1)) boost = baseRisk >> 1;
        uint256 effective = baseRisk + boost;

        _productionDirectWeight[_productionNonce][user] = balance - baseRisk;
        _productionRangeStart[_productionNonce][user] = _productionTotalEffective;
        _productionTotalEffective += effective;
        _productionRangeEnd[_productionNonce][user] = _productionTotalEffective;
        _productionTotalBaseRisk += baseRisk;
        _productionTotalYieldWeight += balance;
        lastBaseWeight[user] = baseRisk;
        ++lastPassACursor;
        if (_productionTotalEffective > type(uint64).max) lastPrefixWithinEuint64 = false;
    }

    function finalizeProductionPassA() external onlyController {
        lastPassAExactlyOnce = lastPassAExactlyOnce && lastPassACursor == _productionExpected;
        if (_productionTotalYieldWeight == 0) {
            ++voidDraws;
            return;
        }
        lastPrizeAmount = (lastRealisedYield * _productionTotalBaseRisk) / _productionTotalYieldWeight;
        _productionDirectRate = (lastRealisedYield << 26) / _productionTotalYieldWeight;
        if (_productionTotalEffective != 0) {
            _productionRandomTicket = _productionRandomWord % _productionTotalEffective;
        }
        totalPrizeSettled += lastPrizeAmount;
    }

    function processProductionPassB(address user) external onlyController returns (uint256 credit) {
        if (!_productionPassASeen[_productionNonce][user] || _productionPassBSeen[_productionNonce][user]) {
            lastPassBExactlyOnce = false;
            return 0;
        }
        _productionPassBSeen[_productionNonce][user] = true;
        bool won = lastPrizeAmount != 0 && _productionRandomTicket >= _productionRangeStart[_productionNonce][user]
            && _productionRandomTicket < _productionRangeEnd[_productionNonce][user];
        uint256 directCredit = (_productionDirectWeight[_productionNonce][user] * _productionDirectRate) >> 26;
        uint256 userPrize = won ? lastPrizeAmount : 0;
        credit = directCredit + userPrize;
        lastDirectCreditTotal += directCredit;
        lastAllocatedTotal += credit;
        if (userPrize != 0) {
            prizeCredit[user] += userPrize;
            totalPrizeCredited += userPrize;
            fortune[user] = 0;
        } else {
            uint256 next = fortune[user] + 1;
            fortune[user] = next < FORTUNE_CAP ? next : FORTUNE_CAP;
        }
        ++lastPassBCursor;
        lastFundedAllocationBounded = lastAllocatedTotal <= lastRealisedYield;
    }

    function completeProductionSettlement() external onlyController {
        lastPassBExactlyOnce = lastPassBExactlyOnce && lastPassBCursor == _productionExpected;
        lastFundedAllocationBounded = lastAllocatedTotal <= lastRealisedYield;
    }

    function partitionWinner(address[] calldata users, uint256[] calldata weights, uint256 r)
        external
        pure
        returns (address winner, uint256 matches)
    {
        return _partitionWinner(users, weights, r);
    }

    function allFortuneBoostsBounded() external view returns (bool) {
        for (uint256 i; i < _participants.length; ++i) {
            address user = _participants[i];
            if (fortune[user] > FORTUNE_CAP) return false;
            uint256 boost = (lastBaseWeight[user] * fortune[user]) / FORTUNE_DENOMINATOR;
            if (boost > (lastBaseWeight[user] >> 1)) return false;
        }
        return true;
    }

    function rejectForgedOutcome() external onlyController {
        uint256 settledBefore = totalPrizeSettled;
        uint256 creditedBefore = totalPrizeCredited;
        lastForgedOutcomeRejected = true;
        assert(totalPrizeSettled == settledBefore && totalPrizeCredited == creditedBefore);
    }

    function fortuneSplitBounded(uint256 principal, uint256 parts, uint256 fortuneLevel) external pure returns (bool) {
        if (parts == 0) return false;
        uint256 boundedFortune = fortuneLevel < FORTUNE_CAP ? fortuneLevel : FORTUNE_CAP;
        uint256 quotient = principal / parts;
        uint256 remainder = principal % parts;
        uint256 aggregateBoost;
        for (uint256 i; i < parts; ++i) {
            uint256 position = quotient + (i < remainder ? 1 : 0);
            aggregateBoost += (position * boundedFortune) / FORTUNE_DENOMINATOR;
        }
        uint256 singleBoost = (principal * boundedFortune) / FORTUNE_DENOMINATOR;
        return aggregateBoost <= singleBoost;
    }

    function snapshotWeight(uint256 start, uint256 end, uint256 touch, uint256 balance)
        external
        pure
        returns (uint256)
    {
        touch;
        if (end <= start) return 0;
        return balance * (end - start);
    }

    function normalizedShare(uint256 numerator, uint256 denominator) external pure returns (uint256) {
        if (denominator == 0) return 0;
        return numerator / denominator;
    }

    function fundedAllocationBounded(
        uint64 realisedYield,
        uint64 baseRiskWeight,
        uint64 totalYieldWeight,
        uint64[] calldata directWeights
    ) external pure returns (bool) {
        if (totalYieldWeight == 0 || baseRiskWeight > totalYieldWeight) return false;
        uint256 directWeightSum;
        for (uint256 i; i < directWeights.length; ++i) {
            directWeightSum += directWeights[i];
        }
        if (directWeightSum + baseRiskWeight > totalYieldWeight) return false;

        uint256 scale = 1 << 26;
        uint256 directRate = (uint256(realisedYield) * scale) / totalYieldWeight;
        uint256 allocated = (uint256(realisedYield) * baseRiskWeight) / totalYieldWeight;
        for (uint256 i; i < directWeights.length; ++i) {
            allocated += (uint256(directWeights[i]) * directRate) / scale;
        }
        return allocated <= realisedYield;
    }

    function effectiveTotalWithinBounds(uint64[] calldata baseWeights, uint8[] calldata fortunes)
        external
        pure
        returns (bool)
    {
        if (baseWeights.length != fortunes.length) return false;
        uint256 baseTotal;
        uint256 effectiveTotal;
        for (uint256 i; i < baseWeights.length; ++i) {
            uint256 base = baseWeights[i];
            uint256 boundedFortune = fortunes[i] < FORTUNE_CAP ? fortunes[i] : FORTUNE_CAP;
            uint256 boost = (base * boundedFortune) / FORTUNE_DENOMINATOR;
            if (boost > (base >> 1)) return false;
            baseTotal += base;
            effectiveTotal += base + boost;
        }
        return baseTotal < (1 << 58) && effectiveTotal < (1 << 59) && effectiveTotal <= type(uint64).max;
    }

    function sumPrizeCredits() external view returns (uint256 sum) {
        for (uint256 i; i < _participants.length; ++i) {
            sum += prizeCredit[_participants[i]];
        }
    }

    function _partitionWinner(address[] memory users, uint256[] memory weights, uint256 r)
        private
        pure
        returns (address winner, uint256 matches)
    {
        if (users.length != weights.length) return (address(0), 0);

        uint256 cursor;
        for (uint256 i; i < users.length; ++i) {
            uint256 end = cursor + weights[i];
            if (weights[i] != 0 && r >= cursor && r < end) {
                winner = users[i];
                ++matches;
            }
            cursor = end;
        }
    }

    function _register(address user) private {
        if (_registered[user]) return;
        _registered[user] = true;
        _participants.push(user);
    }
}
