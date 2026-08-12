/* solhint-disable max-states-count, use-natspec */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, ebool, euint8, euint16, euint64, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @dev Disposable benchmark contract. Each path mirrors the FHE operation order of its production counterpart.
contract HCUProbe is ZamaEthereumConfig {
    error InvalidIterations(uint256 supplied);

    uint256 public constant MAX_ITERATIONS = 200;
    uint8 private constant TICKET_SCALE_BITS = 26;
    uint16 private constant FORTUNE_CAP = 52;
    uint128 private constant RATE_CAP = 1 << 52;

    euint8 private _theta;
    euint16 private _fortune;
    euint64 private _balance;
    euint64 private _liability;
    euint64 private _vaultAssets;
    euint64 private _activeAssets;
    euint64 private _retiringAssets;
    euint64 private _rangeStart;
    euint64 private _rangeEnd;
    euint64 private _randomPoint;
    euint64 private _directWeight;
    euint128 private _rate;
    euint128 private _accTickets;
    euint128 private _accYield;
    euint128 private _prevTickets;
    euint128 private _prevYield;
    euint128 private _ticketDelta;
    euint128 private _yieldDelta;

    euint64 private _passACumulative;
    euint64 private _passABaseCumulative;
    euint64 private _passAYieldCumulative;
    euint64 private _nonDustCumulative;
    euint64 private _passBPrizeCumulative;
    euint64 private _lastUserValue;
    ebool private _lastSolvency;

    constructor() {
        _theta = FHE.asEuint8(4);
        _fortune = FHE.asEuint16(12);
        _balance = FHE.asEuint64(1_000_000);
        _liability = FHE.asEuint64(900_000);
        _vaultAssets = FHE.asEuint64(500_000);
        _activeAssets = FHE.asEuint64(300_000);
        _retiringAssets = FHE.asEuint64(200_000);
        _rangeStart = FHE.asEuint64(0);
        _rangeEnd = FHE.asEuint64(1_000_000);
        _randomPoint = FHE.asEuint64(500_000);
        _directWeight = FHE.asEuint64(750_000);
        _rate = FHE.asEuint128(4_000_000);
        _accTickets = FHE.asEuint128(1 << 48);
        _accYield = FHE.asEuint128(1 << 49);
        _prevTickets = FHE.asEuint128(1 << 40);
        _prevYield = FHE.asEuint128(1 << 41);
        _ticketDelta = FHE.asEuint128(1 << 46);
        _yieldDelta = FHE.asEuint128(1 << 47);
        _passACumulative = FHE.asEuint64(0);
        _passABaseCumulative = FHE.asEuint64(0);
        _passAYieldCumulative = FHE.asEuint64(0);
        _nonDustCumulative = FHE.asEuint64(0);
        _passBPrizeCumulative = FHE.asEuint64(0);
        _lastUserValue = FHE.asEuint64(0);
        _lastSolvency = FHE.asEbool(true);

        _persistSeeds();
        _persistOutputs();
    }

    function measureSyncUser(uint256 iterations) external {
        _checkIterations(iterations);
        euint128 ticketAccumulator;
        euint128 yieldAccumulator;
        euint128 ticketDelta;
        euint128 yieldDelta;

        for (uint256 i; i < iterations; ++i) {
            euint128 ticketTerm = FHE.mul(_rate, uint128(3_600));
            euint128 yieldTerm = FHE.mul(FHE.asEuint128(_balance), uint128(3_600));
            ticketAccumulator = FHE.add(_accTickets, ticketTerm);
            yieldAccumulator = FHE.add(_accYield, yieldTerm);
            ticketDelta = FHE.sub(ticketAccumulator, _prevTickets);
            yieldDelta = FHE.sub(yieldAccumulator, _prevYield);
            FHE.allowThis(ticketAccumulator);
            FHE.allowThis(yieldAccumulator);
            FHE.allowThis(ticketDelta);
            FHE.allowThis(yieldDelta);
        }

        _ticketDelta = ticketDelta;
        _yieldDelta = yieldDelta;
        FHE.allowThis(_ticketDelta);
        FHE.allowThis(_yieldDelta);
    }

    function measureCrankA(uint256 iterations) external {
        _checkIterations(iterations);
        euint64 cumulative = _passACumulative;
        euint64 baseCumulative = _passABaseCumulative;
        euint64 yieldCumulative = _passAYieldCumulative;
        euint64 nonDustCumulative = _nonDustCumulative;

        for (uint256 i; i < iterations; ++i) {
            euint64 baseRisk = FHE.asEuint64(FHE.shr(_ticketDelta, TICKET_SCALE_BITS + 2));
            euint64 yieldWeight = FHE.asEuint64(FHE.shr(_yieldDelta, TICKET_SCALE_BITS));
            euint64 directWeight = FHE.sub(yieldWeight, baseRisk);
            euint64 boundedFortune = FHE.min(FHE.asEuint64(_fortune), FHE.asEuint64(uint64(FORTUNE_CAP)));
            euint64 proportional = FHE.div(FHE.mul(baseRisk, boundedFortune), uint64(2 * FORTUNE_CAP));
            euint64 boost = FHE.min(proportional, FHE.shr(baseRisk, 1));
            euint64 effective = FHE.add(baseRisk, boost);

            euint64 rangeStart = cumulative;
            cumulative = FHE.add(cumulative, effective);
            baseCumulative = FHE.add(baseCumulative, baseRisk);
            yieldCumulative = FHE.add(yieldCumulative, yieldWeight);
            euint64 rangeEnd = cumulative;
            ebool nonDust = FHE.gt(yieldWeight, 0);
            nonDustCumulative = FHE.add(nonDustCumulative, FHE.select(nonDust, FHE.asEuint64(1), FHE.asEuint64(0)));

            FHE.allowThis(directWeight);
            FHE.allowThis(rangeStart);
            FHE.allowThis(rangeEnd);
        }

        ebool enough = FHE.ge(nonDustCumulative, uint64(5));
        euint64 zero = FHE.asEuint64(0);
        cumulative = FHE.add(FHE.select(enough, cumulative, zero), uint64(0));
        baseCumulative = FHE.sub(FHE.select(enough, baseCumulative, zero), uint64(0));
        yieldCumulative = FHE.xor(FHE.select(enough, yieldCumulative, zero), uint64(0));

        _passACumulative = cumulative;
        _passABaseCumulative = baseCumulative;
        _passAYieldCumulative = yieldCumulative;
        _nonDustCumulative = nonDustCumulative;
        FHE.allowThis(_passACumulative);
        FHE.allowThis(_passABaseCumulative);
        FHE.allowThis(_passAYieldCumulative);
        FHE.allowThis(_nonDustCumulative);
        FHE.makePubliclyDecryptable(_passACumulative);
        FHE.makePubliclyDecryptable(_passABaseCumulative);
        FHE.makePubliclyDecryptable(_passAYieldCumulative);
    }

    function measureCrankB(uint256 iterations) external {
        _checkIterations(iterations);
        euint64 prizeCumulative = _passBPrizeCumulative;
        euint64 liability = _liability;
        euint64 updatedBalance;
        euint16 updatedFortune;

        for (uint256 i; i < iterations; ++i) {
            ebool win = FHE.and(FHE.le(_rangeStart, _randomPoint), FHE.lt(_randomPoint, _rangeEnd));
            euint64 userPrize = FHE.select(win, FHE.asEuint64(250_000), FHE.asEuint64(0));
            euint128 directWide = FHE.mul(FHE.asEuint128(_directWeight), uint128(1 << TICKET_SCALE_BITS));
            euint64 directCredit = FHE.asEuint64(FHE.shr(directWide, TICKET_SCALE_BITS));
            prizeCumulative = FHE.add(prizeCumulative, userPrize);

            euint64 totalCredit = FHE.add(userPrize, directCredit);
            updatedBalance = FHE.add(_balance, totalCredit);
            liability = FHE.add(liability, totalCredit);
            euint16 incremented = FHE.min(FHE.add(_fortune, FHE.asEuint16(1)), FHE.asEuint16(FORTUNE_CAP));
            updatedFortune = FHE.select(win, FHE.asEuint16(0), incremented);
            euint128 recomputedRate = FHE.min(
                FHE.mul(FHE.asEuint128(updatedBalance), FHE.asEuint128(_theta)),
                FHE.asEuint128(RATE_CAP)
            );

            FHE.allowThis(userPrize);
            FHE.allow(userPrize, msg.sender);
            FHE.allowThis(updatedBalance);
            FHE.allowThis(updatedFortune);
            FHE.allow(updatedFortune, msg.sender);
            FHE.allowThis(recomputedRate);
        }

        _passBPrizeCumulative = prizeCumulative;
        _liability = liability;
        _balance = updatedBalance;
        _fortune = updatedFortune;
        _lastUserValue = updatedBalance;
        FHE.allowThis(_passBPrizeCumulative);
        FHE.allowThis(_liability);
        FHE.allowThis(_balance);
        FHE.allowThis(_fortune);
        FHE.allowThis(_lastUserValue);
        FHE.allow(_lastUserValue, msg.sender);
        FHE.makePubliclyDecryptable(_passBPrizeCumulative);
    }

    function measureRandomness(uint256 iterations) external {
        _checkIterations(iterations);
        euint64 reduced;
        for (uint256 i; i < iterations; ++i) {
            euint64 raw = FHE.xor(FHE.randEuint64(), uint64(0xA11CE));
            reduced = FHE.rem(raw, uint64(1_000_003));
        }
        _randomPoint = reduced;
        FHE.allowThis(_randomPoint);
    }

    function measureFortune(uint256 iterations) external {
        _checkIterations(iterations);
        euint16 updated;
        for (uint256 i; i < iterations; ++i) {
            euint16 incremented = FHE.min(FHE.add(_fortune, FHE.asEuint16(1)), FHE.asEuint16(FORTUNE_CAP));
            updated = FHE.select(FHE.asEbool(false), FHE.asEuint16(0), incremented);
            FHE.allowThis(updated);
        }
        _fortune = updated;
        FHE.allowThis(_fortune);
        FHE.allow(_fortune, msg.sender);
    }

    function measureSolvency(uint256 iterations) external {
        _checkIterations(iterations);
        ebool result;
        for (uint256 i; i < iterations; ++i) {
            euint64 assets = FHE.add(_vaultAssets, _activeAssets);
            assets = FHE.add(assets, _retiringAssets);
            result = FHE.ge(assets, _liability);
            FHE.allowThis(result);
        }
        _lastSolvency = result;
        FHE.allowThis(_lastSolvency);
        FHE.makePubliclyDecryptable(_lastSolvency);
    }

    function publicSolvencyHandle() external view returns (bytes32) {
        return FHE.toBytes32(_lastSolvency);
    }

    function userFortuneHandle() external view returns (bytes32) {
        return FHE.toBytes32(_fortune);
    }

    function _checkIterations(uint256 iterations) private pure {
        if (iterations == 0 || iterations > MAX_ITERATIONS) revert InvalidIterations(iterations);
    }

    function _persistSeeds() private {
        FHE.allowThis(_theta);
        FHE.allowThis(_fortune);
        FHE.allowThis(_balance);
        FHE.allowThis(_liability);
        FHE.allowThis(_vaultAssets);
        FHE.allowThis(_activeAssets);
        FHE.allowThis(_retiringAssets);
        FHE.allowThis(_rangeStart);
        FHE.allowThis(_rangeEnd);
        FHE.allowThis(_randomPoint);
        FHE.allowThis(_directWeight);
        FHE.allowThis(_rate);
        FHE.allowThis(_accTickets);
        FHE.allowThis(_accYield);
        FHE.allowThis(_prevTickets);
        FHE.allowThis(_prevYield);
        FHE.allowThis(_ticketDelta);
        FHE.allowThis(_yieldDelta);
    }

    function _persistOutputs() private {
        FHE.allowThis(_passACumulative);
        FHE.allowThis(_passABaseCumulative);
        FHE.allowThis(_passAYieldCumulative);
        FHE.allowThis(_nonDustCumulative);
        FHE.allowThis(_passBPrizeCumulative);
        FHE.allowThis(_lastUserValue);
        FHE.allowThis(_lastSolvency);
    }
}
