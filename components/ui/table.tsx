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
        variant === "matrix" && "w-max min-w-full sm:table-fixed",
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
      className="border-b-2 border-border"
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
        "sticky top-0 z-10 h-11 min-w-0 whitespace-nowrap bg-background px-2 sm:min-w-24 sm:px-3 text-left align-middle font-medium text-muted-foreground",
        variant === "swatch" && "w-16 min-w-16 sm:w-20 sm:min-w-20",
        variant === "matrix-label" &&
          "w-px min-w-0 first:left-0 first:z-20 sm:w-40 sm:min-w-40",
        variant === "selection" && "w-11 min-w-11 text-center sm:min-w-11",
        variant === "actions" &&
          "w-11 min-w-11 px-1 sm:w-14 sm:min-w-14 sm:px-3",
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
        "h-11 min-w-0 px-2 py-0 align-middle sm:min-w-24 sm:px-3",
        variant === "selection" && "w-11 min-w-11 text-center sm:min-w-11",
        variant === "actions" &&
          "w-11 min-w-11 px-1 sm:w-14 sm:min-w-14 sm:px-3",
        variant === "matrix" &&
          "w-16 min-w-16 max-w-16 data-[custom=true]:bg-accent/50 sm:w-24 sm:min-w-24 sm:max-w-24",
        className,
      )}
      {...props}
    />
  );
}
export function TableScroll({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "matrix" }) {
  return (
    <div
      data-slot="table-scroll"
      data-variant={variant}
      role="region"
      aria-label="Scrollable table"
      tabIndex={0}
      className={cn(
        "max-h-120 overflow-auto focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
        className,
      )}
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
        className="w-32 min-w-0 max-w-full sm:w-60"
        aria-label={label}
        placeholder="Filter Rows..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {count !== undefined && (
        <span className="order-last w-full whitespace-nowrap text-sm text-muted-foreground sm:order-none sm:w-auto">
          {count} rows
        </span>
      )}
    </>
  );
}
