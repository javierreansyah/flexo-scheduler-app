import { test, expect, vi } from "vitest";
import { randomGlitch } from "../components/background-effect/random-glitch";
import {
  checkSequences,
  type ActiveAnimation,
} from "../components/background-effect/animation-engine";
import { DEFAULT_CONFIG } from "../components/background-effect/config";
test("fresh bursts vary shape and timing without pausing or taking over the clock", () => {
  const slow = randomGlitch(false, () => 0.15),
    busy = randomGlitch(true, () => 0.85);
  expect(slow).not.toEqual(busy);
  for (const events of [slow, busy]) {
    expect(events.some((event) => event.property === "time")).toBe(false);
    for (const event of events) {
      for (const frame of event.keyframes) {
        expect(frame.pause).toBeUndefined();
        expect(frame.delay).toBeUndefined();
        expect(frame.target).toBeDefined();
      }
    }
    for (const frame of events[0].keyframes) {
      expect(Math.abs(Number(frame.target))).toBeLessThanOrEqual(0.2);
      expect(frame.duration).toBeGreaterThanOrEqual(50);
    }
  }
});
test("procedural bursts do not overlap and regenerate after completion", () => {
  const config = { ...DEFAULT_CONFIG },
    generateEvents = vi.fn(() => randomGlitch(false, () => 0.5)),
    sequence = { checkInterval: 50, sequences: [], generateEvents },
    animations: ActiveAnimation[] = [];
  expect(checkSequences(sequence, 60, 0, animations, config)).toBe(60);
  expect(generateEvents).toHaveBeenCalledTimes(1);
  expect(animations).toHaveLength(3);
  checkSequences(sequence, 120, 60, animations, config);
  expect(generateEvents).toHaveBeenCalledTimes(1);
  animations.length = 0;
  checkSequences(sequence, 180, 120, animations, config);
  expect(generateEvents).toHaveBeenCalledTimes(2);
  expect(animations).toHaveLength(3);
});
test("legacy sequences and sleeping idle behavior remain supported", () => {
  const animations: ActiveAnimation[] = [];
  expect(checkSequences(undefined, 100, 0, animations, DEFAULT_CONFIG)).toBe(0);
  checkSequences(
    {
      checkInterval: 50,
      sequences: [
        {
          probability: 1,
          events: [
            { property: "time", keyframes: [{ target: 3, duration: 100 }] },
          ],
        },
      ],
    },
    100,
    0,
    animations,
    DEFAULT_CONFIG,
  );
  expect(animations).toHaveLength(1);
});
