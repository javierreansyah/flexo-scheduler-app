"use client";

import React from "react";
import type { DevStats, GridBackgroundConfig } from "./types";

interface DevControlsHudProps {
  devStats: DevStats;
  updateCamera: (x: number, y: number, z: number) => void;
  updateParam: (key: keyof GridBackgroundConfig, val: number) => void;
  handleReset: () => void;
  handleCopy: () => void;
  copied: boolean;
  isDragEnabled?: boolean;
  toggleDrag?: () => void;
}

// ── Reusable Numeric Control with Keyboard Input, Slider & Presets ──
interface HudControlProps {
  paramKey?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  unit?: string;
  hint?: string;
  presets?: number[];
  nudgeSteps?: number[];
  onChange: (val: number) => void;
}

function HudControl({
  paramKey,
  label,
  value,
  min,
  max,
  step = 1,
  decimals,
  unit,
  hint,
  presets,
  nudgeSteps,
  onChange,
}: HudControlProps) {
  const [prevValue, setPrevValue] = React.useState(value);
  const [textVal, setTextVal] = React.useState<string>(() =>
    decimals !== undefined ? value.toFixed(decimals) : String(value),
  );
  const [isFocused, setIsFocused] = React.useState(false);
  const [isCopied, setIsCopied] = React.useState(false);

  // Synchronize when value changes externally while not focused
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isFocused) {
      setTextVal(
        decimals !== undefined ? value.toFixed(decimals) : String(value),
      );
    }
  }

  const handleCopyParam = () => {
    const formattedVal =
      decimals !== undefined && decimals > 0
        ? Number(value.toFixed(decimals))
        : value;
    const textToCopy = paramKey
      ? `${paramKey}: ${formattedVal},`
      : `${formattedVal}`;

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1200);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTextVal(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseFloat(textVal);
    if (isNaN(parsed)) {
      setTextVal(
        decimals !== undefined ? value.toFixed(decimals) : String(value),
      );
    } else {
      const clamped = Math.min(Math.max(parsed, min), max);
      onChange(clamped);
      setTextVal(
        decimals !== undefined ? clamped.toFixed(decimals) : String(clamped),
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex flex-col gap-1 py-1">
      {/* Label Row with direct keyboard-inputable value field, copy icon and nudge buttons */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-hud-md text-body">{label}</span>
          {unit && (
            <span className="font-mono text-hud-xs text-neutral-500">
              ({unit})
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {nudgeSteps && nudgeSteps.length > 0 && (
            <div className="flex items-center gap-0.5">
              {nudgeSteps.map((delta) => (
                <button
                  key={delta}
                  type="button"
                  onClick={() => {
                    const next = Math.min(Math.max(value + delta, min), max);
                    const fixed =
                      decimals !== undefined
                        ? parseFloat(next.toFixed(decimals))
                        : next;
                    onChange(fixed);
                  }}
                  className="cursor-pointer border border-foreground/10 bg-foreground/5 px-1 py-0.5 font-mono text-hud-xs text-muted-foreground transition hover:border-foreground/20 hover:bg-foreground/15 hover:text-foreground"
                  title={`${delta > 0 ? `+${delta}` : delta} ${label}`}
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-0.5">
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={textVal}
              onFocus={() => setIsFocused(true)}
              onBlur={handleBlur}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="w-16 border border-foreground/15 bg-background/60 px-1.5 py-0.5 text-right font-mono text-hud-md font-semibold text-neutral-200 tabular-nums transition hover:border-foreground/30 focus:border-neutral-200 focus:outline-none"
              title={`Type value for ${label} (${min} - ${max})`}
            />

            <button
              type="button"
              onClick={handleCopyParam}
              className={`flex cursor-pointer items-center justify-center border p-1 transition ${
                isCopied
                  ? "border-neutral-200 bg-neutral-200/25 text-neutral-200"
                  : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:bg-foreground/10 hover:text-foreground"
              }`}
              title={`Copy ${paramKey ? `${paramKey}: ${value},` : label}`}
            >
              {isCopied ? (
                <svg
                  className="h-2.5 w-2.5 text-neutral-200"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  className="h-2.5 w-2.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Range Slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none bg-foreground/15 accent-neutral-200 transition hover:bg-foreground/25"
      />

      {/* Hint (if any) */}
      {hint && (
        <div className="font-mono text-hud-xs text-neutral-500 italic">
          {hint}
        </div>
      )}

      {/* Preset Pills */}
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <span className="font-mono text-hud-xs text-neutral-500">
            Presets:
          </span>
          {presets.map((preset) => {
            const isActive =
              Math.abs(value - preset) < (step ? step / 2 : 0.001);
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(preset)}
                className={`py-0.2 cursor-pointer border px-1.5 font-mono text-hud-xs transition ${
                  isActive
                    ? "border-neutral-200 bg-neutral-200 font-bold text-neutral-950"
                    : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/15 hover:bg-foreground/10 hover:text-foreground"
                }`}
              >
                {decimals !== undefined && decimals > 0
                  ? preset.toFixed(decimals)
                  : preset}
                {unit ? unit : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Collapsible Accordion Section (Unboxed) ──
interface HudSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function HudSection({ title, isOpen, onToggle, children }: HudSectionProps) {
  return (
    <div className="border-b border-foreground/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between py-2 text-left transition select-none hover:text-foreground"
      >
        <span className="text-hud-sm font-bold tracking-wider text-neutral-200 uppercase">
          {title}
        </span>
        <span className="font-mono text-hud-sm text-muted-foreground">
          {isOpen ? "▾" : "▸"}
        </span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-1.5 pt-0.5 pb-2.5">{children}</div>
      )}
    </div>
  );
}

// ── Main DevControlsHud Component ──
export function DevControlsHud({
  devStats,
  updateCamera,
  updateParam,
  handleReset,
  handleCopy,
  copied,
  isDragEnabled: externalDragEnabled,
  toggleDrag: externalToggleDrag,
}: DevControlsHudProps) {
  const [internalDrag, setInternalDrag] = React.useState(true);
  const isDragEnabled =
    externalDragEnabled !== undefined ? externalDragEnabled : internalDrag;
  const toggleDrag =
    externalToggleDrag || (() => setInternalDrag((prev) => !prev));

  const [isMinimized, setIsMinimized] = React.useState(false);

  const [openSections, setOpenSections] = React.useState({
    camera: true,
    noise: true,
    brightness: true,
    effects: false,
  });

  const [localCopied, setLocalCopied] = React.useState(false);
  const isCopied = copied || localCopied;

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const areAllOpen = Object.values(openSections).every(Boolean);
  const toggleAllSections = () => {
    const nextState = !areAllOpen;
    setOpenSections({
      camera: nextState,
      noise: nextState,
      brightness: nextState,
      effects: nextState,
    });
  };

  // Comprehensive copy config handler exporting all 20 parameters
  const handleCopyAll = () => {
    const configObj = {
      cameraX: devStats.cameraX,
      cameraY: devStats.cameraY,
      zoom: devStats.zoom,
      gridCellSizePx: devStats.gridCellSizePx,
      warpAmount: devStats.warpAmount,
      noiseFrequency: devStats.noiseFrequency,
      noiseRidgedMix: devStats.noiseRidgedMix,
      noiseBrightness: devStats.noiseBrightness,
      noiseContrast: devStats.noiseContrast,
      seed: devStats.seed,
      time: devStats.time,
      lineDisplaceAmount: devStats.lineDisplaceAmount,
      ldSmoothness: devStats.ldSmoothness,
      phosphorIntensity: devStats.phosphorIntensity,
      hScanPeriod: devStats.hScanPeriod,
      hScanIntensity: devStats.hScanIntensity,
      hScanFuzziness: devStats.hScanFuzziness,
      hBleedSpread: devStats.hBleedSpread,
      hBleedIntensity: devStats.hBleedIntensity,
      vScanSoftness: devStats.vScanSoftness,
    };

    const formattedLines = Object.entries(configObj).map(([k, v]) => {
      const formattedVal =
        typeof v === "number"
          ? Number.isInteger(v)
            ? v
            : Number(v.toFixed(4))
          : v;
      return `  ${k}: ${formattedVal},`;
    });

    const text = `{\n${formattedLines.join("\n")}\n}`;

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setLocalCopied(true);
      setTimeout(() => setLocalCopied(false), 2000);
    }
    handleCopy();
  };

  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    el.addEventListener("wheel", handleNativeWheel, { passive: true });
    return () => {
      el.removeEventListener("wheel", handleNativeWheel);
    };
  }, []);

  // 1. Minimized View: Collapsed into a clean button without rounded corners
  if (isMinimized) {
    return (
      <div
        data-dev-hud
        data-lenis-prevent
        className="pointer-events-auto absolute top-4 right-4 z-50 flex items-center"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="cursor-pointer border border-foreground/20 bg-neutral-950/95 px-3 py-1.5 font-mono text-xs text-secondary shadow-xl backdrop-blur-md transition hover:border-neutral-200 hover:bg-neutral-900 hover:text-foreground"
          title="Expand Dev HUD"
        >
          <span className="font-bold tracking-wider text-neutral-200">
            DEV HUD
          </span>
          <span className="ml-2 text-muted-foreground">⤢</span>
        </button>
      </div>
    );
  }

  // 2. Expanded View: Single container HUD with header Copy button and clean sections
  return (
    <div
      data-dev-hud
      data-lenis-prevent
      className="pointer-events-auto absolute top-4 right-4 z-50 flex max-h-(--hud-max-height) w-(--hud-width) flex-col overscroll-contain border border-foreground/20 bg-neutral-950/95 font-mono text-xs text-secondary shadow-2xl backdrop-blur-md [scrollbar-width:thin]"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header: Copy Config button on left, controls on right */}
      <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 bg-neutral-950 p-2.5">
        <button
          type="button"
          onClick={handleCopyAll}
          className={`cursor-pointer border px-2.5 py-1 text-hud-md font-semibold transition active:scale-98 ${
            isCopied
              ? "border-neutral-200 bg-neutral-200 text-neutral-950"
              : "border-foreground/20 bg-foreground/5 text-secondary hover:border-neutral-200/60 hover:bg-foreground/10 hover:text-foreground"
          }`}
          title="Copy full configuration object to clipboard"
        >
          {isCopied ? "Copied!" : "Copy"}
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleDrag}
            className={`cursor-pointer border px-2 py-1 text-hud-sm font-semibold transition active:scale-98 ${
              isDragEnabled
                ? "border-neutral-200 bg-neutral-200/20 text-neutral-200 shadow-sm shadow-neutral-300/20"
                : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
            }`}
            title={
              isDragEnabled
                ? "Screen camera drag is ON (Click to disable screen drag)"
                : "Screen camera drag is OFF (Click to enable screen drag)"
            }
          >
            {isDragEnabled ? "Drag: ON" : "Drag: OFF"}
          </button>
          <button
            type="button"
            onClick={toggleAllSections}
            className="cursor-pointer border border-foreground/10 bg-foreground/5 px-2 py-1 text-hud-sm text-muted-foreground transition hover:border-foreground/20 hover:bg-foreground/10 hover:text-foreground"
            title={areAllOpen ? "Collapse All Sections" : "Expand All Sections"}
          >
            {areAllOpen ? "Fold" : "Unfold"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="cursor-pointer border border-foreground/10 bg-foreground/5 px-2 py-1 text-hud-sm text-muted-foreground transition hover:border-neutral-200/40 hover:bg-neutral-200/10 hover:text-neutral-200"
            title="Reset all parameters to default"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="cursor-pointer border border-foreground/10 bg-foreground/5 px-2 py-1 text-hud-sm font-bold text-muted-foreground transition hover:border-foreground/20 hover:bg-foreground/15 hover:text-foreground"
            title="Minimize HUD into button"
          >
            ─
          </button>
        </div>
      </div>

      {/* Scrollable Body: Unboxed sections directly inside the single HUD container */}
      <div
        ref={scrollRef}
        data-lenis-prevent
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-1 [scrollbar-width:thin]"
        onWheel={(e) => e.stopPropagation()}
      >
        {/* ── Section 1: Camera & Grid Resolution ── */}
        <HudSection
          title="Camera & Grid"
          isOpen={openSections.camera}
          onToggle={() => toggleSection("camera")}
        >
          {/* Screen Camera Drag Toggle */}
          <div className="mb-1 flex items-center justify-between border-b border-foreground/10 pb-1.5">
            <span className="text-hud-md text-body">Screen Camera Drag</span>
            <button
              type="button"
              onClick={toggleDrag}
              className={`cursor-pointer border px-2 py-0.5 font-mono text-hud-sm font-semibold transition ${
                isDragEnabled
                  ? "border-neutral-200 bg-neutral-200 font-bold text-neutral-950 shadow-sm shadow-neutral-300/30"
                  : "border-foreground/10 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
              }`}
              title="Toggle screen drag camera control"
            >
              {isDragEnabled ? "ENABLED" : "DISABLED"}
            </button>
          </div>

          <HudControl
            paramKey="cameraX"
            label="Camera X"
            value={devStats.cameraX}
            min={-100}
            max={100}
            step={0.1}
            decimals={2}
            nudgeSteps={[-1, -0.1, 0.1, 1]}
            presets={[-10, 0, 10, 20]}
            onChange={(val) =>
              updateCamera(val, devStats.cameraY, devStats.zoom)
            }
          />

          <HudControl
            paramKey="cameraY"
            label="Camera Y"
            value={devStats.cameraY}
            min={-100}
            max={100}
            step={0.1}
            decimals={2}
            nudgeSteps={[-1, -0.1, 0.1, 1]}
            presets={[-10, 0, 5, 10]}
            onChange={(val) =>
              updateCamera(devStats.cameraX, val, devStats.zoom)
            }
          />

          <HudControl
            paramKey="zoom"
            label="Zoom"
            value={devStats.zoom}
            min={5}
            max={500}
            step={1}
            decimals={0}
            nudgeSteps={[-10, -1, 1, 10]}
            presets={[25, 50, 75, 100, 150, 200]}
            onChange={(val) =>
              updateCamera(devStats.cameraX, devStats.cameraY, Math.round(val))
            }
          />

          <HudControl
            paramKey="anchorX"
            label="Anchor X"
            value={devStats.anchorX ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            hint="Expand center X (0=left, 0.5=center, 1=right)"
            nudgeSteps={[-0.1, -0.01, 0.01, 0.1]}
            presets={[0.15, 0.5, 0.85]}
            onChange={(val) => updateParam("anchorX", val)}
          />

          <HudControl
            paramKey="anchorY"
            label="Anchor Y"
            value={devStats.anchorY ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            hint="Expand center Y (0=top, 0.5=center, 1=bottom)"
            nudgeSteps={[-0.1, -0.01, 0.01, 0.1]}
            presets={[0.15, 0.5, 0.85]}
            onChange={(val) => updateParam("anchorY", val)}
          />

          <HudControl
            paramKey="gridCellSizePx"
            label="Cell Size"
            value={devStats.gridCellSizePx}
            min={20}
            max={300}
            step={5}
            decimals={0}
            unit="px"
            nudgeSteps={[-10, 10]}
            presets={[40, 60, 80, 120, 160, 200]}
            onChange={(val) => updateParam("gridCellSizePx", Math.round(val))}
          />
        </HudSection>

        {/* ── Section 2: Noise, Seed & Offset ── */}
        <HudSection
          title="Noise & Terrain"
          isOpen={openSections.noise}
          onToggle={() => toggleSection("noise")}
        >
          <HudControl
            paramKey="noiseFrequency"
            label="Frequency"
            value={devStats.noiseFrequency}
            min={0.2}
            max={10.0}
            step={0.05}
            decimals={2}
            unit="x"
            presets={[0.5, 1.0, 2.0, 4.0, 8.0]}
            onChange={(val) => updateParam("noiseFrequency", val)}
          />

          <HudControl
            paramKey="warpAmount"
            label="Domain Warp"
            value={devStats.warpAmount}
            min={0}
            max={2.5}
            step={0.05}
            decimals={2}
            presets={[0.0, 0.4, 0.8, 1.2, 1.8]}
            onChange={(val) => updateParam("warpAmount", val)}
          />

          <HudControl
            paramKey="noiseRidgedMix"
            label="Clouds ↔ Ridges"
            value={devStats.noiseRidgedMix}
            min={0}
            max={1}
            step={0.05}
            decimals={2}
            hint="0.0 = soft clouds, 1.0 = sharp ridges"
            presets={[0.0, 0.25, 0.5, 0.75, 1.0]}
            onChange={(val) => updateParam("noiseRidgedMix", val)}
          />

          <HudControl
            paramKey="seed"
            label="Seed"
            value={devStats.seed}
            min={1}
            max={100}
            step={1}
            decimals={0}
            presets={[1, 7, 13, 42, 99]}
            onChange={(val) => updateParam("seed", Math.round(val))}
          />

          <HudControl
            paramKey="time"
            label="Time Offset"
            value={devStats.time}
            min={0}
            max={20}
            step={0.1}
            decimals={1}
            presets={[0, 2, 5, 10, 15]}
            onChange={(val) => updateParam("time", val)}
          />
        </HudSection>

        {/* ── Section 3: Brightness & Contrast ── */}
        <HudSection
          title="Brightness & Contrast"
          isOpen={openSections.brightness}
          onToggle={() => toggleSection("brightness")}
        >
          <HudControl
            paramKey="noiseBrightness"
            label="Brightness"
            value={devStats.noiseBrightness}
            min={-0.5}
            max={0.8}
            step={0.005}
            decimals={3}
            presets={[-0.2, 0.0, 0.2, 0.34, 0.5]}
            onChange={(val) => updateParam("noiseBrightness", val)}
          />

          <HudControl
            paramKey="noiseContrast"
            label="Contrast"
            value={devStats.noiseContrast}
            min={1}
            max={40}
            step={0.5}
            decimals={1}
            presets={[5, 10, 20, 30, 40]}
            onChange={(val) => updateParam("noiseContrast", val)}
          />
        </HudSection>

        {/* ── Section 4: Effects (Glitch, CRT, Scanlines & Bleed) ── */}
        <HudSection
          title="Effects (CRT & Glitch)"
          isOpen={openSections.effects}
          onToggle={() => toggleSection("effects")}
        >
          <HudControl
            paramKey="lineDisplaceAmount"
            label="Line Displace"
            value={devStats.lineDisplaceAmount}
            min={0}
            max={0.25}
            step={0.005}
            decimals={3}
            presets={[0.0, 0.02, 0.04, 0.08, 0.15]}
            onChange={(val) => updateParam("lineDisplaceAmount", val)}
          />

          <HudControl
            paramKey="ldSmoothness"
            label="Displace Smooth"
            value={devStats.ldSmoothness}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            presets={[0.1, 0.25, 0.35, 0.5, 0.8]}
            onChange={(val) => updateParam("ldSmoothness", val)}
          />

          <HudControl
            paramKey="phosphorIntensity"
            label="Phosphor RGB"
            value={devStats.phosphorIntensity}
            min={0}
            max={3}
            step={0.05}
            decimals={2}
            presets={[0.0, 0.5, 1.0, 1.5, 2.0]}
            onChange={(val) => updateParam("phosphorIntensity", val)}
          />

          <HudControl
            paramKey="hScanIntensity"
            label="hScan Intensity"
            value={devStats.hScanIntensity}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            presets={[0.0, 0.2, 0.45, 0.7, 1.0]}
            onChange={(val) => updateParam("hScanIntensity", val)}
          />

          <HudControl
            paramKey="hScanPeriod"
            label="hScan Period"
            value={devStats.hScanPeriod}
            min={2}
            max={16}
            step={0.5}
            decimals={1}
            unit="px"
            presets={[2, 4, 6, 8, 12, 16]}
            onChange={(val) => updateParam("hScanPeriod", val)}
          />

          <HudControl
            paramKey="hScanFuzziness"
            label="hScan Fuzziness"
            value={devStats.hScanFuzziness}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            presets={[0.0, 0.3, 0.65, 0.85, 1.0]}
            onChange={(val) => updateParam("hScanFuzziness", val)}
          />

          <HudControl
            paramKey="hBleedSpread"
            label="hBleed Spread"
            value={devStats.hBleedSpread}
            min={0}
            max={15}
            step={0.2}
            decimals={1}
            unit="px"
            presets={[0, 2, 5.5, 8, 12]}
            onChange={(val) => updateParam("hBleedSpread", val)}
          />

          <HudControl
            paramKey="hBleedIntensity"
            label="hBleed Intensity"
            value={devStats.hBleedIntensity}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            presets={[0.0, 0.2, 0.4, 0.7, 1.0]}
            onChange={(val) => updateParam("hBleedIntensity", val)}
          />

          <HudControl
            paramKey="vScanSoftness"
            label="vScan Softness"
            value={devStats.vScanSoftness}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            presets={[0.0, 0.2, 0.45, 0.7, 1.0]}
            onChange={(val) => updateParam("vScanSoftness", val)}
          />
        </HudSection>
      </div>
    </div>
  );
}
