import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { compileWasm } from "./compile-wasm.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("../apps/web/node_modules/@playwright/test");
const out = "packages/optimizer/tmp/wasm-performance";
await compileWasm(out + "/profile", "profile");
const input = JSON.parse(readFileSync(out + "/input.json"));
const c = input.rows.find((c) => c.name === "N100_carryover_01");
const base = resolve(out + "/profile");
writeFileSync(
  base + "/probe.mjs",
  'import factory from "./engine.mjs";const core=await factory();self.onmessage=({data})=>{const seed=core.seeds(data.seed,1)[0];core.run(data.problem,data.parameters,seed);postMessage({done:true});};postMessage({ready:true});',
);
const server = createServer((req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>WASM profile</title>");
      return;
    }
    const file = resolve(base, "." + path);
    if (relative(base, file).startsWith("..")) throw Error("Invalid path");
    res.setHeader(
      "Content-Type",
      extname(file) === ".wasm" ? "application/wasm" : "text/javascript",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        window.probe = new Worker("/probe.mjs", { type: "module" });
        window.probe.onmessage = () => resolve();
        window.probe.onerror = (e) => reject(Error(e.message));
      }),
  );
  const cdp = await browser.newBrowserCDPSession();
  const targets = await cdp.send("Target.getTargets");
  const target = targets.targetInfos.find(
    (t) => t.type === "worker" && t.url.endsWith("/probe.mjs"),
  );
  if (!target) throw Error("Profile worker target missing");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  let id = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", (e) => {
    const msg = JSON.parse(e.message);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id: next, method, params }),
        })
        .catch(reject);
    });
  }
  // Warm up before taking a sample; use the same case and budget as the benchmark.
  async function solve(evaluations) {
    await page.evaluate(
      (data) =>
        new Promise((resolve, reject) => {
          window.probe.onmessage = ({ data }) => {
            if (data.done) resolve();
          };
          window.probe.onerror = (e) => reject(Error(e.message));
          window.probe.postMessage(data);
        }),
      {
        problem: c.problem,
        parameters: { ...c.parameters, evaluations },
        seed: c.samples[0].seed,
      },
    );
  }
  await solve(100000);
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 1000 });
  await send("Profiler.start");
  await solve(5000000);
  const { profile } = await send("Profiler.stop");
  writeFileSync(out + "/solver.cpuprofile", JSON.stringify(profile));
  const counts = new Map();
  for (const id of profile.samples || [])
    counts.set(id, (counts.get(id) || 0) + 1);
  const hot = profile.nodes
    .map((n) => ({
      name: n.callFrame.functionName,
      samples: counts.get(n.id) || 0,
    }))
    .filter((n) => n.samples)
    .sort((a, b) => b.samples - a.samples);
  const names = spawnSync(
    resolve(
      ".toolchains/emsdk/upstream/bin/llvm-cxxfilt" +
        (process.platform === "win32" ? ".exe" : ""),
    ),
    [],
    { input: hot.map((n) => n.name).join("\n") + "\n", encoding: "utf8" },
  )
    .stdout.trim()
    .split("\n");
  hot.forEach((n, i) => (n.name = names[i]));
  writeFileSync(
    out + "/hotspots.json",
    JSON.stringify(
      {
        browser: browser.version(),
        case: c.name,
        evaluations: 5000000,
        sampling_interval_us: 1000,
        total_samples: profile.samples?.length,
        hotspots: hot,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(hot.slice(0, 12), null, 2));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
