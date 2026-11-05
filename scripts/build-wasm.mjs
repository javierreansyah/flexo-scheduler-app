import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";

const out = resolve("engine/dist");
mkdirSync(out, { recursive: true });
const compiler = resolve(
  ".toolchains/emsdk/upstream/emscripten/em++" +
    (process.platform === "win32" ? ".exe" : ""),
);
if (!existsSync(compiler)) {
  const setup = spawnSync(process.execPath, ["scripts/wasm-setup.mjs"], {
    stdio: "inherit",
    shell: false,
  });
  if (setup.error) throw setup.error;
  if (setup.status !== 0) throw new Error("WASM toolchain setup failed");
}
const result = spawnSync(
  compiler,
  [
    "engine/bindings.cpp",
    "-std=c++17",
    "-O3",
    "--bind",
    "--no-entry",
    "-flto",
    "-fwasm-exceptions",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sENVIRONMENT=worker",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sFILESYSTEM=0",
    "-sMAXIMUM_MEMORY=536870912",
    "-o",
    resolve(out, "engine.mjs"),
  ],
  { stdio: "inherit", shell: false },
);
if (result.error)
  throw new Error("WASM compiler unavailable. Run pnpm wasm:setup first.", {
    cause: result.error,
  });
if (result.status !== 0) throw new Error("WASM compilation failed");
await build({
  entryPoints: ["engine/worker.ts"],
  outfile: resolve(out, "worker.mjs"),
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["./engine.mjs"],
});

const assets = ["engine.mjs", "engine.wasm", "worker.mjs"];
const hash = createHash("sha256");
for (const name of assets) hash.update(readFileSync(resolve(out, name)));
const version = hash.digest("hex").slice(0, 16);
const publicRoot = resolve("public/optimizer");
if (publicRoot !== resolve("public", "optimizer"))
  throw new Error("Unexpected asset path");
rmSync(publicRoot, { recursive: true, force: true });
const target = resolve(publicRoot, version);
mkdirSync(target, { recursive: true });
for (const name of assets)
  copyFileSync(resolve(out, name), resolve(target, name));
writeFileSync(
  "lib/engine-manifest.json",
  JSON.stringify(
    {
      version,
      workerUrl: "/optimizer/" + version + "/worker.mjs",
      profileVersion: createHash("sha256")
        .update(readFileSync("lib/profiles.json"))
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
