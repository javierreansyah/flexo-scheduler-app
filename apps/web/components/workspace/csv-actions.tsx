"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { importCsv, jobCsv, machineCsv } from "@/lib/csv";
import { download } from "@/lib/download";
import { MoreHorizontal } from "lucide-react";
import { GenerationDialog } from "./generation-dialog";
import { useRef, useState } from "react";
import { useWorkspace } from "./workspace-context";
export function CsvActions({ kind }: { kind: "jobs" | "machines" }) {
  const {
    snapshot,
    colors,
    physicalLocked,
    busy,
    ready,
    changeSnapshot,
    setError,
  } = useWorkspace();
  const [generate, setGenerate] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={file}
        type="file"
        accept=".csv"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f)
            try {
              changeSnapshot(
                importCsv(
                  await f.text(),
                  kind,
                  snapshot,
                  colors,
                  physicalLocked,
                ),
              );
            } catch (error) {
              setError(String(error));
            }
          e.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={trigger}
              variant="outline"
              size="icon"
              aria-label={kind + " actions"}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            disabled={busy || !ready || (kind === "machines" && physicalLocked)}
            onClick={() => setGenerate(true)}
          >
            Generate {kind === "jobs" ? "Jobs" : "Machines"}…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy || !ready || (kind === "machines" && physicalLocked)}
            onClick={() => file.current?.click()}
          >
            Import CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              download(
                kind + ".csv",
                kind === "jobs"
                  ? jobCsv(snapshot, colors)
                  : machineCsv(snapshot, colors),
                "text/csv",
              )
            }
          >
            Export CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <GenerationDialog
        kind={kind}
        open={generate}
        onOpenChange={setGenerate}
        trigger={trigger}
      />
    </>
  );
}
