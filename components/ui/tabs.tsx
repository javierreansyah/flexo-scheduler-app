"use client";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "cn";
export const Tabs = TabsPrimitive.Root;
export const TabsPanel = TabsPrimitive.Panel;
export function TabsList({
  className,
  borderless = false,
  ...props
}: TabsPrimitive.List.Props & { borderless?: boolean }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-borderless={borderless || undefined}
      className={cn(
        "flex overflow-x-auto gap-2",
        borderless ? "" : "border-b border-border",
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "min-h-12 border-b-2 border-transparent px-2 py-3 font-serif text-lg sm:px-4 text-muted-foreground outline-none data-active:border-primary data-active:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
