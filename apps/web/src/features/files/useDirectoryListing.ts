import { useState } from "react";

import type { FileEntry, FileListResponse } from "./types";
import {
  type FileDirectoryState,
  type FileHistoryMode,
  type FileNavigationHistory,
  createIdleFileHostContext,
  nextFileDirectoryErrorState,
  nextFileDirectoryLoadingState,
  nextFileNavigationHistory
} from "./fileHostContext";

type DirectoryLoadOptions = {
  historyMode?: FileHistoryMode;
  preserveOnError?: boolean;
  silentError?: boolean | ((error: unknown) => boolean);
};

type UseDirectoryListingOptions = {
  activeHostId: string;
  initialPath: string;
  loadDirectoryRequest: (hostId: string, path: string) => Promise<FileListResponse>;
  onBeforeLoad: () => void;
  onLoadError: (error: unknown) => string | null | void;
};

export function useDirectoryListing({
  activeHostId,
  initialPath,
  loadDirectoryRequest,
  onBeforeLoad,
  onLoadError
}: UseDirectoryListingOptions) {
  const [currentPath, setCurrentPath] = useState(() => initialPath);
  const [directoryState, setDirectoryState] = useState<FileDirectoryState>("idle");
  const [directory, setDirectory] = useState<FileListResponse | null>(null);
  const [directoryErrorMessage, setDirectoryErrorMessage] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<FileNavigationHistory>({ back: [], forward: [] });

  const loadDirectory = async (
    pathValue = currentPath,
    hostId = activeHostId,
    options?: DirectoryLoadOptions
  ) => {
    const currentContext = {
      ...createIdleFileHostContext({ currentPath }),
      directory,
      directoryErrorMessage,
      directoryState,
      navigationHistory,
      selectedEntry
    };

    if (!hostId) {
      const next = nextFileDirectoryLoadingState(currentContext, hostId);
      setDirectory(next.directory);
      setDirectoryErrorMessage(next.directoryErrorMessage);
      setDirectoryState(next.directoryState);
      setSelectedEntry(next.selectedEntry);
      return { ok: false as const };
    }

    const loadingContext = nextFileDirectoryLoadingState(currentContext, hostId);
    setDirectoryErrorMessage(loadingContext.directoryErrorMessage);
    setDirectoryState(loadingContext.directoryState);
    setSelectedEntry(loadingContext.selectedEntry);
    onBeforeLoad();

    try {
      const result = await loadDirectoryRequest(hostId, pathValue);
      const previousPath = currentPath;
      const resolvedPath = result.path;
      setDirectory(result);
      setCurrentPath(resolvedPath);
      setNavigationHistory((current) =>
        nextFileNavigationHistory(current, previousPath, resolvedPath, options?.historyMode)
      );
      setDirectoryErrorMessage(null);
      setDirectoryState("ready");
      return { ok: true as const };
    } catch (error) {
      const next = nextFileDirectoryErrorState(currentContext, Boolean(options?.preserveOnError));
      const silentError = typeof options?.silentError === "function"
        ? options.silentError(error)
        : Boolean(options?.silentError);
      const errorMessage = silentError ? null : onLoadError(error) || null;
      setDirectory(next.directory);
      setDirectoryErrorMessage(errorMessage);
      setDirectoryState(next.directoryState);
      return { ok: false as const, error };
    }
  };

  const refreshCurrentDirectory = async (hostId = activeHostId) => {
    await loadDirectory(currentPath, hostId, { historyMode: "replace" });
  };

  const goBackDirectory = async (hostId = activeHostId) => {
    const target = navigationHistory.back.at(-1);
    if (target) {
      await loadDirectory(target, hostId, { historyMode: "back", preserveOnError: true });
    }
  };

  const goForwardDirectory = async (hostId = activeHostId) => {
    const target = navigationHistory.forward[0];
    if (target) {
      await loadDirectory(target, hostId, { historyMode: "forward", preserveOnError: true });
    }
  };

  return {
    currentPath,
    directory,
    directoryErrorMessage,
    directoryState,
    goBackDirectory,
    goForwardDirectory,
    loadDirectory,
    navigationHistory,
    refreshCurrentDirectory,
    selectedEntry,
    setCurrentPath,
    setDirectory,
    setDirectoryErrorMessage,
    setDirectoryState,
    setNavigationHistory,
    setSelectedEntry
  };
}
