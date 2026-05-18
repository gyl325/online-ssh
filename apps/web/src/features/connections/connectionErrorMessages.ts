import { getApiErrorMessage } from "../auth/api";
import { isHttpError } from "../../shared/api/http";
import type { Translator } from "../preferences/i18n/translator";

const connectionErrorMessagePatterns: Array<[RegExp, string]> = [
  [/ssh authentication failed|unable to authenticate|no supported methods remain|permission denied/i, "connectionError.sshAuthenticationFailed"],
  [/tcp connection refused|connection refused|econnrefused/i, "connectionError.tcpConnectionRefused"],
  [/ssh connection timed out|i\/o timeout|timed out|timeout|etimedout/i, "connectionError.sshConnectionTimedOut"],
  [/ssh connection canceled|connection cancelled|connection canceled|context canceled/i, "connectionError.sshConnectionCanceled"],
  [/host is unreachable|no route to host|network is unreachable|getaddrinfo|enotfound|resolve/i, "connectionError.hostUnreachable"],
  [/connection reset by peer/i, "connectionError.connectionReset"],
  [/ssh handshake failed|handshake failed/i, "connectionError.sshHandshakeFailed"],
  [/ssh host fingerprint was not captured|fingerprint.*not captured/i, "connectionError.fingerprintNotCaptured"],
  [/ssh connectivity test failed/i, "connectionError.generic"]
];

export function localizeConnectionErrorMessage(message: string, t: Translator) {
  const normalized = message.trim();
  if (!normalized) {
    return normalized;
  }

  const match = connectionErrorMessagePatterns.find(([pattern]) => pattern.test(normalized));
  if (!match) {
    return normalized;
  }

  const translated = t(match[1]);
  return translated === match[1] ? normalized : translated;
}

export function getConnectionErrorMessage(error: unknown, fallback: string, t: Translator) {
  if (isHttpError(error)) {
    const rawMessage = error.message.trim();
    if (rawMessage) {
      const localized = localizeConnectionErrorMessage(rawMessage, t);
      if (localized !== rawMessage) {
        return localized;
      }
    }

    const message = getApiErrorMessage(error, fallback, t);
    const localized = localizeConnectionErrorMessage(message, t);
    if (localized) {
      return localized;
    }
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return localizeConnectionErrorMessage(error.message, t);
  }

  const message = getApiErrorMessage(error, fallback, t);
  return localizeConnectionErrorMessage(message, t) || fallback;
}
