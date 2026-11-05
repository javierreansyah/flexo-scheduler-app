"use client";

import RepositoryLinks from "../repository-links";

export function AppHeader() {
  return (
    <header>
      <div className="hero">
        <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
          Industrial Production Planning
        </p>
        <h1>Flexo Scheduler</h1>
        <p className="mt-6 max-w-prose text-base leading-relaxed text-muted-foreground">
          Plan flexographic print jobs across your machines. Balance ink
          changeovers and production time, then compare schedules as new work
          arrives. Use simulated annealing to optimize your schedule.
        </p>
      </div>
    </header>
  );
}
export function AppFooter() {
  return (
    <footer className="product-footer">
      <div className="product-footer-content">
        <div>
          <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
            Production Planning · Open Source
          </p>
          <h2>Flexo Scheduler</h2>
        </div>
        <RepositoryLinks />
      </div>
    </footer>
  );
}
