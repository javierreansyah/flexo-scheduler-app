"use client";
import { ProjectPanel } from "./workspace/project-panel";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { AppFooter, AppHeader } from "./workspace/app-chrome";
import { ColorsPanel } from "./workspace/colors-panel";
import { ChangeoversPanel } from "./workspace/changeovers-panel";
import { JobsPanel } from "./workspace/jobs-panel";
import { MachinesPanel } from "./workspace/machines-panel";
import { OptimizerControls } from "./workspace/optimizer-controls";
import { ProjectControls } from "./workspace/project-controls";
import { ScheduleResults } from "./workspace/schedule-results";
import { WorkspaceProvider, useWorkspace } from "./workspace/workspace-context";
function WorkspaceContent() {
  const { ready, error, unavailable } = useWorkspace();
  const [tab, setTab] = useState("jobs");
  return (
    <main>
      <AppHeader />
      <div id="workspace" className="workspace">
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
            {!ready ? null : unavailable && tab !== "project" ? (
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
        {ready && <ScheduleResults />}
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
