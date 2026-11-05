"use client";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
export function Slider({
  "aria-label": label,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className="flex w-36 items-center"
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
