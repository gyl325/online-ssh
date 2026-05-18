import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type PropsWithChildren } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { usePreferences } from "../preferences/PreferencesContext";
import { IconButton } from "../../shared/ui";

type ToastType = "success" | "error" | "warning" | "info";

type ToastInput = {
  message: string;
  title?: string;
  type?: ToastType;
  durationMs?: number;
};

type ToastItem = Required<Pick<ToastInput, "message" | "type">> & {
  durationMs: number;
  id: string;
  title?: string;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => string;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_TOAST_DURATION_MS = 4200;
const ERROR_TOAST_DURATION_MS = 7000;
const TOAST_EXIT_ANIMATION_MS = 180;

function createToastId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toastIcon(type: ToastType) {
  switch (type) {
    case "success":
      return <CheckCircle2 aria-hidden="true" />;
    case "error":
      return <XCircle aria-hidden="true" />;
    case "warning":
      return <AlertTriangle aria-hidden="true" />;
    default:
      return <Info aria-hidden="true" />;
  }
}

type ToastCardProps = {
  closeLabel: string;
  onDismiss: (id: string) => void;
  toast: ToastItem;
};

function ToastCard({ closeLabel, onDismiss, toast }: ToastCardProps) {
  const [isExiting, setIsExiting] = useState(false);
  const dismissRef = useRef(onDismiss);
  const exitTimeoutRef = useRef<number | null>(null);
  const isExitingRef = useRef(false);
  const remainingMsRef = useRef(toast.durationMs);
  const timerStartedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timerStartedAtRef.current = null;
  }, []);

  const clearExitTimer = useCallback(() => {
    if (exitTimeoutRef.current !== null) {
      window.clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
  }, []);

  const beginDismiss = useCallback(() => {
    if (isExitingRef.current) {
      return;
    }

    isExitingRef.current = true;
    clearTimer();
    setIsExiting(true);

    exitTimeoutRef.current = window.setTimeout(() => {
      dismissRef.current(toast.id);
    }, TOAST_EXIT_ANIMATION_MS);
  }, [clearTimer, toast.id]);

  const startTimer = useCallback(() => {
    if (isExitingRef.current) {
      return;
    }

    clearTimer();
    timerStartedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(beginDismiss, remainingMsRef.current);
  }, [beginDismiss, clearTimer]);

  const pauseTimer = useCallback(() => {
    if (timeoutRef.current === null || timerStartedAtRef.current === null || isExitingRef.current) {
      return;
    }

    remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - timerStartedAtRef.current));
    clearTimer();
  }, [clearTimer]);

  const resumeTimer = useCallback(() => {
    if (timeoutRef.current !== null || isExitingRef.current) {
      return;
    }

    if (remainingMsRef.current <= 0) {
      beginDismiss();
      return;
    }

    startTimer();
  }, [beginDismiss, startTimer]);

  const handleBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      resumeTimer();
    }
  }, [resumeTimer]);

  useEffect(() => {
    remainingMsRef.current = toast.durationMs;
    startTimer();

    return () => {
      clearTimer();
      clearExitTimer();
    };
  }, [clearExitTimer, clearTimer, startTimer, toast.durationMs]);

  return (
    <article
      className={`toast-card toast-card-${toast.type}${isExiting ? " toast-card-exiting" : ""}`}
      onBlur={handleBlur}
      onFocus={pauseTimer}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
    >
      <span className="toast-icon">{toastIcon(toast.type)}</span>
      <div className="toast-content">
        {toast.title ? <strong>{toast.title}</strong> : null}
        <p>{toast.message}</p>
      </div>
      <IconButton className="toast-close" label={closeLabel} onClick={beginDismiss} variant="ghost">
        <X aria-hidden="true" />
      </IconButton>
    </article>
  );
}

export function ToastProvider({ children }: PropsWithChildren) {
  const { t } = usePreferences();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    if (!toast.message.trim()) {
      return "";
    }

    const id = createToastId();
    const type = toast.type || "info";
    setToasts((current) => [
      ...current,
      {
        id,
        durationMs: toast.durationMs ?? (type === "error" ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS),
        message: toast.message,
        title: toast.title,
        type
      }
    ]);

    return id;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    showToast,
    success: (message, title) => showToast({ message, title, type: "success" }),
    error: (message, title) => showToast({ message, title, type: "error" }),
    warning: (message, title) => showToast({ message, title, type: "warning" }),
    info: (message, title) => showToast({ message, title, type: "info" })
  }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-label={t("toast.regionLabel")} className="toast-viewport" role="status">
        {toasts.map((toast) => (
          <ToastCard closeLabel={t("common.close")} key={toast.id} onDismiss={dismissToast} toast={toast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return value;
}
