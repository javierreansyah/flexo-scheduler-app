import engineManifest from "../lib/engine-manifest.json";

import { test, expect } from "@playwright/test";
import fixtures from "./native-fixtures.json";
for (const fixture of fixtures)
  test(`WASM matches native metrics: ${fixture.name}`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(
      async (f) => {
        const results = await Promise.all(
          Array.from(
            { length: f.parameters.starts },
            (_, index) =>
              new Promise<any>((resolve, reject) => {
                const w = new Worker(f.workerUrl, { type: "module" });
                w.onerror = (e) => {
                  w.terminate();
                  reject(Error(e.message));
                };
                w.onmessage = ({ data }) => {
                  if (data.progress !== undefined) return;
                  w.terminate();
                  data.error ? reject(Error(data.error)) : resolve(data.result);
                };
                w.postMessage({ ...f, index });
              }),
          ),
        );
        return results.reduce((a, b) => (b.fitness < a.fitness ? b : a));
      },
      { ...fixture, workerUrl: engineManifest.workerUrl },
    );
    for (const key of [
      "fitness",
      "ink_changes",
      "batch_flow_time",
      "makespan",
    ] as const)
      expect(result[key]).toBeCloseTo(fixture.expected[key], 8);
    const ids = Object.values(result.schedule as Record<string, any[]>)
      .flat()
      .map((j) => j.id);
    expect(new Set(ids).size).toBe(fixture.snapshot.jobs.length);
  });
test("large inputs, validation failures and deterministic workers", async ({
  page,
}) => {
  await page.goto("/");
  const output = await page.evaluate(
    async (f) => {
      async function solve(snapshot: any) {
        return new Promise<any>((resolve, reject) => {
          const w = new Worker(f.workerUrl, { type: "module" });
          w.onerror = (e) => {
            w.terminate();
            reject(Error(e.message));
          };
          w.onmessage = ({ data }) => {
            if (data.progress !== undefined) return;
            w.terminate();
            resolve(data);
          };
          w.postMessage({
            snapshot,
            parameters: { ...f.parameters, evaluations: 1001, starts: 1 },
            seed: "42",
            index: 0,
          });
        });
      }
      const snapshot = {
        now: 0,
        machines: { A: 100, B: 150 },
        jobs: Array.from({ length: 150 }, (_, i) => ({
          id: String(i),
          quantity: 2000 + i * 10,
          inks: [(i % 3) + 1],
          arrival_time: 0,
        })),
      };
      const a = await solve(snapshot),
        b = await solve(snapshot),
        bad = await solve({
          ...snapshot,
          jobs: [{ ...snapshot.jobs[0], arrival_time: 1 }],
        });
      return { a: a.result, b: b.result, error: bad.error };
    },
    { ...fixtures[0], workerUrl: engineManifest.workerUrl },
  );
  expect(output.a).toEqual(output.b);
  expect(
    Object.values(output.a.schedule as Record<string, any[]>).flat(),
  ).toHaveLength(150);
  expect(output.error).toContain("Future arrival");
});
