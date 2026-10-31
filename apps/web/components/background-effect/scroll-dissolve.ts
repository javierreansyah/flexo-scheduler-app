import type { ScrollDissolveConfig } from "./types";

export function resolveDissolve(value: boolean | ScrollDissolveConfig = false) {
  const config = typeof value === "object" ? value : {};
  const mode = config.mode ?? "dissolve";
  return {
    enabled: Boolean(value),
    mode,
    direction:
      config.direction ?? (mode === "appear" ? "up-to-down" : "down-to-up"),
    target: config.target ?? (mode === "appear" ? "bottom" : "top"),
    distance: config.distance,
  } satisfies ScrollDissolveConfig & { enabled: boolean };
}

export function dissolveProgress(
  config: ReturnType<typeof resolveDissolve>,
  scrollY: number,
  viewportHeight: number,
  scrollHeight: number,
) {
  if (!config.enabled) return 0;
  const distance =
    config.distance && config.distance > 0
      ? config.distance
      : config.target === "bottom"
        ? 450
        : viewportHeight;
  const progress =
    config.target === "bottom"
      ? 1 - Math.max(0, scrollHeight - viewportHeight - scrollY) / distance
      : scrollY / distance;
  return Math.round(Math.min(1, Math.max(0, progress)) / 0.005) * 0.005;
}
