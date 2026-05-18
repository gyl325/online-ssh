import { type ReactNode } from "react";

import { cx } from "./classNames";
import { Dialog } from "./Dialog";

type DetailDialogSize = "sm" | "md" | "lg";

export type DetailDialogItem = {
  label: ReactNode;
  value: ReactNode;
  valueClassName?: string;
};

type DetailDialogProps = {
  children?: ReactNode;
  closeLabel: string;
  description?: ReactNode;
  emptyState?: ReactNode;
  items: DetailDialogItem[];
  leadingContent?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: DetailDialogSize;
  title: string;
};

export function DetailDialog({
  children,
  closeLabel,
  description,
  emptyState,
  items,
  leadingContent,
  onOpenChange,
  open,
  size = "md",
  title
}: DetailDialogProps) {
  return (
    <Dialog
      closeLabel={closeLabel}
      description={description}
      onOpenChange={onOpenChange}
      open={open}
      size={size}
      title={title}
    >
      <div className="detail-stack">
        {leadingContent}
        {items.length > 0 ? (
          <dl className="detail-list">
            {items.map((item, index) => (
              <div key={index}>
                <dt>{item.label}</dt>
                <dd className={cx(item.valueClassName)}>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          emptyState
        )}
        {children}
      </div>
    </Dialog>
  );
}
