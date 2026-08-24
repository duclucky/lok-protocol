import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const wasmFiles = filesUnder(root).filter((path) => path.endsWith(".wasm"));
if (wasmFiles.length === 0) {
  throw new Error("Production build emitted no FHEVM WASM assets.");
}

const emptyWasm = wasmFiles.filter((path) => statSync(path).size === 0);
if (emptyWasm.length > 0) {
  throw new Error(`Production build emitted empty FHEVM WASM assets: ${emptyWasm.join(", ")}`);
}

const mainChunks = filesUnder(join(root, "assets")).filter((path) => /[\\/]index-[^\\/]+\.js$/.test(path));
if (mainChunks.length !== 1) {
  throw new Error(`Expected exactly one initial index chunk, found ${mainChunks.length}.`);
}

const mainChunkBytes = statSync(mainChunks[0]).size;
const mainChunkCap = 925_000;
if (mainChunkBytes > mainChunkCap) {
  throw new Error(`Initial route chunk is ${mainChunkBytes} bytes; cap is ${mainChunkCap} bytes.`);
}

console.log(
  `Verified ${wasmFiles.length} non-empty FHEVM WASM assets and ${mainChunkBytes}-byte initial route chunk.`,
);
