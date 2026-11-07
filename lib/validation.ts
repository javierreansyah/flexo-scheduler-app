import type { Job, Parameters, Snapshot } from "./model";
import type { InkColor } from "./colors";
export function validParameters(p: Parameters) {
  return (
    !!p &&
    [p.evaluations, p.starts, p.stage_length].every(
      (v) => Number.isInteger(v) && v >= 1 && v <= 2000000000,
    ) &&
    p.starts <= 20 &&
    Number.isFinite(p.t_max) &&
    Number.isFinite(p.t_min) &&
    p.t_min > 0 &&
    p.t_max > p.t_min &&
    [p.rcl_alpha, p.p_inter, p.p_shift, p.p_block].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 1,
    )
  );
}
export function validWeights(ink: number, flow: number) {
  return (
    [ink, flow].every((v) => Number.isFinite(v) && v >= 0) && ink + flow > 0
  );
}
function validateInks(inks: number[], colors: InkColor[]) {
  if (
    inks.some((id) => !Number.isInteger(id) || !colors.some((c) => c.id === id))
  )
    throw Error("Choose inks from the color catalog.");
}
export function validateJobs(jobs: Job[], colors: InkColor[]) {
  if (
    jobs.some(
      (j) => !j.id.trim() || !Number.isInteger(j.quantity) || j.quantity < 1,
    )
  )
    throw Error("Enter a job ID and a positive whole quantity.");
  if (new Set(jobs.map((j) => j.id)).size !== jobs.length)
    throw Error("Invalid or duplicate job IDs");
  jobs.forEach((j) => validateInks(j.inks, colors));
}
export function validateMachines(
  machines: Snapshot["machines"],
  states: Snapshot["machine_states"],
  colors: InkColor[],
) {
  for (const [name, rate] of Object.entries(machines)) {
    if (!name.trim() || !Number.isFinite(rate) || rate <= 0)
      throw Error("Enter a machine name and a positive rate.");
    const state = states?.[name];
    if (state) {
      if (!Number.isFinite(state.available_time) || state.available_time < 0)
        throw Error("Availability must be a nonnegative number.");
      validateInks(state.inks, colors);
    }
  }
}
