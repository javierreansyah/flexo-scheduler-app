"use client";
import { Dialog as Primitive } from "@base-ui/react/dialog";
export const Dialog = Primitive.Root;
export function DialogTitle(props: Primitive.Title.Props) {
  return <Primitive.Title className="text-base font-medium" {...props} />;
}
export function DialogDescription(props: Primitive.Description.Props) {
  return (
    <Primitive.Description
      className="text-sm text-muted-foreground"
      {...props}
    />
  );
}
export function DialogContent(props: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="fixed inset-0 z-50 bg-background/80" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Primitive.Popup
          className="flex w-full max-w-sm flex-col gap-4 border border-border bg-popover p-6 text-popover-foreground outline-none"
          {...props}
        />
      </div>
    </Primitive.Portal>
  );
}
