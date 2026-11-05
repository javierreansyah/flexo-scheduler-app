import type { ComponentProps } from "react";
export function Field({
  compact = false,
  ...props
}: ComponentProps<"label"> & { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex w-fit min-w-0 flex-col gap-2 text-sm text-muted-foreground">
        {props.children}
      </div>
    );
  }
  return (
    <label
      data-slot="field"
      className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground"
      {...props}
    />
  );
}
