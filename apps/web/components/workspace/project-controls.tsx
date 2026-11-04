"use client";
import { Field } from "@/components/ui/field";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowUpRight,
  Download,
  MoreHorizontal,
  Plus,
  Upload,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectGroupLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { advance, example, importProject, initial } from "@/lib/model";

import { download } from "@/lib/download";
import { useWorkspace } from "./workspace-context";

export function ProjectControls() {
  const {
    project,
    update,
    ready,
    busy,
    setError,
    selectCheckpoint,
    labels,
    unavailable,
    snapshot,
    history,
    action,
    replace,
  } = useWorkspace();
  const [arrival, setArrival] = useState(1);
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <section className="flex flex-col gap-4" aria-label="Project controls">
        <h3 className="text-base font-medium">Project</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || !ready}
            className="flex-1"
            onClick={() => replace(initial())}
          >
            <Plus size={14} /> New
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Project actions"
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={busy || !ready}
                onClick={() => file.current?.click()}
              >
                <Upload size={16} /> Import Project
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!ready}
                onClick={() =>
                  download(
                    "flexo-project.json",
                    JSON.stringify(project, null, 2),
                  )
                }
              >
                <Download size={16} /> Export Project
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || !ready}
                onClick={() => replace(example())}
              >
                Industry Example
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Field>
          Horizon
          <Select
            value={project.horizons!.active}
            disabled={busy || !ready}
            onValueChange={(value) => {
              if (value) selectCheckpoint(value);
            }}
            items={project.horizons!.nodes.map((n) => ({
              value: n.id,
              label: labels.get(n.id),
            }))}
          >
            <SelectTrigger aria-label="Horizon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ...new Set(
                  project.horizons!.nodes.map((n) => n.state.snapshot.now),
                ),
              ]
                .sort((a, b) => a - b)
                .map((time) => (
                  <SelectGroup key={time}>
                    <SelectGroupLabel>Horizon {time}h</SelectGroupLabel>
                    {project
                      .horizons!.nodes.filter(
                        (n) => n.state.snapshot.now === time,
                      )
                      .map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {labels.get(n.id)}
                          {n.unavailable ? " · view only" : ""}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
            </SelectContent>
          </Select>
        </Field>
        {history.length > 0 && (
          <div className="flex items-end gap-2">
            <Field>
              Arrival Hour{" "}
              <Input
                aria-label="Next batch arrival hour"
                type="number"
                min={snapshot.now}
                step="any"
                value={arrival}
                onChange={(e) => setArrival(+e.target.value)}
              />
            </Field>
            <Button
              variant="outline"
              disabled={
                busy || !ready || unavailable || arrival <= snapshot.now
              }
              onClick={() =>
                action(() => {
                  update(advance(project, arrival));
                  setArrival(arrival + 1);
                })
              }
            >
              Start Next Batch <ArrowUpRight size={14} />
            </Button>
          </div>
        )}
      </section>
      <Input
        ref={file}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f)
            try {
              replace(importProject(JSON.parse(await f.text())));
            } catch (e) {
              setError(String(e));
            }
          e.target.value = "";
        }}
      />
    </>
  );
}
