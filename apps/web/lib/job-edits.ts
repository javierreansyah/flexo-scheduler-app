import { parseColors, type InkColor } from "./colors";
import type { Job } from "./model";
export function editJob(
  job: Job,
  key: string,
  value: string,
  colors: InkColor[],
): Job {
  switch (key) {
    case "id":
      return { ...job, id: value };
    case "quantity":
      return { ...job, quantity: Number(value) };
    case "inks":
      return { ...job, inks: parseColors(value, colors) };
    default:
      return job;
  }
}
