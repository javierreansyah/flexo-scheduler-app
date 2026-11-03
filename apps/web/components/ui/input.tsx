import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const inputVariants = cva(
  "h-9 w-full min-w-0 rounded-none border border-input bg-transparent px-3 py-1 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "",
        cell: "border-transparent px-1 focus-visible:bg-muted",
        matrix:
          "border-transparent px-1 text-center focus-visible:bg-muted appearance-none",
        swatch: "w-9 cursor-pointer p-1",
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
