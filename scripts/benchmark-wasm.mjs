import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve, relative, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { compileWasm } from "./compile-wasm.mjs";
const require = createRequire(import.meta.url);
const playwright = require("../apps/web/node_modules/@playwright/test");
const out = "packages/optimizer/tmp/wasm-performance";
mkdirSync(out, { recursive: true });
function run(command, args) {
  const r = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(command + " failed");
}
const python = process.platform === "win32" ? "python" : "python3";
if (!process.argv.includes("--reuse-input"))
  run(python, ["scripts/wasm-benchmark-input.py"]);
const input = JSON.parse(readFileSync(out + "/input.json"));
const manifest = JSON.parse(readFileSync("apps/web/lib/engine-manifest.json"));
mkdirSync(out + "/shipped", { recursive: true });
for (const name of ["engine.mjs", "engine.wasm", "worker.mjs"])
  copyFileSync(
    "apps/web/public/optimizer/" + manifest.version + "/" + name,
    out + "/shipped/" + name,
  );
const builds = [];
for (const variant of [
  "baseline",
  "lto",
  "eh",
  "lto-eh",
  "simd",
  "instrument",
]) {
  console.log("Building " + variant);
  if (
    !process.argv.includes("--reuse-builds") ||
    !existsSync(out + "/" + variant + "/engine.wasm")
  )
    builds.push(await compileWasm(out + "/" + variant, variant));
}
// Measure the exported C++ call inside a worker, excluding message transfer and startup.
writeFileSync(
  out + "/kernel.mjs",
  `
const factory = (await import(new URLSearchParams(location.search).get("engine"))).default;
const core = await factory();
self.onmessage = ({data}) => { try { if(data.profile) {postMessage({profile:Array.from(core.profile())});return;} const seed=core.seeds(data.seed,1)[0]; const t=performance.now();const result=core.run(data.problem,data.parameters,seed);postMessage({result,ms:performance.now()-t});}catch(e){postMessage({error:String(e)});} };
postMessage({ready:true});
`,
);
const base = resolve(out);
const server = createServer((req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Optimizer benchmark</title>");
      return;
    }
    const file = resolve(base, "." + path);
    const rel = relative(base, file);
    if (rel.startsWith("..") || resolve(file) === base)
      throw Error("Invalid path");
    res.setHeader(
      "Content-Type",
      { ".mjs": "text/javascript", ".wasm": "application/wasm" }[
        extname(file)
      ] || "application/json",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browserName =
  process.argv.find((a) => a.startsWith("--browser="))?.split("=")[1] ||
  "chromium";
if (!["chromium", "firefox", "webkit"].includes(browserName))
  throw Error("Invalid browser");
const sourceHash = createHash("sha256");
for (const file of [
  "packages/optimizer/src/engine.h",
  "packages/optimizer/src/moves.h",
  "packages/optimizer/src/solver.h",
  "packages/optimizer-wasm/bindings.cpp",
  "packages/optimizer-wasm/worker.ts",
  "scripts/compile-wasm.mjs",
])
  sourceHash.update(file).update(readFileSync(file));
const report = {
  source_sha256: sourceHash.digest("hex"),
  input_sha256: createHash("sha256")
    .update(readFileSync(out + "/input.json"))
    .digest("hex"),
  compiler_version: spawnSync(
    resolve(
      ".toolchains/emsdk/upstream/emscripten/em++" +
        (process.platform === "win32" ? ".exe" : ""),
    ),
    ["--version"],
    { encoding: "utf8" },
  ).stdout,
  shipped_version: manifest.version,
  native_sha256: input.native_sha256,
  platform: input.platform,
  builds,
  rows: [],
  browsers: {},
};
async function panel(
  page,
  variant,
  cases,
  round,
  app = false,
  profile = false,
) {
  return page.evaluate(
    async ({ variant, cases, round, app, profile }) => {
      const rows = [];
      const request = (w, data) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            w.terminate();
            reject(Error("Worker timeout"));
          }, 120000);
          w.onmessage = ({ data }) => {
            if (data.progress !== undefined) return;
            clearTimeout(timeout);
            data.error ? reject(Error(data.error)) : resolve(data);
          };
          w.onerror = (e) => {
            clearTimeout(timeout);
            reject(Error(e.message));
          };
          w.postMessage(data);
        });
      let worker;
      if (!app) {
        worker = new Worker("/kernel.mjs?engine=/" + variant + "/engine.mjs", {
          type: "module",
        });
        await new Promise((resolve, reject) => {
          worker.onmessage = () => resolve();
          worker.onerror = (e) => reject(Error(e.message));
        });
      }
      try {
        for (const c of cases) {
          if (!app)
            await request(worker, {
              ...c,
              seed: c.samples[0].seed,
              parameters: { ...c.parameters, evaluations: 20000 },
            });
          for (const sample of c.samples) {
            const start = performance.now();
            if (app)
              worker = new Worker("/" + variant + "/worker.mjs", {
                type: "module",
              });
            const data = app
              ? {
                  snapshot: c.snapshot,
                  parameters: c.parameters,
                  seed: sample.seed,
                  index: 0,
                }
              : {
                  problem: c.problem,
                  parameters: c.parameters,
                  seed: sample.seed,
                };
            const result = await request(worker, data);
            rows.push({
              variant,
              round,
              app,
              name: c.name,
              seed: sample.seed,
              ms: app ? performance.now() - start : result.ms,
              result: result.result,
            });
            if (app) worker.terminate();
          }
        }
        if (profile)
          return {
            rows,
            profile: (await request(worker, { profile: true })).profile,
          };
        return { rows };
      } finally {
        worker?.terminate();
      }
    },
    { variant, cases, round, app, profile },
  );
}
try {
  const browser = await playwright[browserName].launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port);
    console.log("Training WASM PGO on separate snapshots and seeds");
    const training = await panel(
      page,
      "instrument",
      input.rows.filter((r) => r.panel === "train"),
      0,
      false,
      true,
    );
    writeFileSync(out + "/training.profraw", Buffer.from(training.profile));
    let pgoAvailable = false;
    try {
      const tool =
        process.env.LLVM_PROFDATA ||
        resolve(
          ".toolchains/emsdk/upstream/bin/llvm-profdata" +
            (process.platform === "win32" ? ".exe" : ""),
        );
      run(tool, [
        "merge",
        "-o",
        out + "/training.profdata",
        out + "/training.profraw",
      ]);
      builds.push(
        await compileWasm(out + "/pgo", "pgo", out + "/training.profdata"),
      );
      pgoAvailable = true;
    } catch (error) {
      report.pgo_error = String(error);
      console.log(
        "PGO unavailable; continuing the non-PGO matrix. See the compiler log.",
      );
    }
    const variants = [
      "shipped",
      "baseline",
      "lto",
      "eh",
      "lto-eh",
      "simd",
      ...(pgoAvailable ? ["pgo"] : []),
    ];
    const cases = input.rows.filter((r) => r.panel === "heldout");
    for (let round = 0; round < 3; round++) {
      for (const variant of round % 2 ? [...variants].reverse() : variants) {
        console.log("Chromium round " + round + " " + variant);
        report.rows.push(...(await panel(page, variant, cases, round)).rows);
        writeFileSync(out + "/report.json", JSON.stringify(report));
      }
    }
    report.browsers[browserName] = browser.version();
    // Fresh worker latency includes instantiation, snapshot preparation and transfers.
    // Browser download/compiled-code caches are already warm.
    const totals = Object.fromEntries(
      variants.map((v) => [
        v,
        report.rows
          .filter((r) => r.variant === v)
          .reduce((sum, r) => sum + r.ms, 0),
      ]),
    );
    report.fastest = variants
      .filter((v) => v !== "shipped")
      .sort((a, b) => totals[a] - totals[b])[0];
    for (const variant of new Set(["shipped", "baseline", report.fastest]))
      report.rows.push(...(await panel(page, variant, cases, 0, true)).rows);
    writeFileSync(out + "/report.json", JSON.stringify(report));
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((r) => server.close(r));
}
run(python, ["scripts/verify-wasm-benchmark.py"]);
console.log("Report: " + out + "/report.json");
