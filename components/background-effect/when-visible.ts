/** Warm decorative graphics shortly before they enter view, once per mount. */
export function whenNearViewport(element: Element, callback: () => void) {
  let started = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) return;
      started = true;
      observer.disconnect();
      callback();
    },
    { rootMargin: "400px 0px", threshold: 0 },
  );
  observer.observe(element);
  return () => {
    started = true;
    observer.disconnect();
  };
}
