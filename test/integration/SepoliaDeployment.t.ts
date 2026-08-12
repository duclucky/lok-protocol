import { expect } from "chai";
import { getAddress } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";

import { assertDeploymentManifest, canReuseDeployment, SepoliaDeploymentManifest } from "../../scripts/deploy";

describe("live Sepolia deployment", function () {
  let manifest: SepoliaDeploymentManifest;

  before(async function () {
    if (network.name !== "sepolia" || fhevm.isMock) this.skip();
    const raw: unknown = JSON.parse(await readFile(path.join(process.cwd(), "deployments", "sepolia.json"), "utf8"));
    assertDeploymentManifest(raw);
    manifest = raw;
  });

  it("matches the recorded bytecode and reviewed contract bindings", async function () {
    expect(await canReuseDeployment(manifest, (address) => ethers.provider.getCode(address))).to.equal(true);

    const token = await ethers.getContractAt("YieldInjectingERC7984", manifest.addresses.confidentialToken);
    const adapter = await ethers.getContractAt("MockYieldAdapter", manifest.addresses.yieldAdapter);
    const vault = await ethers.getContractAt("LokVault", manifest.addresses.vault);
    const draw = await ethers.getContractAt("LokDrawManager", manifest.addresses.drawManager);
    const bindings: Array<[string, string]> = [
      [(await token.getFunction("underlying").staticCall()) as string, manifest.addresses.underlyingToken],
      [(await adapter.getFunction("asset").staticCall()) as string, manifest.addresses.confidentialToken],
      [(await adapter.getFunction("vault").staticCall()) as string, manifest.addresses.vault],
      [(await vault.getFunction("activeAdapter").staticCall()) as string, manifest.addresses.yieldAdapter],
      [(await vault.getFunction("drawManager").staticCall()) as string, manifest.addresses.drawManager],
      [(await draw.getFunction("vault").staticCall()) as string, manifest.addresses.vault],
      [(await adapter.getFunction("owner").staticCall()) as string, manifest.owner],
      [(await vault.getFunction("owner").staticCall()) as string, manifest.owner],
      [(await draw.getFunction("owner").staticCall()) as string, manifest.owner],
    ];
    for (const [actual, expected] of bindings) expect(getAddress(actual)).to.equal(getAddress(expected));
    expect(await draw.getFunction("DRAW_PERIOD").staticCall()).to.equal(BigInt(manifest.timing.drawPeriod));
    expect(await draw.getFunction("MIN_SETTLE_DELAY").staticCall()).to.equal(BigInt(manifest.timing.minSettleDelay));
    expect(await draw.getFunction("REVEAL_WINDOW").staticCall()).to.equal(BigInt(manifest.timing.revealWindow));
    expect(await draw.getFunction("STATE_TIMEOUT").staticCall()).to.equal(BigInt(manifest.timing.stateTimeout));
    expect(await vault.getFunction("restricted").staticCall()).to.equal(false);
    expect(await vault.getFunction("lastSolventRiskEpoch").staticCall()).to.equal(
      await vault.getFunction("riskEpoch").staticCall(),
    );
  });

  it("has the reviewed minimum demo participant set", async function () {
    const vault = await ethers.getContractAt("LokVault", manifest.addresses.vault);
    expect(await vault.getFunction("participantCount").staticCall()).to.be.gte(30n);
  });

  it("contains at least one real settled draw", async function () {
    const draw = await ethers.getContractAt("LokDrawManager", manifest.addresses.drawManager);
    const latestDrawId = (await draw.getFunction("drawId").staticCall()) as bigint;
    let settled = false;
    for (let id = 1n; id <= latestDrawId; id += 1n) {
      const info = await draw.getFunction("drawInfo").staticCall(id);
      if (info.settled === true) {
        settled = true;
        break;
      }
    }
    expect(settled, "no settled Sepolia draw exists").to.equal(true);
  });
});
