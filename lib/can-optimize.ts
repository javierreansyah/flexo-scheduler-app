import { validParameters, validWeights } from "./validation";
import type { Parameters, Project } from "./model";

export function canOptimize(project: Project, params: Parameters) {
  const { snapshot, seed } = project;
  return (
    /^\d+$/.test(seed) &&
    BigInt(seed) <= 18446744073709551615n &&
    snapshot.jobs.length > 0 &&
    Object.values(snapshot.machines).length > 0 &&
    Object.values(snapshot.machines).every(
      (speed) => Number.isFinite(speed) && speed > 0,
    ) &&
    validWeights(snapshot.ink_weight, snapshot.batch_flow_time_weight) &&
    validParameters(params)
  );
}
