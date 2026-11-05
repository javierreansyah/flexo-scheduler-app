"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { randomGlitch } from "../background-effect/random-glitch";
import GridBackground from "../background-effect/grid-background";
import type {
  AnimationSequenceConfig,
  GridBackgroundConfig,
} from "../background-effect/types";
import { Button } from "./button";
const BASE: Partial<GridBackgroundConfig> = {
  singleCell: true,
  singleCellBleedPx: [12, 24],
  gridCellSizePx: 4096,
  seed: 7,
  cameraX: 10,
  cameraY: 4,
  zoom: 50,
  noiseContrast: 1,
  noiseBrightness: 1,
  caStrengthBase: 0.022,
  caStrengthCurve: 0.008,
  vScanPeriod: 5,
  vScanGapDark: 1,
  vScanGapLight: 1,
  vScanFloorLight: 0.62,
  vScanFloorDark: 0.62,
  lineDisplacePeriod: 28,
  lineDisplaceThickRatio: 0.55,
  staticNoiseIntensityBase: 0.06,
  staticNoiseIntensityEdge: 0.12,
  bloomIntensity: 0.45,
  wideBloomIntensity: 0.5,
  hScanPeriod: 8,
  hScanIntensity: 0.3,
  hBleedSpread: 7,
  hBleedIntensity: 0.8,
  phosphorIntensity: 0.65,
  lineDisplaceAmount: 0.06,
};
const GLITCH: AnimationSequenceConfig = {
  checkInterval: 50,
  sequences: [],
  timeSpeed: 8,
  generateEvents: () => randomGlitch(),
};
const PROCESSING: AnimationSequenceConfig = {
  checkInterval: 50,
  sequences: [],
  timeSpeed: 8,
  generateEvents: () => randomGlitch(true),
};
export function OptimizeButton({
  busy,
  progress,
  disabled,
  onClick,
  onCancel,
}: {
  busy: boolean;
  progress: number;
  disabled: boolean;
  onClick: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false),
    [held, setHeld] = useState(false),
    [focused, setFocused] = useState(false),
    [warmed, setWarmed] = useState(false),
    [reduced, setReduced] = useState(true);
  const [palettes, setPalettes] = useState<{
    active: [number, number, number];
    busy: [number, number, number];
  } | null>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    if (ref.current) {
      const style = getComputedStyle(ref.current);
      const rgb = (token: string): [number, number, number] => {
        const value = style.getPropertyValue(token).trim().replace("#", "");
        return [0, 2, 4].map((offset) =>
          parseInt(value.slice(offset, offset + 2), 16),
        ) as [number, number, number];
      };
      setPalettes({
        active: rgb("--optimizer-hover"),
        busy: rgb("--optimizer-processing"),
      });
    }
    return () => media.removeEventListener("change", sync);
  }, []);
  const active = !disabled && !busy && (hover || held || focused);
  const phase = busy ? "busy" : active ? "active" : "idle";
  useEffect(() => {
    if (active || busy) setWarmed(true);
  }, [active, busy]);
  const color = palettes?.[busy ? "busy" : "active"];
  const config = useMemo<Partial<GridBackgroundConfig>>(
    () =>
      color
        ? {
            ...BASE,
            color1: color,
            color2: color,
            color3: color,
            color4: color,
            color5: color,
          }
        : BASE,
    [color],
  );
  return (
    <div
      ref={ref}
      className="relative w-full"
      data-slot="optimize-control"
      data-phase={phase}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHover(true);
      }}
      onPointerLeave={() => {
        setHover(false);
        setHeld(false);
      }}
    >
      <Button
        variant="optimizer"
        disabled={disabled}
        onClick={busy ? onCancel : onClick}
        aria-label={busy ? "Cancel" : "Optimize"}
        aria-busy={busy}
        data-phase={phase}
        onPointerDown={(event) => {
          if (event.isPrimary && event.button === 0) setHeld(true);
        }}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onContextMenu={(event) => event.preventDefault()}
        onFocus={(event) =>
          setFocused(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => {
          setFocused(false);
          setHeld(false);
        }}
      >
        <span aria-hidden="true" className="crt-button-surface">
          <GridBackground
            className="h-full w-full"
            enabled={warmed && !reduced && palettes !== null}
            config={config}
            sequences={
              !reduced
                ? busy
                  ? PROCESSING
                  : active
                    ? GLITCH
                    : undefined
                : undefined
            }
          />
        </span>
        <span className="crt-button-label">
          {busy ? (
            <LoaderCircle className="motion-safe:animate-spin" />
          ) : (
            <Play />
          )}
          {busy ? `Cancel · ${Math.round(progress * 100)}%` : "Optimize"}
        </span>
      </Button>
    </div>
  );
}
