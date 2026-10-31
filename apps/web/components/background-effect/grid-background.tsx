"use client";

import { lazy, Suspense, useEffect, useRef } from "react";
import type { GridBackgroundConfig, GridBackgroundProps } from "./types";
import { DEFAULT_CONFIG } from "./config";
import { createBackgroundState } from "./runtime-state";
import type { createBackgroundRuntime, RuntimeOptions } from "./runtime";
import { afterTextPaint } from "./after-paint";
import { whenNearViewport } from "./when-visible";

const EMPTY_CONFIG: Partial<GridBackgroundConfig> = {};
const DevOverlay =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./dev-overlay"))
    : null;

export default function GridBackground({
  children,
  className = "",
  enabled = true,
  devMode = false,
  scrollDissolve = false,
  config = EMPTY_CONFIG,
  sequences,
  initialEvents,
  gradation,
  ...props
}: GridBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createBackgroundState());
  const dynamicConfigRef = useRef({ ...DEFAULT_CONFIG, ...config });
  const optionsRef = useRef<RuntimeOptions>({
    scrollDissolve,
    sequences,
    initialEvents,
    gradation,
  });
  const runtimeRef = useRef<ReturnType<typeof createBackgroundRuntime> | null>(
    null,
  );

  useEffect(() => {
    // Preserve animated/HUD values while applying explicitly changed props.
    Object.assign(dynamicConfigRef.current, config);
    optionsRef.current = {
      scrollDissolve,
      sequences,
      initialEvents,
      gradation,
    };
    runtimeRef.current?.sync();
  }, [config, scrollDissolve, sequences, initialEvents, gradation]);

  useEffect(() => {
    if (!enabled || !canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    let cancelled = false;
    let runtime: ReturnType<typeof createBackgroundRuntime> | null = null;
    let cancelPaint: (() => void) | undefined;
    const cancelVisibility = whenNearViewport(container, () => {
      cancelPaint = afterTextPaint(() => {
        // Offscreen footers must not compile shaders alongside the visible header.
        import("./runtime")
          .then(({ createBackgroundRuntime }) => {
            if (cancelled) return;
            runtime = createBackgroundRuntime(
              canvas,
              container,
              stateRef.current,
              dynamicConfigRef,
              optionsRef,
            );
            runtimeRef.current = runtime;
          })
          .catch((error: unknown) => {
            if (!cancelled)
              console.error("Unable to load background graphics", error);
          });
      });
    });
    return () => {
      cancelled = true;
      cancelVisibility();
      cancelPaint?.();
      runtime?.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [enabled]);

  return (
    <div
      ref={containerRef}
      className={`relative isolate ${className}`}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      />
      {DevOverlay && devMode && (
        <Suspense fallback={null}>
          <DevOverlay
            initialConfig={{ ...DEFAULT_CONFIG, ...config }}
            dynamicConfigRef={dynamicConfigRef}
            stateRef={stateRef}
            containerRef={containerRef}
            config={config}
          />
        </Suspense>
      )}
      {children}
    </div>
  );
}
