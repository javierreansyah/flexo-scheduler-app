import engineManifest from "./engine-manifest.json";
import { Parameters, Result, Snapshot } from "./model";
export function run(
  snapshot: Snapshot,
  parameters: Parameters,
  seed: string,
  onProgress: (n: number, best?: number) => void,
) {
  if (
    !["evaluations", "starts", "stage_length"].every(
      (k) =>
        Number.isInteger((parameters as any)[k]) &&
        (parameters as any)[k] >= 1 &&
        (parameters as any)[k] <= 2000000000,
    ) ||
    parameters.starts > 20
  )
    throw Error(
      "Proposal budget and stage length must be positive integers; starts must be 1-20",
    );
  const requested = parameters;
  parameters = {
    ...parameters,
    starts: Math.min(parameters.starts, Math.max(1, parameters.evaluations)),
  };
  const workers: Worker[] = [];
  let cancelled = false;
  let rejectRun: (e: Error) => void = () => {};
  const promise = new Promise<Result>((resolve, reject) => {
    rejectRun = reject;
    const begin = performance.now();
    let next = 0,
      done = 0;
    const portions = Array(parameters.starts).fill(0);
    const results: any[] = [];
    const n = snapshot.jobs.length,
      m = Object.keys(snapshot.machines).length;
    const batches = new Set(snapshot.jobs.map((j) => j.arrival_time)).size;
    const patterns =
      new Set(
        snapshot.jobs.map((j) => [...j.inks].sort((a, b) => a - b).join(",")),
      ).size + 1;
    const estimate =
      16 * 1024 * 1024 +
      2 * (m + 2) * (n + 1) * (8 * batches + 20) +
      patterns * patterns * 16;
    const memoryWorkers = Math.max(
      1,
      Math.floor((256 * 1024 * 1024) / estimate),
    );
    const count = Math.min(
      memoryWorkers,
      parameters.starts,
      Math.max(1, (navigator.hardwareConcurrency || 2) - 1),
    );
    function fail(e: Error) {
      workers.forEach((w) => w.terminate());
      reject(e);
    }
    for (let i = 0; i < count; i++) {
      const w = new Worker(engineManifest.workerUrl, { type: "module" });
      workers.push(w);
      let current = 0;
      const submit = () => {
        if (next < parameters.starts) {
          current = next++;
          w.postMessage({ snapshot, parameters, seed, index: current });
        }
      };
      w.onerror = (e) => fail(Error(e.message));
      w.onmessage = ({ data }) => {
        if (cancelled) return;
        if (data.progress !== undefined) {
          portions[current] = data.progress;
          onProgress(portions.reduce((a, b) => a + b, 0) / parameters.starts);
          return;
        }
        if (data.error) {
          fail(Error(data.error));
          return;
        }
        results[data.index] = data.result;
        done++;
        portions[data.index] = 1;
        onProgress(
          portions.reduce((a, b) => a + b, 0) / parameters.starts,
          Math.min(...results.filter(Boolean).map((r) => r.fitness)),
        );
        if (done === parameters.starts) {
          workers.forEach((w) => w.terminate());
          const best = results.reduce((a, b) =>
            b.fitness < a.fitness ? b : a,
          );
          resolve({
            ...best,
            inputSnapshot: snapshot,
            engineVersion: engineManifest.version,
            profileVersion: engineManifest.profileVersion,
            parameters: requested,
            seed,
            now: snapshot.now,
            seconds: (performance.now() - begin) / 1000,
          });
        } else submit();
      };
      submit();
    }
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      workers.forEach((w) => w.terminate());
      rejectRun(
        Error("Optimization cancelled; your previous result is preserved."),
      );
    },
  };
}
