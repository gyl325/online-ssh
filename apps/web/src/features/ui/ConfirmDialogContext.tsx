import { Suspense, createContext, lazy, useContext, useRef, useState, type PropsWithChildren } from "react";

import { usePreferences } from "../preferences/PreferencesContext";

const ConfirmDialogPresenter = lazy(async () => {
  const module = await import("./ConfirmDialogPresenter");
  return { default: module.ConfirmDialogPresenter };
});

type ConfirmTone = "default" | "danger";

type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmDialogContextValue = {
  requestConfirmation: (options: ConfirmDialogOptions) => Promise<boolean>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function ConfirmDialogProvider({ children }: PropsWithChildren) {
  const { t } = usePreferences();
  const [pendingRequest, setPendingRequest] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirmation = (options: ConfirmDialogOptions) =>
    new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPendingRequest(options);
    });

  const closeDialog = (confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPendingRequest(null);
  };

  return (
    <ConfirmDialogContext.Provider value={{ requestConfirmation }}>
      {children}

      {pendingRequest ? (
        <Suspense fallback={null}>
          <ConfirmDialogPresenter
            cancelLabel={pendingRequest.cancelLabel || t("common.cancel")}
            closeLabel={t("common.close")}
            confirmLabel={pendingRequest.confirmLabel || t("common.confirm")}
            message={pendingRequest.message}
            onCancel={() => closeDialog(false)}
            onConfirm={() => closeDialog(true)}
            open={Boolean(pendingRequest)}
            title={pendingRequest.title}
            tone={pendingRequest.tone}
          />
        </Suspense>
      ) : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const value = useContext(ConfirmDialogContext);
  if (!value) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
  }
  return value;
}
