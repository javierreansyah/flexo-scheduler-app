import type { RefObject } from "react";
import type { GridBackgroundConfig, GridBackgroundProps } from "./types";
import type { BackgroundState } from "./runtime-state";
import { createGridRenderer, type GridRenderer } from "./renderer";
import {
  enqueueInitialEvents,
  checkSequences,
  stepAnimations,
  type ActiveAnimation,
} from "./animation-engine";
import { dissolveProgress, resolveDissolve } from "./scroll-dissolve";

export type RuntimeOptions = Pick<
  GridBackgroundProps,
  "scrollDissolve" | "gradation" | "initialEvents" | "sequences"
>;

/** Schedules at most 20 draws/second; an unchanged, offscreen, or hidden canvas sleeps. */
export function createBackgroundRuntime(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  state: BackgroundState,
  config: RefObject<GridBackgroundConfig>,
  options: RefObject<RuntimeOptions>,
) {
  const FRAME_INTERVAL = 1000 / 20;
  const animations: ActiveAnimation[] = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let renderer: GridRenderer | null = null;
  let raf: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFrame = -Infinity;
  let lastSequenceCheck = performance.now();
  let visible = true;
  let disposed = false;
  let contextLost = false;
  let initialEventsRun = false;
  let viewportHeight = window.innerHeight;
  let scrollHeight = document.documentElement.scrollHeight;

  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    raf = timer = null;
  }

  function canRun() {
    return (
      !disposed &&
      !contextLost &&
      visible &&
      !document.hidden &&
      renderer !== null
    );
  }

  function wake() {
    if (!canRun() || raf !== null) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const delay = Math.max(0, FRAME_INTERVAL - (performance.now() - lastFrame));
    if (delay > 0) {
      timer = setTimeout(() => {
        timer = null;
        if (canRun()) raf = requestAnimationFrame(frame);
      }, delay);
    } else raf = requestAnimationFrame(frame);
  }

  function invalidate() {
    state.needsRender = true;
    wake();
  }

  function updateScroll() {
    const value = dissolveProgress(
      resolveDissolve(options.current.scrollDissolve),
      window.scrollY,
      viewportHeight,
      scrollHeight,
    );
    if (value !== state.currentDissolveProgress) {
      state.currentDissolveProgress = value;
      invalidate();
    }
  }

  function updateMetrics() {
    viewportHeight = window.innerHeight;
    scrollHeight = document.documentElement.scrollHeight;
    updateScroll();
  }

  function onWindowResize() {
    // Also refresh the backing buffer when zoom or device pixel ratio changes.
    resize(container.clientWidth, container.clientHeight);
  }

  function resize(width: number, height: number) {
    state.containerWidth = width;
    state.containerHeight = height;
    renderer?.resize(width, height, config.current.gridCellSizePx);
    updateMetrics();
    invalidate();
  }

  function frame(time: number) {
    raf = null;
    if (!canRun()) return;
    lastFrame = time;
    if (!initialEventsRun) {
      initialEventsRun = true;
      const events = options.current.initialEvents;
      enqueueInitialEvents(
        reducedMotion.matches
          ? events?.map((event) => ({
              ...event,
              keyframes: [
                { ...event.keyframes.at(-1), duration: 0, pause: 0, delay: 0 },
              ],
            }))
          : events,
        time,
        animations,
      );
    }
    if (!reducedMotion.matches) {
      lastSequenceCheck = checkSequences(
        options.current.sequences,
        time,
        lastSequenceCheck,
        animations,
      );
    }
    const animated = stepAnimations(animations, time, config.current);
    if (
      (state.needsRender || animated) &&
      state.containerWidth > 0 &&
      state.containerHeight > 0
    ) {
      renderer!.resize(
        state.containerWidth,
        state.containerHeight,
        config.current.gridCellSizePx,
      );
      renderer!.draw(
        config.current,
        state.currentDissolveProgress,
        options.current.gradation,
        resolveDissolve(options.current.scrollDissolve),
      );
      state.needsRender = false;
    }
    if (animations.length > 0 || state.needsRender) {
      // A zero-size canvas is woken by ResizeObserver when it has a drawable area.
      if (state.containerWidth > 0 && state.containerHeight > 0) wake();
    } else if (
      !reducedMotion.matches &&
      options.current.sequences?.sequences.length
    ) {
      const delay = Math.max(
        1,
        options.current.sequences.checkInterval -
          (time - lastSequenceCheck) +
          1,
      );
      timer = setTimeout(() => {
        timer = null;
        wake();
      }, delay);
    }
  }

  function initializeRenderer() {
    try {
      renderer = createGridRenderer(canvas, config.current);
      resize(container.clientWidth, container.clientHeight);
    } catch (error) {
      renderer?.dispose();
      renderer = null;
      console.error("Unable to initialize background graphics", error);
    }
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    contextLost = true;
    stop();
    renderer?.dispose();
    renderer = null;
  }

  function onContextRestored() {
    contextLost = false;
    initializeRenderer();
    invalidate();
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else {
      updateMetrics();
      invalidate();
    }
  }

  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) invalidate();
    else stop();
  });
  const sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === container)
        resize(entry.contentRect.width, entry.contentRect.height);
      else updateMetrics();
    }
  });
  state.resizeFn = resize;
  state.wakeLoop = wake;
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("scroll", updateScroll, { passive: true });
  window.addEventListener("resize", onWindowResize, { passive: true });
  intersection.observe(container);
  sizes.observe(container);
  sizes.observe(document.documentElement);
  initializeRenderer();

  return {
    sync() {
      renderer?.configure(config.current);
      resize(state.containerWidth, state.containerHeight);
    },
    dispose() {
      disposed = true;
      stop();
      intersection.disconnect();
      sizes.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("scroll", updateScroll);
      window.removeEventListener("resize", onWindowResize);
      renderer?.dispose();
      renderer = null;
      state.resizeFn = state.wakeLoop = null;
    },
  };
}
