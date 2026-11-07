"use client";
import dynamic from "next/dynamic";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { AppFooter, AppHeader } from "./workspace/app-chrome";
import { JobsPanel } from "./workspace/jobs-panel";
import { OptimizerControls } from "./workspace/optimizer-controls";
import { ProjectControls } from "./workspace/project-controls";
import { ScheduleResults } from "./workspace/schedule-results";
import { WorkspaceProvider, useWorkspace } from "./workspace/workspace-context";
const ProjectPanel = dynamic(() =>
  import("./workspace/project-panel").then((m) => m.ProjectPanel),
);
const ColorsPanel = dynamic(() =>
  import("./workspace/colors-panel").then((m) => m.ColorsPanel),
);
const ChangeoversPanel = dynamic(() =>
  import("./workspace/changeovers-panel").then((m) => m.ChangeoversPanel),
);
const MachinesPanel = dynamic(() =>
  import("./workspace/machines-panel").then((m) => m.MachinesPanel),
);
function WorkspaceContent() {
  const { ready, error, unavailable } = useWorkspace();
  const [tab, setTab] = useState("jobs");
  return (
    <main>
      <AppHeader />
      <div id="workspace" className="workspace">
        <h2 className="sr-only">Scheduling workspace</h2>
        {error && (
          <div
            className="my-4 border border-destructive p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}
        <div className="editor-layout">
          <section className="min-w-0">
            <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
              <TabsList aria-label="Production inputs">
                {["jobs", "machines", "colors", "changeovers", "project"].map(
                  (v) => (
                    <TabsTrigger key={v} value={v} disabled={!ready}>
                      {v === "jobs"
                        ? "Jobs"
                        : v === "machines"
                          ? "Machines"
                          : v === "colors"
                            ? "Colors"
                            : v === "changeovers"
                              ? "Changeovers"
                              : "Project"}
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
            </Tabs>
            {unavailable && tab !== "project" ? (
              <p>
                Inputs unavailable for this legacy checkpoint. Select a current
                checkpoint to continue.
              </p>
            ) : tab === "project" ? (
              <ProjectPanel />
            ) : tab === "jobs" ? (
              <JobsPanel />
            ) : tab === "machines" ? (
              <MachinesPanel />
            ) : tab === "colors" ? (
              <ColorsPanel />
            ) : (
              <ChangeoversPanel />
            )}
          </section>
          <aside className="optimizer min-w-0">
            <ProjectControls />
            <OptimizerControls />
          </aside>
        </div>
        <ScheduleResults />
      </div>
      <AppFooter />
    </main>
  );
}
export default function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceContent />
    </WorkspaceProvider>
  );
}
