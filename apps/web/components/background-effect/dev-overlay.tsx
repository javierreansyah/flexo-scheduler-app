"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { DevStats, GridBackgroundConfig } from "./types";
import { DEFAULT_CONFIG } from "./config";
import type { BackgroundState } from "./runtime-state";
import { DevControlsHud } from "./dev-controls-hud";

export interface DevOverlayProps {
  initialConfig: GridBackgroundConfig;
  dynamicConfigRef: React.RefObject<GridBackgroundConfig>;
  stateRef: React.RefObject<BackgroundState>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  config?: Partial<GridBackgroundConfig>;
}

export default function DevOverlay({
  initialConfig,
  dynamicConfigRef,
  stateRef,
  containerRef,
  config = {},
}: DevOverlayProps) {
  const [devStats, setDevStats] = useState<DevStats>(() => ({
    cameraX: initialConfig.cameraX,
    cameraY: initialConfig.cameraY,
    zoom: initialConfig.zoom,
    anchorX: initialConfig.anchorX ?? 0.5,
    anchorY: initialConfig.anchorY ?? 0.5,
    gridCellSizePx: initialConfig.gridCellSizePx,
    warpAmount: initialConfig.warpAmount ?? 0,
    noiseFrequency: initialConfig.noiseFrequency ?? 1.0,
    noiseRidgedMix: initialConfig.noiseRidgedMix ?? 0.5,
    noiseBrightness: initialConfig.noiseBrightness,
    noiseContrast: initialConfig.noiseContrast,
    seed: initialConfig.seed,
    time: initialConfig.time,
    lineDisplaceAmount: initialConfig.lineDisplaceAmount,
    ldSmoothness: initialConfig.ldSmoothness,
    hScanPeriod: initialConfig.hScanPeriod,
    hScanIntensity: initialConfig.hScanIntensity,
    hScanFuzziness: initialConfig.hScanFuzziness,
    hBleedSpread: initialConfig.hBleedSpread,
    hBleedIntensity: initialConfig.hBleedIntensity,
    vScanSoftness: initialConfig.vScanSoftness,
    phosphorIntensity: initialConfig.phosphorIntensity,
  }));

  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragEnabled, setIsDragEnabled] = useState(true);
  const toggleDrag = useCallback(() => setIsDragEnabled((prev) => !prev), []);

  const devOverlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    isDown: boolean;
    startX: number;
    startY: number;
    initialCamX: number;
    initialCamY: number;
  }>({
    isDown: false,
    startX: 0,
    startY: 0,
    initialCamX: 0,
    initialCamY: 0,
  });

  // Sync devStats when config prop changes
  const configString = JSON.stringify(config);
  useEffect(() => {
    const cur = dynamicConfigRef.current;
    if (cur) {
      setDevStats({
        cameraX: cur.cameraX,
        cameraY: cur.cameraY,
        zoom: cur.zoom,
        anchorX: cur.anchorX ?? 0.5,
        anchorY: cur.anchorY ?? 0.5,
        gridCellSizePx: cur.gridCellSizePx,
        warpAmount: cur.warpAmount ?? 0,
        noiseFrequency: cur.noiseFrequency ?? 1.0,
        noiseRidgedMix: cur.noiseRidgedMix ?? 0.5,
        noiseBrightness: cur.noiseBrightness,
        noiseContrast: cur.noiseContrast,
        seed: cur.seed,
        time: cur.time,
        lineDisplaceAmount: cur.lineDisplaceAmount,
        ldSmoothness: cur.ldSmoothness,
        hScanPeriod: cur.hScanPeriod,
        hScanIntensity: cur.hScanIntensity,
        hScanFuzziness: cur.hScanFuzziness,
        hBleedSpread: cur.hBleedSpread,
        hBleedIntensity: cur.hBleedIntensity,
        vScanSoftness: cur.vScanSoftness,
        phosphorIntensity: cur.phosphorIntensity,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configString]);

  const updateCamera = useCallback(
    (x: number, y: number, z: number) => {
      dynamicConfigRef.current.cameraX = x;
      dynamicConfigRef.current.cameraY = y;
      dynamicConfigRef.current.zoom = z;
      stateRef.current.needsRender = true;
      stateRef.current.wakeLoop?.();
      setDevStats((prev) => ({
        ...prev,
        cameraX: x,
        cameraY: y,
        zoom: z,
      }));
    },
    [dynamicConfigRef, stateRef],
  );

  const updateParam = useCallback(
    (key: keyof GridBackgroundConfig, val: number) => {
      (dynamicConfigRef.current as unknown as Record<string, unknown>)[key] =
        val;
      if (key === "gridCellSizePx" && stateRef.current.resizeFn) {
        const w =
          stateRef.current.containerWidth ||
          containerRef.current?.clientWidth ||
          (typeof window !== "undefined" ? window.innerWidth : 800);
        const h =
          stateRef.current.containerHeight ||
          containerRef.current?.clientHeight ||
          (typeof window !== "undefined" ? window.innerHeight : 600);
        stateRef.current.resizeFn(w, h);
      }
      stateRef.current.needsRender = true;
      stateRef.current.wakeLoop?.();
      setDevStats((prev) => ({ ...prev, [key]: val }));
    },
    [dynamicConfigRef, stateRef, containerRef],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-dev-hud]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      initialCamX: dynamicConfigRef.current.cameraX,
      initialCamY: dynamicConfigRef.current.cameraY,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.isDown) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const cellSize = dynamicConfigRef.current.gridCellSizePx || 120;

    const newX = parseFloat(
      (dragRef.current.initialCamX - dx / cellSize).toFixed(2),
    );
    const newY = parseFloat(
      (dragRef.current.initialCamY - dy / cellSize).toFixed(2),
    );

    updateCamera(newX, newY, dynamicConfigRef.current.zoom);
  };

  const handlePointerUp = () => {
    dragRef.current.isDown = false;
    setIsDragging(false);
  };

  // Arrow key nudge listeners
  useEffect(() => {
    if (!isDragEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const step = e.shiftKey ? 2.0 : 0.2;
      let x = dynamicConfigRef.current.cameraX;
      let y = dynamicConfigRef.current.cameraY;
      let handled = false;

      if (e.key === "ArrowLeft") {
        x = parseFloat((x - step).toFixed(2));
        handled = true;
      } else if (e.key === "ArrowRight") {
        x = parseFloat((x + step).toFixed(2));
        handled = true;
      } else if (e.key === "ArrowUp") {
        y = parseFloat((y + step).toFixed(2));
        handled = true;
      } else if (e.key === "ArrowDown") {
        y = parseFloat((y - step).toFixed(2));
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        updateCamera(x, y, dynamicConfigRef.current.zoom);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDragEnabled, updateCamera, dynamicConfigRef]);

  const handleCopy = () => {
    const keys: (keyof DevStats)[] = [
      "cameraX",
      "cameraY",
      "zoom",
      "anchorX",
      "anchorY",
      "gridCellSizePx",
      "warpAmount",
      "noiseFrequency",
      "noiseRidgedMix",
      "noiseBrightness",
      "noiseContrast",
      "seed",
      "time",
      "lineDisplaceAmount",
      "ldSmoothness",
      "phosphorIntensity",
      "hScanPeriod",
      "hScanIntensity",
      "hScanFuzziness",
      "hBleedSpread",
      "hBleedIntensity",
      "vScanSoftness",
    ];

    const lines = keys.map((key) => {
      const val = devStats[key];
      const formattedVal =
        typeof val === "number"
          ? Number.isInteger(val)
            ? val
            : Number(val.toFixed(4))
          : val;
      return `  ${key}: ${formattedVal},`;
    });

    const text = `{\n${lines.join("\n")}\n}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleReset = () => {
    const fresh = { ...DEFAULT_CONFIG, ...config };
    dynamicConfigRef.current = fresh;
    if (stateRef.current.resizeFn) {
      const w =
        stateRef.current.containerWidth ||
        containerRef.current?.clientWidth ||
        (typeof window !== "undefined" ? window.innerWidth : 800);
      const h =
        stateRef.current.containerHeight ||
        containerRef.current?.clientHeight ||
        (typeof window !== "undefined" ? window.innerHeight : 600);
      stateRef.current.resizeFn(w, h);
    }
    stateRef.current.needsRender = true;
    stateRef.current.wakeLoop?.();
    setDevStats({
      cameraX: fresh.cameraX,
      cameraY: fresh.cameraY,
      zoom: fresh.zoom,
      anchorX: fresh.anchorX ?? 0.5,
      anchorY: fresh.anchorY ?? 0.5,
      gridCellSizePx: fresh.gridCellSizePx,
      warpAmount: fresh.warpAmount ?? 0,
      noiseFrequency: fresh.noiseFrequency ?? 1.0,
      noiseRidgedMix: fresh.noiseRidgedMix ?? 0.5,
      noiseBrightness: fresh.noiseBrightness,
      noiseContrast: fresh.noiseContrast,
      seed: fresh.seed,
      time: fresh.time,
      lineDisplaceAmount: fresh.lineDisplaceAmount,
      ldSmoothness: fresh.ldSmoothness,
      hScanPeriod: fresh.hScanPeriod,
      hScanIntensity: fresh.hScanIntensity,
      hScanFuzziness: fresh.hScanFuzziness,
      hBleedSpread: fresh.hBleedSpread,
      hBleedIntensity: fresh.hBleedIntensity,
      vScanSoftness: fresh.vScanSoftness,
      phosphorIntensity: fresh.phosphorIntensity,
    });
  };

  return (
    <div
      ref={devOverlayRef}
      onPointerDown={isDragEnabled ? handlePointerDown : undefined}
      onPointerMove={isDragEnabled ? handlePointerMove : undefined}
      onPointerUp={isDragEnabled ? handlePointerUp : undefined}
      className={`absolute inset-0 z-50 select-none ${
        isDragEnabled
          ? `pointer-events-auto ${isDragging ? "cursor-grabbing" : "cursor-grab"}`
          : "pointer-events-none"
      }`}
      style={{ touchAction: isDragEnabled ? "none" : "auto" }}
    >
      <DevControlsHud
        devStats={devStats}
        updateCamera={updateCamera}
        updateParam={updateParam}
        handleReset={handleReset}
        handleCopy={handleCopy}
        copied={copied}
        isDragEnabled={isDragEnabled}
        toggleDrag={toggleDrag}
      />
    </div>
  );
}
