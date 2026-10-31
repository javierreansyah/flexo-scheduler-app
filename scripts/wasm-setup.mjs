import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) process.exit(r.status || 1);
}
if (!existsSync(".toolchains/emsdk"))
  run("git", [
    "clone",
    "--depth",
    "1",
    "https://github.com/emscripten-core/emsdk.git",
    ".toolchains/emsdk",
  ]);
const python =
  process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
for (const action of ["install", "activate"])
  run(python, [resolve(".toolchains/emsdk/emsdk.py"), action, "6.0.13"]);
