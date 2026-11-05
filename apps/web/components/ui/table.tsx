import { Input } from "./input";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Table({
  className,
  variant = "default",
  ...props
}: ComponentProps<"table"> & { variant?: "default" | "matrix" | "colors" }) {
  return (
    <table
      data-slot="table"
      className={cn(
        "w-full border-collapse text-sm",
        variant === "matrix" && "w-max min-w-full table-fixed",
        variant === "colors" && "table-fixed",
        className,
      )}
      {...props}
    />
  );
}
export function TableHeader(props: ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className="border-b-2 border-foreground"
      {...props}
    />
  );
}
export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />;
}
export function TableRow({
  className,
  variant = "default",
  ...props
}: ComponentProps<"tr"> & { variant?: "default" | "spacer" }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        variant === "spacer"
          ? "h-(--spacer-height) border-0"
          : "border-b border-border",
        className,
      )}
      {...props}
    />
  );
}
export function TableHead({
  className,
  scope = "col",
  variant = "default",
  ...props
}: ComponentProps<"th"> & {
  variant?:
    "default" | "matrix" | "matrix-label" | "selection" | "actions" | "swatch";
}) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        "sticky top-0 z-10 h-11 min-w-24 whitespace-nowrap bg-background px-3 text-left align-middle font-medium text-muted-foreground",
        variant === "swatch" && "w-20 min-w-20",
        variant === "matrix-label" && "w-40 min-w-40 first:left-0 first:z-20",
        variant === "selection" && "w-11 min-w-11 text-center",
        variant === "actions" && "w-14 min-w-14",
        variant === "matrix" &&
          "w-24 min-w-24 max-w-24 text-center first:left-0 first:z-20",
        scope === "row" && "left-0 top-auto z-10 whitespace-nowrap text-left",
        className,
      )}
      {...props}
    />
  );
}
export function TableCell({
  className,
  variant = "default",
  ...props
}: ComponentProps<"td"> & {
  variant?: "default" | "matrix" | "selection" | "actions";
}) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-11 min-w-24 px-3 py-0 align-middle",
        variant === "selection" && "w-11 min-w-11 text-center",
        variant === "actions" && "w-14 min-w-14",
        variant === "matrix" &&
          "w-24 min-w-24 max-w-24 data-[custom=true]:bg-accent/50",
        className,
      )}
      {...props}
    />
  );
}
export function TableScroll({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="table-scroll"
      className={cn("max-h-120 overflow-auto", className)}
      {...props}
    />
  );
}
export function TableToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="table-toolbar"
      className={cn("flex flex-wrap items-center gap-2 py-4", className)}
      {...props}
    />
  );
}
export function TableFooter(props: ComponentProps<"p">) {
  return (
    <p
      data-slot="table-footer"
      className="mt-4 text-sm text-muted-foreground"
      {...props}
    />
  );
}

export function TableFilter({
  query,
  onQueryChange,
  count,
  label = "Search Table",
}: {
  query: string;
  onQueryChange: (query: string) => void;
  count?: number;
  label?: string;
}) {
  return (
    <>
      <Input
        className="w-60 max-w-full"
        aria-label={label}
        placeholder="Filter Rows..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {count !== undefined && (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {count} rows
        </span>
      )}
    </>
  );
}
