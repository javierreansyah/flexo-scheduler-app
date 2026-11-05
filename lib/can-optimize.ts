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
    [snapshot.ink_weight, snapshot.batch_flow_time_weight].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) &&
    [params.evaluations, params.starts, params.stage_length].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 2000000000,
    ) &&
    params.starts <= 20 &&
    Number.isFinite(params.t_max) &&
    params.t_max > 0 &&
    Number.isFinite(params.t_min) &&
    params.t_min > 0 &&
    params.t_min <= params.t_max &&
    [params.rcl_alpha, params.p_inter, params.p_shift, params.p_block].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    )
  );
}
