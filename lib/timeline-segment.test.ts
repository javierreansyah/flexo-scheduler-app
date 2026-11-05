import { expect, test } from "vitest";
import { timelineSegment } from "./timeline-segment";

test("clips setup and production independently to the visible shift", () => {
  expect(timelineSegment(6, 10, 8, 8)).toEqual({ left: 0, width: 25 });
  expect(timelineSegment(10, 18, 8, 8)).toEqual({ left: 25, width: 75 });
  expect(timelineSegment(4, 8, 8, 8)).toBeNull();
  expect(timelineSegment(10, 10, 8, 8)).toBeNull();
  expect(timelineSegment(16, 18, 8, 8)).toBeNull();
});
