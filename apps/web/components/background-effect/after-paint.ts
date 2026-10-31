/** Give the browser a paint opportunity before starting decorative GPU work. */
export function afterPaint(callback: () => void) {
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(callback);
  });
  return () => cancelAnimationFrame(frame);
}

/** Let pending typography finish painting before compiling decorative shaders. */
export function afterTextPaint(callback: () => void) {
  let cancelled = false;
  let cancelPaint: (() => void) | undefined;
  const schedule = () => {
    if (!cancelled) cancelPaint = afterPaint(callback);
  };
  if (document.fonts?.status === "loading") {
    // Font failure should still allow the background to render with fallback text.
    void document.fonts.ready.then(schedule, schedule);
  } else schedule();
  return () => {
    cancelled = true;
    cancelPaint?.();
  };
}
