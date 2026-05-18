import { type ReactNode } from "react";

import { ConfirmDialog } from "../../shared/ui";

type ConfirmTone = "default" | "danger";

type ConfirmDialogPresenterProps = {
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

export function ConfirmDialogPresenter(props: ConfirmDialogPresenterProps) {
  return <ConfirmDialog {...props} />;
}
