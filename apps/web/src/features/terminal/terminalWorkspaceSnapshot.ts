import type {
  TerminalWorkspaceSessionSnapshot,
  TerminalWorkspaceSnapshot
} from "../workspace/types";

export type TerminalSnapshotTabStatus =
  | "creating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export type TerminalSnapshotTabLike = {
  cols: number;
  hostId: string;
  hostLabel: string;
  id: string;
  keepAliveUntil?: string | null;
  rows: number;
  runtimeClosed?: boolean;
  sessionId: string;
  startedAt: string;
  status: TerminalSnapshotTabStatus;
};

type RestoredTerminalTabLike = {
  hostId: string;
  id: string;
  sessionId: string;
};

export function terminalSessionSnapshotFromTab(
  tab: TerminalSnapshotTabLike
): TerminalWorkspaceSessionSnapshot | null {
  if (!tab.sessionId || tab.status === "disconnected" || tab.status === "failed" || tab.runtimeClosed === true) {
    return null;
  }

  return {
    session_id: tab.sessionId,
    host_id: tab.hostId,
    host_label: tab.hostLabel,
    rows: tab.rows,
    cols: tab.cols,
    started_at: tab.startedAt,
    keep_alive_until: tab.keepAliveUntil
  };
}

export function buildTerminalWorkspaceSnapshot(
  tabs: TerminalSnapshotTabLike[],
  activeTabId: string | null
): TerminalWorkspaceSnapshot {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const sessions = tabs
    .map((tab) => terminalSessionSnapshotFromTab(tab))
    .filter((session): session is TerminalWorkspaceSessionSnapshot => Boolean(session));

  return {
    open_host_ids: Array.from(new Set(sessions.map((session) => session.host_id))),
    active_host_id: activeTab?.hostId || null,
    sessions,
    active_session_id: activeTab?.sessionId || null
  };
}

export function createTerminalSnapshotSessionMap(
  sessions: TerminalWorkspaceSessionSnapshot[] = []
) {
  return new Map(sessions.map((session) => [session.session_id, session]));
}

export function chooseRestoredTerminalActiveTab<TTab extends RestoredTerminalTabLike>(
  tabs: TTab[],
  snapshot: TerminalWorkspaceSnapshot
) {
  return (
    tabs.find((tab) => tab.sessionId === snapshot.active_session_id) ||
    tabs.find((tab) => tab.hostId === snapshot.active_host_id) ||
    tabs[0] ||
    null
  );
}
