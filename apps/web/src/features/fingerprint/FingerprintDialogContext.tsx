import { Suspense, createContext, lazy, useContext, useRef, useState, type ReactNode } from "react";

import { getApiErrorMessage } from "../auth/api";
import { usePreferences } from "../preferences/PreferencesContext";
import { useToast } from "../ui/ToastContext";
import { confirmHostFingerprint } from "./api";
import type { FingerprintDialogOptions } from "./FingerprintDialogPresenter";

const FingerprintDialogPresenter = lazy(async () => {
  const module = await import("./FingerprintDialogPresenter");
  return { default: module.FingerprintDialogPresenter };
});

type FingerprintDialogContextValue = {
  requestConfirmation: (options: FingerprintDialogOptions) => Promise<boolean>;
};

const FingerprintDialogContext = createContext<FingerprintDialogContextValue | null>(null);

export function FingerprintDialogProvider({ children }: { children: ReactNode }) {
  const { language, t } = usePreferences();
  const toast = useToast();
  const [pendingRequest, setPendingRequest] = useState<FingerprintDialogOptions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirmation = (options: FingerprintDialogOptions) =>
    new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setError(null);
      setPendingRequest(options);
    });

  const closeDialog = (confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPendingRequest(null);
    setSubmitting(false);
    setError(null);
  };

  const handleConfirm = async () => {
    if (!pendingRequest) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await confirmHostFingerprint(pendingRequest.hostId, {
        algorithm: pendingRequest.conflict.current_fingerprint.algorithm,
        fingerprint: pendingRequest.conflict.current_fingerprint.fingerprint
      });
      closeDialog(true);
    } catch (confirmError) {
      const message = getApiErrorMessage(confirmError, t("fingerprint.failed"), t);
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  };

  return (
    <FingerprintDialogContext.Provider value={{ requestConfirmation }}>
      {children}

      {pendingRequest ? (
        <Suspense fallback={null}>
          <FingerprintDialogPresenter
            language={language}
            onCancel={() => closeDialog(false)}
            onConfirm={() => void handleConfirm()}
            pendingRequest={pendingRequest}
            submitting={submitting}
            t={t}
          />
        </Suspense>
      ) : null}
    </FingerprintDialogContext.Provider>
  );
}

export function useFingerprintDialog() {
  const value = useContext(FingerprintDialogContext);
  if (!value) {
    throw new Error("useFingerprintDialog must be used within FingerprintDialogProvider");
  }

  return value;
}
