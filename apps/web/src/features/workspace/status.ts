import type { FilesWorkspaceSnapshot, TerminalWorkspaceSnapshot } from "./types";

export type HostLabelLookup = Map<string, string> | Record<string, string>;

export type TerminalWorkspaceStatus = {
  activeHostId: string;
  activeHostLabel: string;
  hostCount: number;
  sessionCount: number;
};

export type FilesWorkspaceStatus = {
  hasSelection: boolean;
  hostId: string;
  hostLabel: string;
  hostCount: number;
  path: string;
};

function resolveHostLabel(hostId: string, lookup?: HostLabelLookup, fallback?: string) {
  if (!hostId) {
    return fallback || "";
  }

  const value = lookup instanceof Map ? lookup.get(hostId) : lookup?.[hostId];
  return value || fallback || hostId;
}

export function getTerminalWorkspaceStatus(
  snapshot: TerminalWorkspaceSnapshot,
  hostLabels?: HostLabelLookup
): TerminalWorkspaceStatus {
  const sessions = snapshot.sessions || [];
  const openHostIds = snapshot.open_host_ids || [];
  const activeSession = sessions.find((session) => session.session_id === snapshot.active_session_id) || sessions[0] || null;
  const activeHostId = activeSession?.host_id || snapshot.active_host_id || openHostIds[0] || "";
  const hostIds = new Set([
    ...openHostIds,
    ...sessions.map((session) => session.host_id)
  ].filter(Boolean));

  return {
    activeHostId,
    activeHostLabel: resolveHostLabel(activeHostId, hostLabels, activeSession?.host_label),
    hostCount: hostIds.size,
    sessionCount: sessions.length || openHostIds.length
  };
}

export function getFilesWorkspaceStatus(
  snapshot: FilesWorkspaceSnapshot,
  hostLabels?: HostLabelLookup
): FilesWorkspaceStatus {
  const openHostIds = snapshot.open_host_ids || [];
  const hostId = snapshot.active_host_id || snapshot.selected_host_id || openHostIds[0] || "";
  const hostIds = new Set([
    ...openHostIds,
    snapshot.selected_host_id,
    snapshot.active_host_id || ""
  ].filter(Boolean));

  return {
    hasSelection: Boolean(hostId),
    hostId,
    hostLabel: resolveHostLabel(hostId, hostLabels),
    hostCount: hostIds.size,
    path: snapshot.current_path || "/"
  };
}
