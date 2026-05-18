import { isHttpError } from "../../shared/api/http";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function terminalRuntimeErrorMessage(code: string, message: string, t: Translate) {
  const combined = `${code} ${message}`;
  if (/auth|permission denied|authentication/i.test(combined)) {
    return t("terminal.error.authFailed");
  }
  if (/refused|econnrefused/i.test(combined)) {
    return t("terminal.error.connectionRefused");
  }
  if (/timed?\s*out|timeout|etimedout/i.test(combined)) {
    return t("terminal.error.timeout");
  }
  if (/enotfound|getaddrinfo|resolve|unreachable|no route/i.test(combined)) {
    return t("terminal.error.hostUnreachable");
  }
  return t("terminal.error.generic", { message });
}

export function terminalSessionRequestErrorMessage(error: unknown, fallback: string, t: Translate) {
  if (!isHttpError(error)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  if (error.code === "TERMINAL_SESSION_LIMIT_EXCEEDED") {
    return error.message || fallback;
  }

  if (error.code === "TERMINAL_SSH_CONNECT_FAILED" || error.code === "TERMINAL_BOOTSTRAP_CONNECT_FAILED") {
    return terminalRuntimeErrorMessage(error.code, error.message, t);
  }

  if (error.code === "TERMINAL_FAILED" || error.status >= 500) {
    return t("terminal.error.requestFailed");
  }

  return error.message || fallback;
}
