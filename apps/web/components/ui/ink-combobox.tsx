"use client";
import { Combobox } from "@base-ui/react/combobox";
import { useRef, useState } from "react";
import { X } from "lucide-react";

export function InkCombobox({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return (
    <Combobox.Root
      multiple
      items={options}
      value={selected}
      disabled={disabled}
      autoHighlight
      open={open}
      onOpenChange={setOpen}
      inputValue={query}
      onInputValueChange={setQuery}
      onValueChange={(items) => {
        onChange(items.join(", "));
        setQuery("");
        setOpen(false);
      }}
    >
      <Combobox.Chips
        ref={anchor}
        className="flex min-h-9 min-w-24 flex-nowrap overflow-x-auto items-center gap-1 border border-transparent px-2 py-1 focus-within:border-input focus-within:ring-2 focus-within:ring-ring/50 data-disabled:opacity-50"
      >
        {selected.map((name, index) => (
          <Combobox.Chip
            key={`${name}-${index}`}
            className="flex shrink-0 items-center gap-1 border border-border bg-muted px-2 text-sm"
          >
            {name}
            <Combobox.ChipRemove
              aria-label={`Remove ${name}`}
              className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-3" />
            </Combobox.ChipRemove>
          </Combobox.Chip>
        ))}
        <Combobox.Input
          aria-label={label}
          placeholder={selected.length ? "" : "Choose Inks"}
          className="min-w-12 flex-1 bg-transparent text-sm outline-none"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
            if (event.key === "Tab" && query.trim()) {
              const match = options.find(
                (option) =>
                  !selected.includes(option) &&
                  option.toLowerCase().includes(query.trim().toLowerCase()),
              );
              if (match) {
                event.preventDefault();
                onChange([...selected, match].join(", "));
                setQuery("");
                setOpen(false);
              }
            }
          }}
        />
      </Combobox.Chips>
      <Combobox.Portal>
        <Combobox.Positioner anchor={anchor} sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-60 min-w-(--anchor-width) overflow-auto border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            <Combobox.Empty className="px-2 py-2 text-sm text-muted-foreground empty:py-0">
              No colors found.
            </Combobox.Empty>
            <Combobox.List>
              {(item: string) => (
                <Combobox.Item
                  key={item}
                  value={item}
                  className="flex min-h-9 cursor-default items-center px-2 text-sm outline-none data-highlighted:bg-accent data-selected:font-medium"
                >
                  {item}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
