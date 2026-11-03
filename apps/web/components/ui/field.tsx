import type { ComponentProps } from "react";
export function Field(props: ComponentProps<"label">) {
  return (
    <label
      data-slot="field"
      className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground"
      {...props}
    />
  );
}
