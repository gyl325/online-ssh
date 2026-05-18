import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode } from "react";

import { cx } from "./classNames";
import { IconButton } from "./IconButton";

type DialogSize = "sm" | "md" | "lg";

type DialogProps = {
  bodyClassName?: string;
  children: ReactNode;
  closeLabel: string;
  contentClassName?: string;
  description?: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: DialogSize;
  title: string;
};

export function Dialog({
  bodyClassName,
  children,
  closeLabel,
  contentClassName,
  description,
  footer,
  headerActions,
  onOpenChange,
  open,
  size = "md",
  title
}: DialogProps) {
  const descriptionProps = description ? {} : { "aria-describedby": undefined };
  const hasBody = children !== null && children !== undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content asChild {...descriptionProps}>
          <section
            className={cx(
              "ui-dialog-content",
              `ui-dialog-content-${size}`,
              footer ? "ui-dialog-content-has-footer" : "",
              hasBody ? "ui-dialog-content-has-body" : "ui-dialog-content-no-body",
              contentClassName
            )}
          >
            <header className="ui-dialog-header">
              <div className="ui-dialog-heading">
                <DialogPrimitive.Title className="ui-dialog-title">{title}</DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="ui-dialog-description">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <div className="ui-dialog-header-actions">
                {headerActions}
                <DialogPrimitive.Close asChild>
                  <IconButton className="ui-dialog-close" label={closeLabel} variant="ghost">
                    <X aria-hidden="true" />
                  </IconButton>
                </DialogPrimitive.Close>
              </div>
            </header>
            {hasBody ? <div className={cx("ui-dialog-body", bodyClassName)}>{children}</div> : null}
            {footer ? <footer className="ui-dialog-footer">{footer}</footer> : null}
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
