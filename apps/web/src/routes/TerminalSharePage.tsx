import { Suspense, lazy, useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, LockKeyhole } from "lucide-react";
import { useParams } from "react-router-dom";

import { getApiErrorMessage } from "../features/auth/api";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { openTerminalShareAccess } from "../features/terminal/api";
import type { OpenTerminalShareAccessResponse } from "../features/terminal/types";
import { useToast } from "../features/ui/ToastContext";
import { HttpError } from "../shared/api/http";
import { formatDateTime } from "../shared/lib/date";
import { Badge, Button, FormField, PasswordInput } from "../shared/ui";

const TerminalShareViewer = lazy(async () => {
  const module = await import("../features/terminal/TerminalShareViewer");
  return { default: module.TerminalShareViewer };
});

const terminalShareAccessCachePrefix = "online-ssh-terminal-share-access:";
const terminalShareOpenIdempotencyKeyPrefix = "online-ssh-terminal-share-open-key:";
const terminalShareViewerTokenExpirySkewMs = 5000;
const pendingTerminalShareAccessRequests = new Map<string, Promise<OpenTerminalShareAccessResponse>>();
const fallbackTerminalShareOpenIdempotencyKeys = new Map<string, string>();

function terminalShareAccessCacheKey(token: string) {
  return `${terminalShareAccessCachePrefix}${token}`;
}

function terminalShareOpenIdempotencyStorageKey(token: string) {
  return `${terminalShareOpenIdempotencyKeyPrefix}${token}`;
}

function terminalShareAccessRequestKey(token: string, password: string, idempotencyKey: string) {
  return `${token}\u0000${password}\u0000${idempotencyKey}`;
}

function terminalShareSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function parseTime(value?: string | null) {
  if (!value) {
    return NaN;
  }
  return Date.parse(value);
}

function generateTerminalShareOpenIdempotencyKey() {
  const prefix = "terminal-share-open-";
  const cryptoApi = typeof window !== "undefined" ? window.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}${cryptoApi.randomUUID()}`;
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getTerminalShareOpenIdempotencyKey(token: string) {
  const fallbackKey = `fallback:${token}`;
  const storage = terminalShareSessionStorage();
  if (!storage || !token) {
    const existingFallback = fallbackTerminalShareOpenIdempotencyKeys.get(fallbackKey);
    if (existingFallback) {
      return existingFallback;
    }
    const generated = generateTerminalShareOpenIdempotencyKey();
    fallbackTerminalShareOpenIdempotencyKeys.set(fallbackKey, generated);
    return generated;
  }
  const key = terminalShareOpenIdempotencyStorageKey(token);
  try {
    const existing = storage.getItem(key);
    if (existing) {
      return existing;
    }
    const generated = generateTerminalShareOpenIdempotencyKey();
    storage.setItem(key, generated);
    return generated;
  } catch {
    const existingFallback = fallbackTerminalShareOpenIdempotencyKeys.get(fallbackKey);
    if (existingFallback) {
      return existingFallback;
    }
    const generated = generateTerminalShareOpenIdempotencyKey();
    fallbackTerminalShareOpenIdempotencyKeys.set(fallbackKey, generated);
    return generated;
  }
}

function isReusableTerminalShareAccess(access: OpenTerminalShareAccessResponse, now = Date.now()) {
  const viewerTokenExpiresAt = parseTime(access.viewer_token_expires_at);
  const shareExpiresAt = parseTime(access.share.expires_at);
  return Boolean(
    access.viewer_token &&
    access.websocket?.url &&
    access.websocket.protocol === "terminal-share.v1" &&
    !access.share.revoked_at &&
    Number.isFinite(viewerTokenExpiresAt) &&
    Number.isFinite(shareExpiresAt) &&
    viewerTokenExpiresAt - terminalShareViewerTokenExpirySkewMs > now &&
    shareExpiresAt > now
  );
}

function readCachedTerminalShareAccess(token: string) {
  const storage = terminalShareSessionStorage();
  if (!storage || !token) {
    return null;
  }
  const key = terminalShareAccessCacheKey(token);
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OpenTerminalShareAccessResponse;
    if (isReusableTerminalShareAccess(parsed)) {
      return parsed;
    }
    storage.removeItem(key);
  } catch {
    storage.removeItem(key);
  }
  return null;
}

function cacheTerminalShareAccess(token: string, access: OpenTerminalShareAccessResponse) {
  const storage = terminalShareSessionStorage();
  if (!storage || !token || !isReusableTerminalShareAccess(access)) {
    return;
  }
  try {
    storage.setItem(terminalShareAccessCacheKey(token), JSON.stringify(access));
  } catch {
    // Ignore storage quota or privacy-mode failures; the share still works without refresh reuse.
  }
}

function clearCachedTerminalShareAccess(token: string) {
  const storage = terminalShareSessionStorage();
  if (!storage || !token) {
    return;
  }
  try {
    storage.removeItem(terminalShareAccessCacheKey(token));
  } catch {
    // Ignore storage failures.
  }
}

async function openTerminalShareAccessOnce(token: string, password: string, idempotencyKey: string) {
  const key = terminalShareAccessRequestKey(token, password, idempotencyKey);
  const pending = pendingTerminalShareAccessRequests.get(key);
  if (pending) {
    return pending;
  }
  const request = openTerminalShareAccess(token, password, { idempotencyKey });
  pendingTerminalShareAccessRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (pendingTerminalShareAccessRequests.get(key) === request) {
      pendingTerminalShareAccessRequests.delete(key);
    }
  }
}

export function TerminalSharePage() {
  const { token = "" } = useParams();
  const { language, t } = usePreferences();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [shareAccess, setShareAccess] = useState<OpenTerminalShareAccessResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState(t("terminal.share.viewerOpening"));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [opening, setOpening] = useState(false);

  const openShare = useCallback(async (passwordValue: string) => {
    if (!token) {
      setErrorMessage(t("terminal.share.viewerMissingToken"));
      return;
    }
    setOpening(true);
    setErrorMessage(null);
    try {
      const response = await openTerminalShareAccessOnce(token, passwordValue, getTerminalShareOpenIdempotencyKey(token));
      cacheTerminalShareAccess(token, response);
      setShareAccess(response);
      setPasswordRequired(false);
      setStatusMessage(t("terminal.share.viewerConnecting"));
    } catch (error) {
      clearCachedTerminalShareAccess(token);
      if (error instanceof HttpError && error.code === "TERMINAL_SHARE_PASSWORD_INVALID") {
        setPasswordRequired(true);
        setErrorMessage(passwordValue.trim() ? t("terminal.share.viewerPasswordInvalid") : t("terminal.share.viewerPasswordRequired"));
        return;
      }
      if (error instanceof HttpError && error.code === "TERMINAL_SHARE_ACCESS_LIMIT") {
        const message = t("terminal.share.viewerAccessLimit");
        setPasswordRequired(false);
        setErrorMessage(message);
        toast.error(message);
        return;
      }
      if (error instanceof HttpError && error.code === "TERMINAL_SHARE_NOT_AVAILABLE") {
        const message = t("terminal.share.viewerUnavailable");
        setPasswordRequired(false);
        setErrorMessage(message);
        toast.error(message);
        return;
      }
      const message = getApiErrorMessage(error, t("terminal.share.viewerOpenFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setOpening(false);
    }
  }, [t, toast, token]);

  useEffect(() => {
    setShareAccess(null);
    setPassword("");
    setPasswordRequired(false);
    setStatusMessage(t("terminal.share.viewerOpening"));
    const cachedAccess = readCachedTerminalShareAccess(token);
    if (cachedAccess) {
      setShareAccess(cachedAccess);
      setStatusMessage(t("terminal.share.viewerConnecting"));
      return;
    }
    void openShare("");
  }, [openShare, t, token]);

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void openShare(password);
  };

  const updateShareExpiry = useCallback((expiresAtValue?: string | null) => {
    if (!expiresAtValue) {
      return;
    }
    setShareAccess((current) => {
      if (!current || current.share.expires_at === expiresAtValue) {
        return current;
      }
      const nextAccess: OpenTerminalShareAccessResponse = {
        ...current,
        share: {
          ...current.share,
          expires_at: expiresAtValue
        }
      };
      cacheTerminalShareAccess(token, nextAccess);
      return nextAccess;
    });
  }, [token]);

  const expiresAt = shareAccess?.share.expires_at
    ? formatDateTime(shareAccess.share.expires_at, language, shareAccess.share.expires_at)
    : null;

  return (
    <main className="terminal-share-page">
      <section className="terminal-share-viewer-shell">
        <header className="terminal-share-viewer-header">
          <div>
            <p className="eyebrow">{t("terminal.share.viewerEyebrow")}</p>
            <h1>{t("terminal.share.viewerTitle")}</h1>
          </div>
          <Badge className="terminal-share-readonly-badge" size="md" tone="info">
            <Eye aria-hidden="true" />
            {t("terminal.share.readOnly")}
          </Badge>
        </header>

        <div className="terminal-share-viewer-meta">
          <span>{statusMessage}</span>
          {expiresAt ? <span>{t("terminal.share.viewerExpiresAt", { date: expiresAt })}</span> : null}
        </div>

        {shareAccess?.share.sensitive_prompt ? (
          <p className="terminal-share-sensitive">{shareAccess.share.sensitive_prompt}</p>
        ) : null}

        {passwordRequired ? (
          <form className="terminal-share-password-form" onSubmit={submitPassword}>
            <FormField className="terminal-share-password-field" error={errorMessage} label={t("terminal.share.viewerPassword")}>
              {(id) => (
                <PasswordInput
                  autoFocus
                  hideLabel={t("auth.hidePassword")}
                  id={id}
                  label={t("terminal.share.viewerPassword")}
                  onChange={(event) => setPassword(event.target.value)}
                  showLabel={t("auth.showPassword")}
                  value={password}
                />
              )}
            </FormField>
            <Button
              className="terminal-share-password-submit"
              disabled={opening}
              leadingIcon={<LockKeyhole aria-hidden="true" />}
              type="submit"
              variant="primary"
            >
              {opening ? t("common.loading") : t("terminal.share.viewerOpen")}
            </Button>
          </form>
        ) : null}

        {shareAccess ? (
          <Suspense fallback={<div className="terminal-share-viewer-placeholder">{t("terminal.share.viewerConnecting")}</div>}>
            <TerminalShareViewer
              active
              onStateChange={(update) => {
                if (update.expiresAt) {
                  updateShareExpiry(update.expiresAt);
                }
                if (update.message) {
                  setStatusMessage(update.message);
                }
                if (update.status === "disconnected" || update.status === "failed") {
                  const message = update.message || t("terminal.share.viewerClosed");
                  clearCachedTerminalShareAccess(token);
                  setShareAccess(null);
                  setErrorMessage(message);
                  setStatusMessage(message);
                }
              }}
              protocol={shareAccess.websocket.protocol}
              websocketUrl={shareAccess.websocket.url}
            />
          </Suspense>
        ) : !passwordRequired ? (
          <div className="terminal-share-viewer-placeholder">
            {opening ? t("terminal.share.viewerOpening") : errorMessage}
          </div>
        ) : null}
      </section>
    </main>
  );
}
