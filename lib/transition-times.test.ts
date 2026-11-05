import { test, expect } from "vitest";
import { parallelChangeoverTime } from "../engine/changeover-time";
import { transitionTimes, validateTransitionTimes } from "./transition-times";
const labels = ["empty", "1", "2", "3", "4"];
function times() {
  return Object.fromEntries(
    labels.map((a) => [
      a,
      Object.fromEntries(labels.map((b) => [b, a === b ? 0 : 1])),
    ]),
  );
}
test("parallel workers take 20 minutes for 10 and 20 minute cleanings", () => {
  const t = times();
  t["1"]["3"] = 10 / 60;
  t["2"]["4"] = 20 / 60;
  expect(parallelChangeoverTime([1, 2], [3, 4], t)).toBe(20 / 60);
});
test("minimizes the longest cleaning rather than the sum", () => {
  const t = times();
  t["1"]["3"] = 1 / 60;
  t["2"]["4"] = 20 / 60;
  t["1"]["4"] = 12 / 60;
  t["2"]["3"] = 12 / 60;
  expect(parallelChangeoverTime([1, 2], [3, 4], t)).toBe(12 / 60);
});
test("retained inks, duplicate inks, additions and removals", () => {
  const t = times();
  expect(parallelChangeoverTime([1, 1], [1, 1], t)).toBe(0);
  t["1"].empty = 0.2;
  t.empty["2"] = 0.3;
  expect(parallelChangeoverTime([1, 1], [1], t)).toBe(0.2);
  expect(parallelChangeoverTime([1], [1, 2], t)).toBe(0.3);
  expect(parallelChangeoverTime([], [], t)).toBe(0);
});
test("matrix expansion preserves edited times and validates boundaries", () => {
  const t = times();
  t["1"]["3"] = 0.2;
  expect(
    transitionTimes([...labels, "5"], {
      transition_times: t,
      setup_time: 0.75,
    })["1"]["3"],
  ).toBe(0.2);
  expect(() => validateTransitionTimes(t)).not.toThrow();
  t["1"]["1"] = 1;
  expect(() => validateTransitionTimes(t)).toThrow();
  t["1"]["1"] = 0;
  t["1"]["3"] = Infinity;
  expect(() => validateTransitionTimes(t)).toThrow();
});
