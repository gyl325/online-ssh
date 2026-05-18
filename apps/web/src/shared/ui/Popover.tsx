import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

import { cx } from "./classNames";

type PopoverProps = {
  align?: RadixPopover.PopoverContentProps["align"];
  children: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  side?: RadixPopover.PopoverContentProps["side"];
  sideOffset?: number;
  trigger: ReactNode;
};

export function Popover({
  align = "start",
  children,
  className,
  onOpenChange,
  open,
  side = "bottom",
  sideOffset = 8,
  trigger
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          className={cx("ui-popover-content", className)}
          side={side}
          sideOffset={sideOffset}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
