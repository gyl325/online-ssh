export type TerminalTabStatus =
  | "creating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

type TranslationFn = (key: string, values?: Record<string, string | number>) => string;

const terminalStatusLabelKeys: Record<TerminalTabStatus, string> = {
  creating: "terminal.status.creating",
  connecting: "terminal.status.connecting",
  connected: "terminal.status.connected",
  reconnecting: "terminal.status.reconnecting",
  disconnected: "terminal.status.disconnected",
  failed: "terminal.status.failed"
};

export function getTerminalStatusLabelKey(status: TerminalTabStatus) {
  return terminalStatusLabelKeys[status];
}

export function formatTerminalStatusLabel(status: TerminalTabStatus, t: TranslationFn) {
  return t(getTerminalStatusLabelKey(status));
}

export function getTerminalStatusClassName(status: TerminalTabStatus, keepAlive: boolean) {
  return [
    "terminal-status",
    `terminal-status-${status}`,
    keepAlive ? "terminal-status-keepalive" : ""
  ].filter(Boolean).join(" ");
}

export function getTerminalTabStatusIndicator(status: TerminalTabStatus) {
  if (status === "failed") {
    return "reconnect";
  }
  if (status === "connected") {
    return "connected";
  }
  if (status === "disconnected") {
    return "disconnected";
  }
  return "spinner";
}

export function getTerminalPlaceholderMessage(
  status: TerminalTabStatus,
  message: string | null | undefined,
  t: TranslationFn
) {
  return message || formatTerminalStatusLabel(status, t);
}
