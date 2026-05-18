import type { FileEntry, FileListResponse } from "./types";
import { defaultHomePath } from "./fileViewModel";

export type FileDirectoryState = "idle" | "loading" | "ready" | "error";

export type FileNavigationHistory = {
  back: string[];
  forward: string[];
};

export type FileHostContext = {
  currentPath: string;
  directory: FileListResponse | null;
  directoryErrorMessage: string | null;
  directoryState: FileDirectoryState;
  navigationHistory: FileNavigationHistory;
  searchKeyword: string;
  selectedEntry: FileEntry | null;
};

export type FileHistoryMode = "push" | "replace" | "back" | "forward";

export function createIdleFileHostContext(options?: {
  currentPath?: string;
  searchKeyword?: string;
}): FileHostContext {
  return {
    currentPath: options?.currentPath || "/",
    directory: null,
    directoryErrorMessage: null,
    directoryState: "idle",
    navigationHistory: { back: [], forward: [] },
    searchKeyword: options?.searchKeyword || "",
    selectedEntry: null
  };
}

export function createHomeFileHostContext(host: { username?: string | null } | null): FileHostContext {
  return createIdleFileHostContext({ currentPath: defaultHomePath(host) });
}

export function shouldLoadFileHostContextDirectory(context: FileHostContext) {
  return !context.directory || context.directoryState === "idle" || context.directoryState === "error";
}

export function nextFileDirectoryLoadingState(context: FileHostContext, hostId: string): FileHostContext {
  if (!hostId) {
    return {
      ...context,
      directory: null,
      directoryErrorMessage: null,
      directoryState: "idle",
      selectedEntry: null
    };
  }

  return {
    ...context,
    directoryErrorMessage: null,
    directoryState: "loading",
    selectedEntry: null
  };
}

export function nextFileDirectoryErrorState(
  context: FileHostContext,
  preserveOnError: boolean
): FileHostContext {
  if (!preserveOnError) {
    return {
      ...context,
      directory: null,
      directoryState: "error"
    };
  }

  return {
    ...context,
    directoryState: context.directory ? "ready" : "error"
  };
}

export function nextFileNavigationHistory(
  history: FileNavigationHistory,
  previousPath: string,
  resolvedPath: string,
  historyMode?: FileHistoryMode
): FileNavigationHistory {
  if (historyMode === "back") {
    return {
      back: history.back.slice(0, -1),
      forward: previousPath && previousPath !== resolvedPath ? [previousPath, ...history.forward] : history.forward
    };
  }

  if (historyMode === "forward") {
    return {
      back: previousPath && previousPath !== resolvedPath ? [...history.back, previousPath] : history.back,
      forward: history.forward.slice(1)
    };
  }

  if (historyMode !== "replace" && previousPath && previousPath !== resolvedPath) {
    return {
      back: [...history.back, previousPath],
      forward: []
    };
  }

  return history;
}

export function upsertFileHostContext(
  contexts: Record<string, FileHostContext>,
  hostId: string,
  context: FileHostContext
) {
  return {
    ...contexts,
    [hostId]: context
  };
}

export function removeFileHostContext(contexts: Record<string, FileHostContext>, hostId: string) {
  const next = { ...contexts };
  delete next[hostId];
  return next;
}
