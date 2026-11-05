import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";

export async function compileWasm(out, variant = "lto-eh", profile) {
  const variants = {
    profile: ["-flto", "-fwasm-exceptions", "--profiling-funcs"],
    baseline: [],
    lto: ["-flto"],
    eh: ["-fwasm-exceptions"],
    "lto-eh": ["-flto", "-fwasm-exceptions"],
    simd: ["-flto", "-fwasm-exceptions", "-msimd128"],
    instrument: ["-flto", "-fwasm-exceptions", "-fprofile-instr-generate"],
    pgo: ["-flto", "-fwasm-exceptions"],
  };
  if (!Object.hasOwn(variants, variant))
    throw Error("Unknown WASM variant: " + variant);
  if (variant === "pgo" && !profile) throw Error("PGO requires a profile");
  mkdirSync(out, { recursive: true });
  const compiler = resolve(
    ".toolchains/emsdk/upstream/emscripten/em++" +
      (process.platform === "win32" ? ".exe" : ""),
  );
  const flags = variants[variant];
  const args = [
    "packages/optimizer-wasm/bindings.cpp",
    "-std=c++17",
    "-O3",
    "--bind",
    "--no-entry",
    ...(flags.includes("-fwasm-exceptions") ? [] : ["-fexceptions"]),
    ...flags,
    ...(variant === "instrument" ? ["scripts/wasm-profile.cpp"] : []),
    ...(variant === "pgo"
      ? [
          "-fprofile-instr-use=" + resolve(profile),
          "-Werror=profile-instr-out-of-date",
          "-Werror=profile-instr-unprofiled",
        ]
      : []),
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sENVIRONMENT=worker",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sFILESYSTEM=0",
    "-sMAXIMUM_MEMORY=536870912",
    "-o",
    out + "/engine.mjs",
  ];
  const result = spawnSync(compiler, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("WASM compilation failed: " + variant);
  await build({
    entryPoints: ["packages/optimizer-wasm/worker.ts"],
    outfile: out + "/worker.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["./engine.mjs"],
  });
  return { variant, args };
}
