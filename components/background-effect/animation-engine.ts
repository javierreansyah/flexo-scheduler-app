import type {
  AnimationEvent,
  AnimationKeyframe,
  AnimationSequenceConfig,
  GridBackgroundConfig,
} from "./types";

export const Easing = {
  linear: (t: number) => t,
  easeOut: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

export interface ActiveKeyframe {
  startValue: number | [number, number, number];
  targetValue: number | [number, number, number];
  startTime: number;
  duration: number;
  ease: NonNullable<AnimationKeyframe["ease"]>;
}

export interface ActiveAnimation {
  property: keyof GridBackgroundConfig | "camera";
  stepSize?: number;
  keyframes: AnimationKeyframe[];
  currentKeyframeIndex: number;
  activeKeyframe: ActiveKeyframe | null;
  nextStartTime: number;
}

/**
 * Initializes and schedules initial events for execution
 */
export function enqueueInitialEvents(
  initialEvents: AnimationEvent[] | undefined,
  time: number,
  activeAnimations: ActiveAnimation[],
) {
  if (!initialEvents || initialEvents.length === 0) return;
  initialEvents.forEach((event) => {
    if (event.keyframes.length === 0) return;
    activeAnimations.push({
      property: event.property,
      stepSize: event.stepSize,
      keyframes: event.keyframes,
      currentKeyframeIndex: 0,
      activeKeyframe: null,
      nextStartTime: time + (event.keyframes[0].delay || 0),
    });
  });
}

/**
 * Checks probabilistic sequences and enqueues triggered events
 */
export function checkSequences(
  sequencesConfig: AnimationSequenceConfig | undefined,
  time: number,
  lastCheckTime: number,
  activeAnimations: ActiveAnimation[],
  config: GridBackgroundConfig,
): number {
  if (
    !sequencesConfig ||
    (!sequencesConfig.sequences.length && !sequencesConfig.generateEvents)
  ) {
    return lastCheckTime;
  }

  if (time - lastCheckTime > sequencesConfig.checkInterval) {
    if (sequencesConfig.generateEvents) {
      if (!activeAnimations.length)
        enqueueInitialEvents(
          sequencesConfig.generateEvents(config),
          time,
          activeAnimations,
        );
      return time;
    }
    for (let i = 0; i < sequencesConfig.sequences.length; i++) {
      const seq = sequencesConfig.sequences[i];
      if (Math.random() < seq.probability) {
        enqueueInitialEvents(seq.events, time, activeAnimations);
        break; // Only 1 sequence per interval
      }
    }
    return time;
  }

  return lastCheckTime;
}

/**
 * Advances active animations and updates dynamicConfigRef
 */
export function stepAnimations(
  activeAnimations: ActiveAnimation[],
  time: number,
  dynamicConfig: GridBackgroundConfig,
): boolean {
  if (activeAnimations.length === 0) return false;
  let changed = false;

  for (let i = activeAnimations.length - 1; i >= 0; i--) {
    const anim = activeAnimations[i];

    if (!anim.activeKeyframe) {
      if (time >= anim.nextStartTime) {
        const kf = anim.keyframes[anim.currentKeyframeIndex];
        let startVal: number | [number, number, number];

        if (anim.property === "camera") {
          startVal = [
            dynamicConfig.cameraX,
            dynamicConfig.cameraY,
            dynamicConfig.zoom,
          ];
        } else {
          startVal = dynamicConfig[
            anim.property as keyof GridBackgroundConfig
          ] as number;
        }

        const targetVal =
          kf.target !== undefined
            ? kf.target
            : Array.isArray(startVal)
              ? ([...startVal] as [number, number, number])
              : startVal;

        const kfDuration = kf.duration ?? kf.pause ?? 0;

        anim.activeKeyframe = {
          startValue: startVal,
          targetValue: targetVal,
          startTime: anim.nextStartTime,
          duration: kfDuration,
          ease: kf.ease || "linear",
        };
      } else {
        continue;
      }
    }

    const kf = anim.activeKeyframe;
    const elapsed = time - kf.startTime;
    const progress =
      kf.duration <= 0 ? 1.0 : Math.min(1.0, elapsed / kf.duration);
    const easeFn = Easing[kf.ease];
    const easedProgress = easeFn(progress);

    if (Array.isArray(kf.startValue) && Array.isArray(kf.targetValue)) {
      const s = kf.startValue;
      const t = kf.targetValue;
      let cx = s[0] + (t[0] - s[0]) * easedProgress;
      let cy = s[1] + (t[1] - s[1]) * easedProgress;
      let cz = s[2] + (t[2] - s[2]) * easedProgress;
      const step = anim.stepSize;
      if (step && step > 0) {
        cx = Math.floor(cx / step) * step;
        cy = Math.floor(cy / step) * step;
        cz = Math.floor(cz / step) * step;
      }
      changed ||=
        dynamicConfig.cameraX !== cx ||
        dynamicConfig.cameraY !== cy ||
        dynamicConfig.zoom !== cz;
      dynamicConfig.cameraX = cx;
      dynamicConfig.cameraY = cy;
      dynamicConfig.zoom = cz;
    } else {
      const s = kf.startValue as number;
      const e = kf.targetValue as number;
      let currentVal = s + (e - s) * easedProgress;
      if (anim.stepSize && anim.stepSize > 0) {
        currentVal = Math.floor(currentVal / anim.stepSize) * anim.stepSize;
      }
      changed ||=
        dynamicConfig[anim.property as keyof GridBackgroundConfig] !==
        currentVal;
      (dynamicConfig as unknown as Record<string, unknown>)[anim.property] =
        currentVal;
    }

    // Keyframe finished
    if (progress >= 1.0) {
      anim.currentKeyframeIndex++;
      anim.activeKeyframe = null;

      if (anim.currentKeyframeIndex < anim.keyframes.length) {
        const nextKf = anim.keyframes[anim.currentKeyframeIndex];
        anim.nextStartTime = time + (nextKf.delay || 0);
      } else {
        // All keyframes finished
        activeAnimations.splice(i, 1);
      }
    }
  }

  return changed;
}
