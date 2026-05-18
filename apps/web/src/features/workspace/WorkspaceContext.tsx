import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";

import type {
  FilesWorkspaceSnapshot,
  TerminalWorkspaceSnapshot
} from "./types";

type WorkspaceContextValue = {
  currentRoute: string;
  filesSnapshot: FilesWorkspaceSnapshot;
  terminalSnapshot: TerminalWorkspaceSnapshot;
  setCurrentRoute: (route: string) => void;
  updateFilesSnapshot: (next: Partial<FilesWorkspaceSnapshot>) => void;
  setTerminalSnapshot: (next: TerminalWorkspaceSnapshot) => void;
};

const defaultFilesSnapshot: FilesWorkspaceSnapshot = {
  selected_host_id: "",
  open_host_ids: [],
  active_host_id: null,
  current_path: "/",
  search_keyword: ""
};

const defaultTerminalSnapshot: TerminalWorkspaceSnapshot = {
  open_host_ids: [],
  active_host_id: null,
  sessions: [],
  active_session_id: null
};

const filesSnapshotStorageKey = "online-ssh-files-snapshot";
const terminalSnapshotStorageKey = "online-ssh-terminal-snapshot";

function readStoredSnapshot<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [currentRoute, setCurrentRoute] = useState("/dashboard");
  const [filesSnapshot, setFilesSnapshot] = useState<FilesWorkspaceSnapshot>(() =>
    readStoredSnapshot(filesSnapshotStorageKey, defaultFilesSnapshot)
  );
  const [terminalSnapshot, setTerminalSnapshot] =
    useState<TerminalWorkspaceSnapshot>(() =>
      readStoredSnapshot(terminalSnapshotStorageKey, defaultTerminalSnapshot)
    );

  const updateCurrentRoute = useCallback((route: string) => {
    setCurrentRoute((current) => (current === route ? current : route));
  }, []);

  const updateFilesSnapshot = useCallback((next: Partial<FilesWorkspaceSnapshot>) => {
    setFilesSnapshot((current) => {
      const merged = { ...current, ...next };
      const currentOpenHostIds = current.open_host_ids || [];
      const mergedOpenHostIds = merged.open_host_ids || [];
      const sameOpenHosts =
        currentOpenHostIds.length === mergedOpenHostIds.length &&
        currentOpenHostIds.every((hostId, index) => hostId === mergedOpenHostIds[index]);
      if (
        current.selected_host_id === merged.selected_host_id &&
        current.active_host_id === merged.active_host_id &&
        sameOpenHosts &&
        current.current_path === merged.current_path &&
        current.search_keyword === merged.search_keyword
      ) {
        return current;
      }
      return merged;
    });
  }, []);

  const updateTerminalSnapshot = useCallback((next: TerminalWorkspaceSnapshot) => {
    setTerminalSnapshot((current) => {
      const sameHosts =
        current.open_host_ids.length === next.open_host_ids.length &&
        current.open_host_ids.every((hostId, index) => hostId === next.open_host_ids[index]);
      const currentSessions = current.sessions || [];
      const nextSessions = next.sessions || [];
      const sameSessions =
        currentSessions.length === nextSessions.length &&
        currentSessions.every((session, index) => {
          const nextSession = nextSessions[index];
          return (
            session.session_id === nextSession.session_id &&
            session.host_id === nextSession.host_id &&
            session.host_label === nextSession.host_label &&
            session.rows === nextSession.rows &&
            session.cols === nextSession.cols &&
            session.started_at === nextSession.started_at &&
            session.keep_alive_until === nextSession.keep_alive_until
          );
        });
      if (
        sameHosts &&
        sameSessions &&
        current.active_host_id === next.active_host_id &&
        current.active_session_id === next.active_session_id
      ) {
        return current;
      }
      return {
        ...next,
        sessions: nextSessions
      };
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(filesSnapshotStorageKey, JSON.stringify(filesSnapshot));
  }, [filesSnapshot]);

  useEffect(() => {
    window.localStorage.setItem(terminalSnapshotStorageKey, JSON.stringify(terminalSnapshot));
  }, [terminalSnapshot]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      currentRoute,
      filesSnapshot,
      terminalSnapshot,
      setCurrentRoute: updateCurrentRoute,
      updateFilesSnapshot,
      setTerminalSnapshot: updateTerminalSnapshot
    }),
    [
      currentRoute,
      filesSnapshot,
      terminalSnapshot,
      updateCurrentRoute,
      updateFilesSnapshot,
      updateTerminalSnapshot
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceSnapshot() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("WorkspaceContext missing");
  }
  return context;
}
