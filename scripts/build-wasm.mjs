import {
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { resolve } from "node:path";
const out = "packages/optimizer-wasm/dist";
mkdirSync(out, { recursive: true });
const emcc =
  process.platform === "win32"
    ? ".toolchains/emsdk/upstream/emscripten/em++.exe"
    : ".toolchains/emsdk/upstream/emscripten/em++";
const r = spawnSync(
  resolve(emcc),
  [
    "packages/optimizer-wasm/bindings.cpp",
    "-std=c++17",
    "-O3",
    "--bind",
    "--no-entry",
    "-fexceptions",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sENVIRONMENT=worker",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sFILESYSTEM=0",
    "-sMAXIMUM_MEMORY=536870912",
    "-o",
    out + "/engine.mjs",
  ],
  { stdio: "inherit", shell: false },
);
if (r.status !== 0) process.exit(r.status || 1);
await build({
  entryPoints: ["packages/optimizer-wasm/worker.ts"],
  outfile: out + "/worker.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["./engine.mjs"],
});
const profiles = JSON.parse(
  readFileSync("packages/optimizer/flexo/profiles.json", "utf8"),
);
const slim = {};
for (const [n, p] of Object.entries(profiles.profiles)) {
  slim[n] = {};
  for (const name of ["low", "medium", "high"])
    slim[n][name] = p.frontier.find((x) => x.id === p.presets[name]).parameters;
  if (slim[n].low.evaluations > slim[n].medium.evaluations)
    slim[n].low = slim[n].medium;
}
writeFileSync("apps/web/lib/profiles.json", JSON.stringify(slim, null, 2));
// apps/web/lib/industry.json is curated UI data, not the research hue-level fixture.

const hash = createHash("sha256");
for (const name of ["engine.mjs", "engine.wasm", "worker.mjs"])
  hash.update(readFileSync(out + "/" + name));
const version = hash.digest("hex").slice(0, 16);
const publicRoot = resolve("apps/web/public/optimizer");
const expected = resolve("apps/web/public") + "/optimizer";
if (publicRoot.replaceAll("\\", "/") !== expected.replaceAll("\\", "/"))
  throw Error("Unexpected asset path");
rmSync(publicRoot, { recursive: true, force: true });
const target = publicRoot + "/" + version;
mkdirSync(target, { recursive: true });
for (const name of ["engine.mjs", "engine.wasm", "worker.mjs"])
  copyFileSync(out + "/" + name, target + "/" + name);
writeFileSync(
  "apps/web/lib/engine-manifest.json",
  JSON.stringify(
    {
      version,
      workerUrl: "/optimizer/" + version + "/worker.mjs",
      profileVersion: createHash("sha256")
        .update(readFileSync("packages/optimizer/flexo/profiles.json"))
        .update("monotonic-presets-v1")
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
