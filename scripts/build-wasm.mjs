import {
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { compileWasm } from "./compile-wasm.mjs";
const out = "packages/optimizer-wasm/dist";
await compileWasm(out);
const summaryPath = "packages/optimizer/docs/fixed-budget-summary.json";
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const slim = {};
for (const [size, budgets] of Object.entries(summary.campaign.budgets)) {
  slim[size] = {};
  for (const [name, budget] of Object.entries(budgets)) {
    const parameters = summary.sizes[size].completed[budget]?.parameters;
    if (!parameters || parameters.evaluations !== budget)
      throw Error(`Missing completed tuning winner: ${size} / ${name}`);
    slim[size][name] = parameters;
  }
}
writeFileSync(
  "apps/web/lib/profiles.json",
  JSON.stringify(slim, null, 2) + "\n",
);
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
        .update(readFileSync(summaryPath))
        .update("fixed-budget-presets-v1")
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
