"use client";

import GridBackground from "../background-effect";
import ContactLinks from "../contact-links";

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
      <div className="hero">
        <p className="mb-4 text-sm text-muted-foreground">
          Production Planning · Browser Workspace
        </p>
        <h1>Flexo Scheduler</h1>
        <p className="mt-6 max-w-prose text-base leading-relaxed text-muted-foreground">
          Plan flexographic print jobs across your machines. Balance ink
          changeovers and production time, then compare schedules as new work
          arrives.
        </p>
      </div>
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
