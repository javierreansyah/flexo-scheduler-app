import type { AnimationEvent } from "./types";
/** Fresh entropy per burst; shader time advances independently without pauses. */
export function randomGlitch(
  processing = false,
  random = () => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 4294967296;
  },
): AnimationEvent[] {
  const between = (min: number, max: number) => min + (max - min) * random();
  const count = 1 + Math.floor(random() * 5);
  const tears = Array.from({ length: count }, () => ({
    target: (random() < 0.5 ? -1 : 1) * between(0.035, processing ? 0.12 : 0.2),
    duration: between(50, processing ? 300 : 180),
  }));
  const settle = { target: between(0.02, 0.07), duration: between(100, 350) };
  const duration =
    tears.reduce((total, frame) => total + frame.duration, 0) + settle.duration;
  return [
    {
      property: "lineDisplaceAmount",
      stepSize: 0.005,
      keyframes: [...tears, settle],
    },
    {
      property: "hBleedSpread",
      keyframes: [{ target: between(3, 12), duration: between(100, duration) }],
    },
    {
      property: "ldSmoothness",
      keyframes: [
        { target: between(0.05, 0.75), duration: between(50, duration) },
      ],
    },
  ];
}
