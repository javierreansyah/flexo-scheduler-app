import { describe, it, expect } from "vitest";
import { importCsv, jobCsv, machineCsv } from "./csv";
import { initial } from "./model";
import { projectColors } from "./colors";
import { editJob } from "./job-edits";
describe("workspace data helpers", () => {
  it("round-trips named inks and machine state through CSV", () => {
    const p = initial();
    const colors = projectColors(p);
    p.snapshot.jobs = [
      { id: "a", quantity: 100, inks: [1, 2], arrival_time: 0 },
    ];
    const jobs = importCsv(
      jobCsv(p.snapshot, colors),
      "jobs",
      { ...p.snapshot, jobs: [] },
      colors,
      false,
    );
    expect(jobs.jobs).toEqual(p.snapshot.jobs);
    p.snapshot.machines = { "Machine 1": 100 };
    p.snapshot.machine_states = {
      "Machine 1": { available_time: 2, inks: [1] },
    };
    const machines = importCsv(
      machineCsv(p.snapshot, colors),
      "machines",
      p.snapshot,
      colors,
      false,
    );
    expect(machines.machines).toEqual(p.snapshot.machines);
    expect(machines.machine_states).toEqual(p.snapshot.machine_states);
  });
  it("rejects duplicates and locked equipment without mutating inputs", () => {
    const p = initial();
    const before = structuredClone(p.snapshot);
    const colors = projectColors(p);
    expect(() =>
      importCsv(
        "id,quantity,inks\na,100,Red\na,200,Green",
        "jobs",
        p.snapshot,
        colors,
        false,
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      importCsv("name,rate\nA,100", "machines", p.snapshot, colors, true),
    ).toThrow(/locked/);
    expect(p.snapshot).toEqual(before);
  });
  it("shares job field conversion for single edits and pasted cells", () => {
    const p = initial(),
      colors = projectColors(p);
    const job = { id: "a", quantity: 100, inks: [], arrival_time: 0 };
    expect(editJob(job, "quantity", "250", colors).quantity).toBe(250);
    expect(editJob(job, "inks", "Red, Green", colors).inks).toEqual([1, 2]);
    expect(editJob(job, "id", "b", colors).id).toBe("b");
    expect(editJob(job, "arrival", "5", colors)).toEqual(job);
    expect(job.quantity).toBe(100);
  });
});
