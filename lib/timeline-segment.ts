export function timelineSegment(
  from: number,
  to: number,
  start: number,
  span: number,
) {
  const left = Math.max(start, from);
  const right = Math.min(start + span, to);
  if (right <= left) return null;
  return {
    left: ((left - start) / span) * 100,
    width: ((right - left) / span) * 100,
  };
}
