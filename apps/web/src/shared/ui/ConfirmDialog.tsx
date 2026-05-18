import { type ReactNode } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

type ConfirmTone = "default" | "danger";

type ConfirmDialogProps = {
  cancelLabel: string;
  closeLabel: string;
  confirmLabel: string;
  message: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: ConfirmTone;
};

export function ConfirmDialog({
  cancelLabel,
  closeLabel,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  title,
  tone = "default"
}: ConfirmDialogProps) {
  return (
    <Dialog
      closeLabel={closeLabel}
      footer={(
        <>
          <Button onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} variant={tone === "danger" ? "danger" : "primary"}>
            {confirmLabel}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={open}
      size="sm"
      title={title}
    >
      <div className="ui-dialog-copy">{message}</div>
    </Dialog>
  );
}
