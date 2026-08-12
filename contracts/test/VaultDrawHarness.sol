/* solhint-disable one-contract-per-file, use-natspec, immutable-vars-naming */
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {FHE, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IVaultDrawHarnessTarget {
    function creditDraw(address user, euint64 prizeCredit, euint64 directCredit, ebool win) external;
}

contract VaultDrawHarness is ZamaEthereumConfig {
    IVaultDrawHarnessTarget public immutable vault;

    constructor(IVaultDrawHarnessTarget vault_) {
        vault = vault_;
    }

    function credit(address user, uint64 prize, uint64 direct) external {
        euint64 prizeCredit = FHE.asEuint64(prize);
        euint64 directCredit = FHE.asEuint64(direct);
        ebool win = FHE.asEbool(prize != 0);
        FHE.allowTransient(prizeCredit, address(vault));
        FHE.allowTransient(directCredit, address(vault));
        FHE.allowTransient(win, address(vault));
        vault.creditDraw(user, prizeCredit, directCredit, win);
    }
}
