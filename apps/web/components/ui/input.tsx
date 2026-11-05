import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const inputVariants = cva(
  "h-9 min-w-0 rounded-none border border-input bg-transparent py-1 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "w-full px-3",
        cell: "w-full border-transparent px-1 focus-visible:bg-muted",
        matrix:
          "w-full border-transparent px-1 text-center focus-visible:bg-muted appearance-none",
        swatch: "w-9 self-start cursor-pointer p-1",
        indicator:
          "pointer-events-none h-4 w-4 shrink-0 border-0 p-0 disabled:opacity-100",
      },
    },
  },
);
export function Input({
  className,
  type,
  variant = "default",
  ...props
}: ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  );
}
