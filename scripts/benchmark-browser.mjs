import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("../apps/web/node_modules/@playwright/test");
const run = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  ["scripts/generate-browser-benchmark.py"],
  { stdio: "inherit" },
);
if (run.status !== 0) process.exit(run.status || 1);
const input = JSON.parse(
  readFileSync("packages/optimizer/tmp/browser-benchmark-input.json", "utf8"),
);
const manifest = JSON.parse(
  readFileSync("apps/web/lib/engine-manifest.json", "utf8"),
);
const out = resolve("apps/web/out");
const server = createServer((req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = resolve(out, "." + (path === "/" ? "/index.html" : path));
    if (relative(out, file).startsWith("..")) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".css": "text/css",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const rows = await page.evaluate(
    async ({ input, workerUrl }) => {
      const rows = [];
      for (const c of input.cases) {
        const start = performance.now();
        let previous;
        const traces = [];
        const arrived = new Map();
        const jobs = new Map(c.data.orders_data.map((j) => [String(j.id), j]));
        for (const batch of [...c.data.job_batches].sort(
          (a, b) => a.arrival_time - b.arrival_time,
        )) {
          for (const id of batch.orders)
            arrived.set(String(id), batch.arrival_time);
          const snapshot = {
            now: batch.arrival_time,
            machines: c.data.machine_rates,
            jobs: [...jobs]
              .filter(([id]) => arrived.has(id))
              .map(([id, j]) => ({ ...j, id, arrival_time: arrived.get(id) })),
            locked: previous
              ? Object.fromEntries(
                  Object.entries(previous.schedule).map(([m, j]) => [
                    m,
                    j.filter((x) => x.setup_start <= batch.arrival_time),
                  ]),
                )
              : {},
          };
          const results = await Promise.all(
            Array.from(
              { length: input.parameters.starts },
              (_, index) =>
                new Promise((resolve, reject) => {
                  const w = new Worker(workerUrl, { type: "module" });
                  w.onmessage = ({ data }) => {
                    if (data.progress !== undefined) return;
                    w.terminate();
                    data.error
                      ? reject(Error(data.error))
                      : resolve(data.result);
                  };
                  w.onerror = (e) => {
                    w.terminate();
                    reject(Error(e.message));
                  };
                  w.postMessage({
                    snapshot,
                    parameters: input.parameters,
                    seed: "42",
                    index,
                  });
                }),
            ),
          );
          previous = results.reduce((a, b) => (b.fitness < a.fitness ? b : a));
          traces.push({ snapshot, result: previous });
        }
        rows.push({
          instance: c.name,
          wall_seconds: (performance.now() - start) / 1000,
          fitness: previous.fitness,
          native_fitness: c.native_fitness,
          traces,
        });
      }
      return rows;
    },
    { input, workerUrl: manifest.workerUrl },
  );
  mkdirSync("packages/optimizer/results/browser-benchmark", {
    recursive: true,
  });
  writeFileSync(
    "packages/optimizer/results/browser-benchmark/report.json",
    JSON.stringify(
      { parameters: input.parameters, engine_version: manifest.version, rows },
      null,
      2,
    ),
  );
  for (const r of rows)
    console.log(
      `${r.instance}: ${r.wall_seconds.toFixed(3)}s fitness=${r.fitness.toFixed(6)} native=${r.native_fitness.toFixed(6)}`,
    );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

const verify = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  ["scripts/verify-browser-benchmark.py"],
  { stdio: "inherit" },
);
if (verify.status !== 0) process.exit(verify.status || 1);
