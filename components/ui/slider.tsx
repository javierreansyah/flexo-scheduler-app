"use client";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
export function Slider({
  "aria-label": label,
  variant = "default",
  ...props
}: SliderPrimitive.Root.Props<number> & { variant?: "default" | "timeline" }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={
        variant === "timeline"
          ? "flex min-w-0 max-w-36 flex-1 items-center pr-2 sm:w-36 sm:flex-none"
          : "flex w-36 items-center"
      }
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-9 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-1 w-full bg-muted">
          <SliderPrimitive.Indicator className="bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={label}
            className="size-4 border border-ring bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
