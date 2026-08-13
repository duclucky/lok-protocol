import { AbiCoder, BaseContract, keccak256, toBeHex } from "ethers";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

import { read, write } from "./helpers";

type StorageEntry = { label: string; slot: string; type: string };
type StorageType = { value?: string; members?: Array<{ label: string; slot: string }> };

function randomStorageSlot(drawId: bigint): string {
  const buildInfoDirectory = path.resolve("hardhat-artifacts/build-info");
  for (const filename of readdirSync(buildInfoDirectory)) {
    if (!filename.endsWith(".json")) continue;
    const buildInfo = JSON.parse(readFileSync(path.join(buildInfoDirectory, filename), "utf8")) as {
      output?: {
        contracts?: Record<
          string,
          Record<string, { storageLayout?: { storage: StorageEntry[]; types: Record<string, StorageType> } }>
        >;
      };
    };
    const layout = buildInfo.output?.contracts?.["contracts/LokDrawManager.sol"]?.LokDrawManager?.storageLayout;
    if (layout === undefined) continue;
    const draws = layout.storage.find((entry) => entry.label === "_draws");
    if (draws === undefined) throw new Error("_draws storage entry missing");
    const mappingType = layout.types[draws.type];
    const structType = mappingType.value === undefined ? undefined : layout.types[mappingType.value];
    const randomMember = structType?.members?.find((member) => member.label === "r");
    if (randomMember === undefined) throw new Error("Draw.r storage member missing");
    const mappingBase = BigInt(
      keccak256(AbiCoder.defaultAbiCoder().encode(["uint64", "uint256"], [drawId, BigInt(draws.slot)])),
    );
    return toBeHex(mappingBase + BigInt(randomMember.slot), 32);
  }
  throw new Error("LokDrawManager storage layout missing");
}

export async function createDrawRandomHandles(draw: BaseContract, values: bigint[]): Promise<string[]> {
  const factory = await (await ethers.getContractFactory("ForcedEncryptedValueFactory")).deploy();
  await factory.waitForDeployment();
  const handles: string[] = [];
  for (const value of values) {
    await write(factory, "makeFor", [await draw.getAddress(), value]);
    handles.push((await read(factory, "lastHandle")) as string);
  }
  return handles;
}

export async function setDrawRandomHandle(draw: BaseContract, drawId: bigint, handle: string): Promise<void> {
  await network.provider.send("hardhat_setStorageAt", [await draw.getAddress(), randomStorageSlot(drawId), handle]);
  const info = (await read(draw, "drawInfo", [drawId])) as { r: bigint };
  if (toBeHex(info.r, 32).toLowerCase() !== handle.toLowerCase()) throw new Error("forced random handle write failed");
}

export async function forceDrawRandom(draw: BaseContract, drawId: bigint, value: bigint): Promise<void> {
  const [handle] = await createDrawRandomHandles(draw, [value]);
  await setDrawRandomHandle(draw, drawId, handle);
}
