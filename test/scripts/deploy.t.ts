import { expect } from "chai";
import { keccak256 } from "ethers";

import {
  assertDeploymentManifest,
  buildEtherscanV2Form,
  canReuseDeployment,
  classifyEtherscanResponse,
  etherscanV2Url,
  SEPOLIA_DEPLOYMENT_NAMES,
  type SepoliaDeploymentManifest,
} from "../../scripts/deploy";

const addresses = {
  underlyingToken: "0x0000000000000000000000000000000000000011",
  confidentialToken: "0x0000000000000000000000000000000000000012",
  wrapper: "0x0000000000000000000000000000000000000012",
  yieldAdapter: "0x0000000000000000000000000000000000000013",
  vault: "0x0000000000000000000000000000000000000014",
  drawManager: "0x0000000000000000000000000000000000000015",
  guardian: null,
} as const;

function record(name: string, address: string, args: readonly string[]) {
  return {
    name,
    address,
    constructorArgs: args,
    deployTransactionHash: `0x${name.charCodeAt(0).toString(16).padStart(64, "0")}`,
    deployBlockNumber: 100,
    runtimeBytecodeHash: `0x${name
      .charCodeAt(name.length - 1)
      .toString(16)
      .padStart(64, "0")}`,
    etherscanUrl: `https://sepolia.etherscan.io/address/${address}`,
    verified: true,
  };
}

type ReviewedTiming = {
  drawPeriod: 60;
  minSettleDelay: 24;
  revealWindow: 120;
  stateTimeout: 300;
};

function manifest(): SepoliaDeploymentManifest & { timing: ReviewedTiming } {
  return {
    schemaVersion: 1,
    network: "sepolia",
    chainId: 11155111,
    deployedAt: "2026-08-11T00:00:00.000Z",
    commit: "source-sha256:0123456789abcdef",
    owner: "0x0000000000000000000000000000000000000010",
    timing: {
      drawPeriod: 60,
      minSettleDelay: 24,
      revealWindow: 120,
      stateTimeout: 300,
    },
    versions: {
      fhevm: "0.13",
      fhevmSolidity: "0.11.1",
      fhevmHardhatPlugin: "0.4.2",
      openzeppelinConfidentialContracts: "0.5.2",
      hardhat: "2.28.6",
    },
    addresses,
    contracts: {
      underlyingToken: record("MockUSDC", addresses.underlyingToken, []),
      confidentialToken: record("YieldInjectingERC7984", addresses.confidentialToken, [addresses.underlyingToken]),
      yieldAdapter: record("MockYieldAdapter", addresses.yieldAdapter, [addresses.confidentialToken, addresses.vault]),
      vault: record("LokVault", addresses.vault, [
        addresses.confidentialToken,
        addresses.yieldAdapter,
        addresses.vault,
      ]),
      drawManager: record("LokDrawManager", addresses.drawManager, [
        addresses.vault,
        "0x0000000000000000000000000000000000000010",
        "60",
        "24",
        "120",
        "300",
      ]),
    },
    configuration: {
      adapterVaultBindingTxHash: `0x${"a".repeat(64)}`,
      drawManagerBindingTxHash: `0x${"b".repeat(64)}`,
      solvencyCheckpointOpenTxHash: `0x${"c".repeat(64)}`,
      solvencyCheckpointSubmitTxHash: `0x${"d".repeat(64)}`,
    },
    rolePolicy: {
      guardian: "omitted",
      guardianReason: "No threshold configuration with two independent signers was supplied.",
      ownerPowers: ["pause future draws", "timelocked adapter configuration"],
      demoFundPower: "none",
    },
  };
}

describe("Sepolia deployment manifest", function () {
  it("uses fresh hardhat-deploy identities for the minimum-safe timing deployment", function () {
    expect(SEPOLIA_DEPLOYMENT_NAMES).to.deep.equal({
      underlyingToken: "LokMinimumTimingMockUSDC",
      confidentialToken: "LokMinimumTimingConfidentialToken",
      yieldAdapter: "LokMinimumTimingMockYieldAdapter",
      vault: "LokMinimumTimingVault",
      drawManager: "LokMinimumTimingDrawManager",
    });
  });

  it("builds an Etherscan V2 standard-json verification payload", function () {
    const form = buildEtherscanV2Form({
      apiKey: "secret",
      address: addresses.vault,
      contractName: "contracts/LokVault.sol:LokVault",
      compilerVersion: "0.8.27+commit.40a35a09",
      constructorArguments: "0x1234",
      standardJsonInput: { language: "Solidity", sources: {} },
    });
    expect(Object.fromEntries(form)).to.deep.include({
      apikey: "secret",
      chainid: "11155111",
      module: "contract",
      action: "verifysourcecode",
      contractaddress: addresses.vault,
      codeformat: "solidity-standard-json-input",
      contractname: "contracts/LokVault.sol:LokVault",
      compilerversion: "v0.8.27+commit.40a35a09",
      constructorArguments: "1234",
    });
    expect(etherscanV2Url(form)).to.equal("https://api.etherscan.io/v2/api?chainid=11155111");
  });

  it("classifies Etherscan V2 submission and polling responses", function () {
    expect(classifyEtherscanResponse({ status: "1", message: "OK", result: "guid" })).to.equal("accepted");
    expect(classifyEtherscanResponse({ status: "0", message: "NOTOK", result: "Pending in queue" })).to.equal(
      "pending",
    );
    expect(classifyEtherscanResponse({ status: "1", message: "OK", result: "Pass - Verified" })).to.equal("verified");
    expect(
      classifyEtherscanResponse({ status: "0", message: "NOTOK", result: "Contract source code already verified" }),
    ).to.equal("verified");
    expect(classifyEtherscanResponse({ status: "0", message: "NOTOK", result: "bad input" })).to.equal("failed");
  });

  it("accepts the complete traceability schema", function () {
    expect(() => assertDeploymentManifest(manifest())).not.to.throw();
  });

  it("rejects the wrong chain and incomplete transaction evidence", function () {
    const wrongChain = { ...manifest(), chainId: 31337 };
    expect(() => assertDeploymentManifest(wrongChain)).to.throw("chain ID 11155111");

    const missingTx = manifest();
    missingTx.configuration.drawManagerBindingTxHash = "";
    expect(() => assertDeploymentManifest(missingTx)).to.throw("drawManagerBindingTxHash");
  });

  it("rejects missing, altered, or constructor-inconsistent timing evidence", function () {
    const missingTiming = { ...manifest() } as Partial<ReturnType<typeof manifest>>;
    delete missingTiming.timing;
    expect(() => assertDeploymentManifest(missingTiming)).to.throw("timing");

    const alteredTiming = manifest();
    alteredTiming.timing.drawPeriod = 61 as 60;
    expect(() => assertDeploymentManifest(alteredTiming)).to.throw("timing.drawPeriod");

    const mismatchedConstructor = manifest();
    mismatchedConstructor.contracts.drawManager.constructorArgs = [
      addresses.vault,
      mismatchedConstructor.owner,
      "61",
      "24",
      "120",
      "300",
    ];
    expect(() => assertDeploymentManifest(mismatchedConstructor)).to.throw("constructorArgs");
  });

  it("reuses a deployment only when every recorded contract still has matching bytecode", async function () {
    const value = manifest();
    const codes = new Map<string, string>();
    Object.values(value.contracts).forEach((contract, index) => {
      const code = `0x60${index.toString(16).padStart(2, "0")}`;
      codes.set(contract.address.toLowerCase(), code);
      contract.runtimeBytecodeHash = keccak256(code);
    });

    expect(await canReuseDeployment(value, async (address) => codes.get(address.toLowerCase()) ?? "0x")).to.equal(true);

    codes.set(value.addresses.vault.toLowerCase(), "0x");
    expect(await canReuseDeployment(value, async (address) => codes.get(address.toLowerCase()) ?? "0x")).to.equal(
      false,
    );
  });
});
