"use client";

import GridBackground from "../background-effect";
import ContactLinks from "../contact-links";

const HEADER_CONFIG = {
  seed: 2,
  cameraX: 10,
  cameraY: 4,
  noiseBrightness: 0.36,
  noiseContrast: 24,
};
const HEADER_GRADATION = { rowCount: 2, direction: "down" } as const;
const HEADER_EVENTS: NonNullable<
  import("../background-effect/types").GridBackgroundProps["initialEvents"]
> = [
  {
    property: "noiseBrightness",
    stepSize: 0.002,
    keyframes: [
      { target: 0, duration: 0 },
      { target: 0.36, duration: 1000, ease: "easeOut" },
    ],
  },
];
const FOOTER_CONFIG = {
  seed: 7,
  cameraY: 0,
  cameraX: 0,
  noiseBrightness: 0.36,
  noiseContrast: 24,
};
const FOOTER_GRADATION = { rowCount: 2, direction: "up" } as const;

export function AppHeader() {
  return (
    <header>
      <GridBackground
        className="masthead"
        config={HEADER_CONFIG}
        gradation={HEADER_GRADATION}
        initialEvents={HEADER_EVENTS}
      >
        <div className="hero">
          <p className="mb-4 text-xs font-medium tracking-widest text-muted-foreground">
            Production planning · Browser workspace
          </p>
          <h1>Flexo Scheduler</h1>
          <p className="mt-6 max-w-prose text-base leading-relaxed text-muted-foreground">
            Plan flexographic print jobs across your machines. Balance ink
            changeovers and production time, then compare schedules as new work
            arrives.
          </p>
          <dl className="mt-12 grid max-w-5xl gap-6 text-sm sm:grid-cols-3 [&_dt]:mb-2 [&_dt]:text-muted-foreground [&_dd]:m-0">
            <div>
              <dt>Engine</dt>
              <dd>WebAssembly optimizer</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>Saved locally in your browser</dd>
            </div>
            <div>
              <dt>Workflow</dt>
              <dd>Jobs → Machines → Schedule</dd>
            </div>
          </dl>
        </div>
      </GridBackground>
    </header>
  );
}
export function AppFooter() {
  return (
    <footer className="mt-16">
      <GridBackground config={FOOTER_CONFIG} gradation={FOOTER_GRADATION}>
        <div className="portfolio-footer-content">
          <h2>
            Javier <br /> Reansyah
          </h2>
          <ContactLinks />
        </div>
      </GridBackground>
    </footer>
  );
}
