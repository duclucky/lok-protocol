import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const expected = new Map([
  ["tfhe_bg.v1.5.3.wasm", "dd349c2e34834527890a80e1b70bf5ee57a02aabb7f65e32a1bca654db9201ec"],
  ["tfhe_bg.v1.6.2.wasm", "ecd1841ad42226629c1a665ba784e073f2e780137f7986b00088c9227acb9760"],
  ["kms_lib_bg.v0.13.10.wasm", "31cfb31392445ae2630f560b961edd21c72e40d58cb20c455f9fc4d4750bb9a0"],
  ["kms_lib_bg.v0.13.20-0.wasm", "be54c8f11daf048b897b41cf6e6735895490cdca77f2a01c01be0d6fbf369c81"],
]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    if ((await stat(path)).isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

const dist = resolve(process.argv[2] ?? "frontend/dist");
const files = await walk(dist);
const emitted = new Map(files.map((path) => [path.split(/[\\/]/).at(-1), path]));

for (const [name, digest] of expected) {
  const path = emitted.get(name);
  if (path === undefined) throw new Error(`Missing verified FHEVM WASM asset: ${name}`);
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== digest) throw new Error(`FHEVM WASM hash mismatch for ${name}`);
}

console.log(`Verified FHEVM WASM assets: ${[...expected.keys()].map((name) => emitted.get(name)).join(", ")}`);
