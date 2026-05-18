import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  FilePlus,
  FolderPlus
} from "lucide-react";

import { getApiErrorMessage } from "../features/auth/api";
import { useFingerprintDialog } from "../features/fingerprint/FingerprintDialogContext";
import { useConfirmDialog } from "../features/ui/ConfirmDialogContext";
import {
  calculateFileChecksum,
  cancelFileSearchTask,
  chmodFile,
  compressArchive,
  copyFile,
  createDirectory,
  createDownloadTask,
  createFile,
  createFileSearchTask,
  deleteFile,
  extractArchive,
  getFileSearchTask,
  listFileSearchTaskResults,
  listDirectory,
  readFileContent,
  renameFile,
  writeFileContent
} from "../features/files/api";
import type { FileEntry, FileOperationResponse, FileSearchResult, FilesCallResult } from "../features/files/types";
import {
  FileActionDialogs,
  type ActionDialogState,
  type CompressDialogState
} from "../features/files/FileActionDialogs";
import {
  FileBrowserToolbar,
  type FileBrowserViewMode
} from "../features/files/FileBrowserToolbar";
import {
  FileBlankActionMenu,
  FileEntryActionMenu
} from "../features/files/FileEntryActionMenu";
import { FileEntryTypeIcon } from "../features/files/FileEntryTypeIcon";
import {
  FilePreviewDialog,
  type FilePreviewDialogState
} from "../features/files/FilePreviewDialog";
import { FileRemoteSearchDialog } from "../features/files/FileRemoteSearchDialog";
import {
  FileHostSidebar,
  type FileHostSidebarContextMap
} from "../features/files/FileHostSidebar";
import {
  FileTransferStatusPanel,
  type FileTransferProgressState,
  type UploadQueueItem
} from "../features/files/FileTransferStatusPanel";
import {
  handleFilesShortcutKeyDown,
  type FilesShortcutRuntime
} from "../features/files/fileShortcuts";
import {
  type FileHostContext,
  createIdleFileHostContext,
  removeFileHostContext,
  shouldLoadFileHostContextDirectory,
  upsertFileHostContext
} from "../features/files/fileHostContext";
import { useDirectoryListing } from "../features/files/useDirectoryListing";
import { useRemoteSearch } from "../features/files/useRemoteSearch";
import {
  type CompressArchiveFormat,
  archiveFormatExtension,
  archiveOutputPath,
  canExtractArchive,
  canMoveEntryToDirectory,
  canPreview,
  defaultArchiveName,
  defaultHomePath,
  duplicateFileName,
  entryKindLabel,
  formatBytes,
  isTooLargeForPreview,
  joinPath,
  maxEditableFileBytes,
  parentPathOf,
  previewKindForEntry,
  sortFileEntries,
  terminalDirectoryForEntry
} from "../features/files/fileViewModel";
import { listHosts } from "../features/hosts/api";
import type { Host } from "../features/hosts/types";
import { defaultRemotePathCandidates } from "../features/preferences/defaultRemotePath";
import {
  downloadTransferTaskContent,
  initUploadTask,
  resumeTransferTask,
  uploadTransferChunk
} from "../features/transfers/api";
import { waitForTransferTask } from "../features/transfers/client";
import { hostMatchesSearch } from "../features/hosts/display";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useToast } from "../features/ui/ToastContext";
import { useWorkspaceSnapshot } from "../features/workspace/WorkspaceContext";
import { isHttpError } from "../shared/api/http";
import { copyTextToClipboard } from "../shared/lib/clipboard";
import { formatDateTime } from "../shared/lib/date";
import { saveBlobAsFile } from "../shared/lib/download";
import { DataTable, DetailDialog, Dialog, EmptyState, IconButton, LoadingState } from "../shared/ui";

const temporaryFileHostStorageKey = "online-ssh-temporary-file-host";

type EditorDialogState = FilePreviewDialogState;

type FilesContextMenuState =
  | { kind: "entry"; path: string; top: number; left: number }
  | { kind: "blank"; top: number; left: number };

type FileClipboardState = {
  action: "copy" | "cut";
  entry: FileEntry;
  hostId: string;
};

type FileViewMode = FileBrowserViewMode;

type FilesPageShortcutRuntime = FilesShortcutRuntime & {
  clearScheduledFileSelect: () => void;
};

type FileDragState = {
  sourcePath: string;
  targetPath: string | null;
};

type FilesPageProps = {
  hostCatalog?: {
    hosts: Host[];
  };
  visible?: boolean;
};

function filePreviewErrorMessage(error: unknown, t: (key: string) => string) {
  const message = getApiErrorMessage(error, t("files.previewFailed"), t);
  if (/invalid file request/i.test(message)) {
    return t("files.previewUnsupported");
  }
  return message;
}

function readTemporaryFileHost(hostId: string): Host | null {
  if (!hostId) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(temporaryFileHostStorageKey);
    if (!raw) {
      return null;
    }
    const host = JSON.parse(raw) as Host;
    return host?.id === hostId ? host : null;
  } catch {
    return null;
  }
}

function shouldFallbackDefaultPath(error: unknown) {
  return isHttpError(error) && (error.status === 404 || error.code === "NOT_FOUND");
}

export function FilesPage({ hostCatalog, visible = true }: FilesPageProps = {}) {
  const confirmDialog = useConfirmDialog();
  const fingerprintDialog = useFingerprintDialog();
  const workspace = useWorkspaceSnapshot();
  const toast = useToast();
  const { filesDefaultPathPreference, language, t } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryHostId = location.pathname === "/files" ? searchParams.get("host_id") || "" : "";
  const initialSelectedHostId = queryHostId || workspace.filesSnapshot.active_host_id || workspace.filesSnapshot.selected_host_id || "";
  const initialConnectedHostIds = Array.from(new Set([
    initialSelectedHostId,
    ...(workspace.filesSnapshot.open_host_ids || [])
  ].filter(Boolean)));
  const initialPath = workspace.filesSnapshot.current_path || "/";
  const initialSearchKeyword = workspace.filesSnapshot.search_keyword || "";
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBatchRef = useRef(0);
  const fileSelectTimerRef = useRef<number | null>(null);
  const shortcutRuntimeRef = useRef<FilesPageShortcutRuntime | null>(null);
  const appliedStoredSnapshotRef = useRef(false);
  const resetRemoteSearchMessagesRef = useRef<() => void>(() => {});
  const [localHosts, setLocalHosts] = useState<Host[]>([]);
  const [temporaryHosts, setTemporaryHosts] = useState<Host[]>(() => {
    const host = queryHostId ? readTemporaryFileHost(queryHostId) : null;
    return host ? [host] : [];
  });
  const [selectedHostId, setSelectedHostId] = useState(() => initialSelectedHostId);
  const [connectedHostIds, setConnectedHostIds] = useState<string[]>(() => initialConnectedHostIds);
  const [fileHostContexts, setFileHostContexts] = useState<Record<string, FileHostContext>>(() =>
    initialSelectedHostId
      ? { [initialSelectedHostId]: createIdleFileHostContext({ currentPath: initialPath, searchKeyword: initialSearchKeyword }) }
      : {}
  );
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [hostPickerFilter, setHostPickerFilter] = useState("");
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>("list");
  const [fileSorting, setFileSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [showHiddenFiles, setShowHiddenFiles] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState(() => initialSearchKeyword);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState("/");
  const [rowMenu, setRowMenu] = useState<FilesContextMenuState | null>(null);
  const [fileClipboard, setFileClipboard] = useState<FileClipboardState | null>(null);
  const [fileDragState, setFileDragState] = useState<FileDragState | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [compressDialog, setCompressDialog] = useState<CompressDialogState | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [compressSubmitting, setCompressSubmitting] = useState(false);
  const [infoEntry, setInfoEntry] = useState<FileEntry | null>(null);
  const [editorDialog, setEditorDialog] = useState<EditorDialogState | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<FileTransferProgressState | null>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isUploadDropActive, setIsUploadDropActive] = useState(false);

  const hosts = useMemo(() => {
    const sourceHosts = hostCatalog?.hosts ?? localHosts;
    const missingTemporaryHosts = temporaryHosts.filter((temporaryHost) =>
      !sourceHosts.some((host) => host.id === temporaryHost.id)
    );
    return missingTemporaryHosts.length > 0 ? [...missingTemporaryHosts, ...sourceHosts] : sourceHosts;
  }, [hostCatalog?.hosts, localHosts, temporaryHosts]);
  const deferredSearchKeyword = useDeferredValue(searchKeyword.trim().toLowerCase());

  const connectedHosts = useMemo(
    () =>
      connectedHostIds
        .map((hostId) => hosts.find((host) => host.id === hostId))
        .filter((host): host is Host => Boolean(host)),
    [connectedHostIds, hosts]
  );
  const availableHosts = useMemo(
    () => hosts.filter((host) => !connectedHostIds.includes(host.id)),
    [connectedHostIds, hosts]
  );
  const filteredAvailableHosts = useMemo(
    () => availableHosts.filter((host) => hostMatchesSearch(host, hostPickerFilter)),
    [availableHosts, hostPickerFilter]
  );

  const runWithFingerprint = async <T,>(
    hostId: string,
    runner: () => Promise<FilesCallResult<T>>,
    actionLabel: string
  ): Promise<T> => {
    const host = hosts.find((item) => item.id === hostId);
    if (!host) {
      throw new Error(t("files.selectHostFirst"));
    }

    const first = await runner();
    if (first.kind === "success") {
      return first.data;
    }

    const confirmed = await fingerprintDialog.requestConfirmation({
      hostId: host.id,
      hostLabel: host.name,
      actionLabel,
      conflict: first.data
    });

    if (!confirmed) {
      throw new Error(t("files.fingerprintCancelled", { action: actionLabel }));
    }

    const retry = await runner();
    if (retry.kind === "success") {
      return retry.data;
    }

    throw new Error(t("files.fingerprintRetryConflict", { action: actionLabel }));
  };

  const resetMessages = () => {
    resetRemoteSearchMessagesRef.current();
  };

  const {
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
  } = useDirectoryListing({
    activeHostId: selectedHostId,
    initialPath,
    loadDirectoryRequest: (hostId, pathValue) =>
      runWithFingerprint(
        hostId,
        () =>
          listDirectory({
            host_id: hostId,
            path: pathValue,
            limit: 200
          }),
        t("files.action.browse")
      ),
    onBeforeLoad: () => {
      setRowMenu(null);
      resetMessages();
    },
    onLoadError: (error) => {
      const message = getApiErrorMessage(error, t("files.directoryLoadFailed"), t);
      toast.error(message);
      return message;
    }
  });

  const remoteSearch = useRemoteSearch({
    activeHostId: selectedHostId,
    currentPath,
    createTaskRequest: (input) =>
      runWithFingerprint(
        input.host_id,
        () => createFileSearchTask(input),
        t("files.remoteSearchAction")
      ),
    getTaskRequest: (taskId) =>
      runWithFingerprint(
        selectedHostId,
        () => getFileSearchTask(taskId),
        t("files.remoteSearchAction")
      ),
    listResultsRequest: (input) =>
      runWithFingerprint(
        selectedHostId,
        () => listFileSearchTaskResults(input),
        t("files.remoteSearchAction")
      ),
    cancelTaskRequest: (taskId) =>
      runWithFingerprint(
        selectedHostId,
        () => cancelFileSearchTask(taskId),
        t("files.remoteSearchCancel")
      ),
    onSelectHostRequired: () => toast.warning(t("files.selectHostFirst")),
    onKeywordRequired: () => toast.warning(t("files.remoteSearchKeywordRequired")),
    onSearchStarted: () => toast.success(t("files.remoteSearchStarted")),
    onTaskError: (message) => toast.error(message),
    onRefreshError: (error) => toast.error(getApiErrorMessage(error, t("files.remoteSearchRefreshFailed"), t)),
    onSearchError: (error) => toast.error(getApiErrorMessage(error, t("files.remoteSearchFailed"), t)),
    onCancelSuccess: () => toast.success(t("files.remoteSearchCanceled")),
    onCancelError: (error) => toast.error(getApiErrorMessage(error, t("files.remoteSearchCancelFailed"), t)),
    pollingEnabled: visible
  });
  resetRemoteSearchMessagesRef.current = remoteSearch.resetMessages;
  const remoteSearchScopePath = remoteSearch.task?.base_path || currentPath;

  const createDefaultFileHostContext = (host: Host) => {
    const candidates = defaultRemotePathCandidates(filesDefaultPathPreference, defaultHomePath(host));
    return createIdleFileHostContext({ currentPath: candidates[0] || "/" });
  };

  const loadDefaultDirectory = async (host: Host, hostId = host.id) => {
    const candidates = defaultRemotePathCandidates(filesDefaultPathPreference, defaultHomePath(host));
    for (const [index, candidate] of candidates.entries()) {
      const result = await loadDirectory(candidate, hostId, {
        historyMode: "replace",
        silentError: (error) => index < candidates.length - 1 && shouldFallbackDefaultPath(error)
      });
      if (result.ok) {
        return true;
      }
      if (!shouldFallbackDefaultPath(result.error)) {
        return false;
      }
    }
    return false;
  };

  const visibleItems = useMemo(() => {
    const items = (directory?.items || []).filter((item) => showHiddenFiles || !item.is_hidden);
    if (!deferredSearchKeyword) {
      return items;
    }

    return items.filter((item) => {
      const name = item.name.toLowerCase();
      const path = item.path.toLowerCase();
      return name.includes(deferredSearchKeyword) || path.includes(deferredSearchKeyword);
    });
  }, [deferredSearchKeyword, directory, showHiddenFiles]);

  const sortedVisibleItems = useMemo(
    () => sortFileEntries(visibleItems, fileSorting),
    [fileSorting, visibleItems]
  );

  const activeMenuItem = useMemo(
    () => (rowMenu?.kind === "entry" ? visibleItems.find((item) => item.path === rowMenu.path) || null : null),
    [rowMenu, visibleItems]
  );
  const selectedShortcutEntry = useMemo(
    () => (selectedEntry ? visibleItems.find((item) => item.path === selectedEntry.path) || null : null),
    [selectedEntry, visibleItems]
  );
  const draggedEntry = useMemo(
    () => (fileDragState ? visibleItems.find((item) => item.path === fileDragState.sourcePath) || null : null),
    [fileDragState, visibleItems]
  );

  const resetTransientFileState = () => {
    setDirectory(null);
    setDirectoryErrorMessage(null);
    setDirectoryState("idle");
    setSelectedEntry(null);
    remoteSearch.resetTaskState();
    setRowMenu(null);
    setFileDragState(null);
    setNavigationHistory({ back: [], forward: [] });
  };

  const currentFileHostContext = (hostId = selectedHostId): FileHostContext | null => {
    if (!hostId) {
      return null;
    }
    return {
      currentPath,
      directory,
      directoryErrorMessage,
      directoryState,
      navigationHistory,
      searchKeyword,
      selectedEntry
    };
  };

  const saveCurrentFileHostContext = () => {
    const context = currentFileHostContext();
    if (!context || !selectedHostId) {
      return;
    }
    setFileHostContexts((current) => upsertFileHostContext(current, selectedHostId, context));
  };

  const clearRemoteSearchContext = () => {
    remoteSearch.clearContext();
  };

  const restoreFileHostContext = (context: FileHostContext) => {
    setCurrentPath(context.currentPath);
    setDirectory(context.directory);
    setDirectoryErrorMessage(context.directoryErrorMessage ?? null);
    setDirectoryState(context.directoryState);
    setNavigationHistory(context.navigationHistory);
    setSearchKeyword(context.searchKeyword);
    setSelectedEntry(context.selectedEntry);
    setPathEditing(false);
    setRowMenu(null);
    setFileDragState(null);
    clearRemoteSearchContext();
  };

  const activateFileHost = (hostId: string) => {
    const host = hosts.find((item) => item.id === hostId);
    if (!host) {
      toast.warning(t("files.selectHostFirst"));
      return;
    }
    if (hostId === selectedHostId) {
      setHostPickerOpen(false);
      return;
    }

    saveCurrentFileHostContext();
    setHostPickerOpen(false);
    setConnectedHostIds((current) => (current.includes(hostId) ? current : [...current, hostId]));
    setSelectedHostId(hostId);

    const hasSavedContext = Boolean(fileHostContexts[hostId]);
    const context = fileHostContexts[hostId] || createDefaultFileHostContext(host);
    restoreFileHostContext(context);

    if (shouldLoadFileHostContextDirectory(context)) {
      void (hasSavedContext
        ? loadDirectory(context.currentPath, hostId, { historyMode: "replace" })
        : loadDefaultDirectory(host, hostId));
    }
  };

  useEffect(() => {
    if (!queryHostId || hosts.length === 0) {
      return;
    }
    if (!hosts.some((host) => host.id === queryHostId)) {
      return;
    }
    activateFileHost(queryHostId);
    setSearchParams({}, { replace: true });
    // `activateFileHost` intentionally uses the latest page state while this effect
    // is triggered only by an external host_id navigation request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, queryHostId, setSearchParams]);

  const clearActiveFileHost = () => {
    setSelectedHostId("");
    setSearchKeyword("");
    setCurrentPath("/");
    clearRemoteSearchContext();
    resetTransientFileState();
  };

  const disconnectFileHost = async (hostId: string) => {
    const host = hosts.find((item) => item.id === hostId);
    if (!host) {
      return;
    }

    const confirmed = await confirmDialog.requestConfirmation({
      title: t("files.disconnectHostTitle"),
      message: t("files.disconnectHostMessage", { name: host.name }),
      confirmLabel: t("files.disconnectHostConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    const remainingHostIds = connectedHostIds.filter((id) => id !== hostId);
    setHostPickerOpen(false);
    setConnectedHostIds(remainingHostIds);
    setFileHostContexts((current) => removeFileHostContext(current, hostId));
    toast.success(t("files.disconnectHostSuccess", { name: host.name }));

    if (hostId !== selectedHostId) {
      return;
    }

    const nextHostId = remainingHostIds[0] || "";
    const nextHost = hosts.find((item) => item.id === nextHostId) || null;
    if (!nextHost) {
      clearActiveFileHost();
      return;
    }

    setSelectedHostId(nextHostId);
    const hasSavedContext = Boolean(fileHostContexts[nextHostId]);
    const context = fileHostContexts[nextHostId] || createDefaultFileHostContext(nextHost);
    restoreFileHostContext(context);

    if (shouldLoadFileHostContextDirectory(context)) {
      void (hasSavedContext
        ? loadDirectory(context.currentPath, nextHostId, { historyMode: "replace" })
        : loadDefaultDirectory(nextHost, nextHostId));
    }
  };

  const openRemoteSearchResult = async (entry: FileSearchResult) => {
    if (entry.entry_type === "directory") {
      await loadDirectory(entry.path);
      remoteSearch.setOpen(false);
      return;
    }
    await loadDirectory(parentPathOf(entry.path), selectedHostId, { preserveOnError: true });
    remoteSearch.setOpen(false);
  };

  const beginPathEdit = () => {
    if (!selectedHostId) {
      return;
    }
    setPathDraft(currentPath);
    setPathEditing(true);
  };

  const submitPathEdit = async () => {
    const nextPath = pathDraft.trim() || "/";
    setPathEditing(false);
    await loadDirectory(nextPath.startsWith("/") ? nextPath : `/${nextPath}`, selectedHostId, {
      preserveOnError: true
    });
  };

  const performOperation = async (
    runner: () => Promise<FilesCallResult<FileOperationResponse>>,
    actionLabel: string,
    successMessage: string,
    failureMessage?: string
  ) => {
    if (!selectedHostId) {
      toast.warning(t("files.selectHostFirst"));
      return false;
    }

    resetMessages();

    try {
      await runWithFingerprint(selectedHostId, runner, actionLabel);
      toast.success(successMessage);
      await refreshCurrentDirectory();
      return true;
    } catch (error) {
      toast.error(failureMessage || getApiErrorMessage(error, t("files.operationFailed", { action: actionLabel }), t));
      return false;
    }
  };

  const fetchRemoteFileBlob = async (entry: FileEntry) => {
    if (!selectedHostId || entry.entry_type !== "file") {
      throw new Error(t("files.selectHostFirst"));
    }

    setActiveTransfer({
      kind: "download",
      fileName: entry.name,
      status: "preparing",
      transferredBytes: 0,
      totalBytes: entry.size_bytes,
      note: t("files.downloadPreparing")
    });

    try {
      const result = await runWithFingerprint(
        selectedHostId,
        () =>
          createDownloadTask({
            host_id: selectedHostId,
            source_path: entry.path
          }),
        t("files.action.download")
      );

      setActiveTransfer({
        kind: "download",
        fileName: result.task.file_name,
        status: result.task.status,
        transferredBytes: result.task.transferred_bytes,
        totalBytes: result.task.total_bytes || entry.size_bytes,
        note: t("files.downloadRunning")
      });

      const completedTask = await waitForTransferTask(result.task.id, {
        timeoutMessage: t("files.transferTimeout"),
        isDone: (task) => task.status === "completed",
        onProgress: (task) => {
          setActiveTransfer({
            kind: "download",
            fileName: task.file_name,
            status: task.status,
            transferredBytes: task.transferred_bytes,
            totalBytes: task.total_bytes,
            note: t("files.downloadRunning")
          });
        }
      });

      if (completedTask.status !== "completed") {
        throw new Error(completedTask.error_message || t("files.downloadNotCompleted"));
      }

      const blob = await downloadTransferTaskContent(completedTask.id);
      return { blob, fileName: completedTask.file_name };
    } finally {
      setActiveTransfer(null);
    }
  };

  const openEntry = async (entry: FileEntry) => {
    setSelectedEntry(entry);
    if (entry.entry_type === "directory") {
      await loadDirectory(entry.path);
      return;
    }

    if (!selectedHostId) {
      toast.warning(t("files.selectHostFirst"));
      return;
    }

    const previewKind = previewKindForEntry(entry);

    if (!previewKind) {
      const message = t("files.previewUnsupported");
      setEditorDialog({
        entry,
        previewKind: "text",
        status: "error",
        content: null,
        draft: "",
        editing: false,
        objectUrl: null,
        saving: false,
        errorMessage: message
      });
      resetMessages();
      toast.info(message);
      return;
    }

    if (previewKind === "text" && isTooLargeForPreview(entry)) {
      setEditorDialog({
        entry,
        previewKind,
        status: "error",
        content: null,
        draft: "",
        editing: false,
        objectUrl: null,
        saving: false,
        errorMessage: t("files.previewTooLarge", {
          size: formatBytes(entry.size_bytes),
          limit: formatBytes(maxEditableFileBytes)
        })
      });
      resetMessages();
      return;
    }

    setEditorDialog({
      entry,
      previewKind,
      status: "loading",
      content: null,
      draft: "",
      editing: false,
      objectUrl: null,
      saving: false,
      errorMessage: null
    });
    resetMessages();

    try {
      if (previewKind === "text") {
        const content = await runWithFingerprint(
          selectedHostId,
          () =>
            readFileContent({
              host_id: selectedHostId,
              path: entry.path
            }),
          t("files.action.read")
        );
        setEditorDialog({
          entry,
          previewKind,
          status: "ready",
          content,
          draft: content.content,
          editing: false,
          objectUrl: null,
          saving: false,
          errorMessage: null
        });
        return;
      }

      const { blob } = await fetchRemoteFileBlob(entry);
      const objectUrl = URL.createObjectURL(blob);
      setEditorDialog({
        entry,
        previewKind,
        status: "ready",
        content: null,
        draft: "",
        editing: false,
        objectUrl,
        saving: false,
        errorMessage: null
      });
    } catch (error) {
      const message = filePreviewErrorMessage(error, t);
      setEditorDialog({
        entry,
        previewKind,
        status: "error",
        content: null,
        draft: "",
        editing: false,
        objectUrl: null,
        saving: false,
        errorMessage: message
      });
      toast.error(message);
    }
  };

  const handleSaveContent = async () => {
    if (!editorDialog || editorDialog.status !== "ready" || !selectedHostId) {
      return;
    }

    if (!editorDialog.editing) {
      return;
    }

    const currentContent = editorDialog.content;
    if (!currentContent) {
      return;
    }

    if (editorDialog.draft === currentContent.content) {
      return;
    }

    const confirmed = await confirmDialog.requestConfirmation({
      title: t("files.saveContentConfirmTitle"),
      message: t("files.saveContentConfirmMessage", {
        path: editorDialog.entry.path,
        size: formatBytes(new TextEncoder().encode(editorDialog.draft).length)
      }),
      confirmLabel: t("files.saveContentConfirm")
    });
    if (!confirmed) {
      return;
    }

    setEditorDialog((current) =>
      current ? { ...current, saving: true, errorMessage: null } : current
    );
    resetMessages();

    try {
      const saved = await runWithFingerprint(
        selectedHostId,
        () =>
          writeFileContent({
            host_id: selectedHostId,
            path: editorDialog.entry.path,
            content: editorDialog.draft
          }),
        t("files.action.save")
      );
      setEditorDialog({
        entry: editorDialog.entry,
        previewKind: "text",
        status: "ready",
        content: saved,
        draft: saved.content,
        editing: false,
        objectUrl: null,
        saving: false,
        errorMessage: null
      });
      toast.success(t("files.contentSaved"));
      await refreshCurrentDirectory();
    } catch (error) {
      const message = getApiErrorMessage(error, t("files.saveContentFailed"), t);
      setEditorDialog((current) =>
        current
          ? {
            ...current,
            saving: false,
            errorMessage: null
          }
          : current
      );
      toast.error(message);
    }
  };

  const handleDownload = async (entry: FileEntry) => {
    if (!selectedHostId || entry.entry_type !== "file") {
      return;
    }

    resetMessages();
    try {
      const { blob, fileName } = await fetchRemoteFileBlob(entry);
      saveBlobAsFile(blob, fileName);
      toast.success(t("files.downloadCompleted", { name: fileName }));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("files.downloadFailed"), t));
    }
  };

  const handleCompressArchive = async (entry: FileEntry) => {
    if (entry.entry_type !== "directory") {
      return;
    }
    const format: CompressArchiveFormat = "tar.gz";
    setCompressDialog({
      entry,
      format,
      name: defaultArchiveName(entry, format)
    });
  };

  const handleCompressFormatChange = (format: CompressArchiveFormat) => {
    setCompressDialog((current) => {
      if (!current) {
        return current;
      }
      const previousDefaultName = defaultArchiveName(current.entry, current.format);
      const shouldReplaceName = current.name.trim() === "" || current.name === previousDefaultName;
      return {
        ...current,
        format,
        name: shouldReplaceName ? defaultArchiveName(current.entry, format) : current.name
      };
    });
  };

  const submitCompressArchive = async () => {
    if (!compressDialog || !selectedHostId || compressSubmitting) {
      return;
    }
    const archiveName = compressDialog.name.trim();
    if (!archiveName) {
      toast.warning(t("files.archiveNameRequired"));
      return;
    }
    if (archiveName.includes("/")) {
      toast.warning(t("files.archiveNameInvalid"));
      return;
    }
    const expectedExtension = archiveFormatExtension(compressDialog.format);
    if (!archiveName.toLowerCase().endsWith(expectedExtension)) {
      toast.warning(t("files.archiveNameExtensionRequired", { extension: expectedExtension }));
      return;
    }

    setCompressSubmitting(true);
    try {
      const succeeded = await performOperation(
        () =>
          compressArchive({
            host_id: selectedHostId,
            path: compressDialog.entry.path,
            output_path: archiveOutputPath(compressDialog.entry, archiveName)
          }),
        t("files.action.compress"),
        t("files.archiveCompressed", { name: archiveName })
      );
      if (succeeded) {
        setCompressDialog(null);
      }
    } finally {
      setCompressSubmitting(false);
    }
  };

  const handleExtractArchive = async (entry: FileEntry) => {
    if (!canExtractArchive(entry)) {
      return;
    }
    await performOperation(
      () =>
        extractArchive({
          host_id: selectedHostId,
          path: entry.path
        }),
      t("files.action.extract"),
      t("files.archiveExtracted", { name: entry.name })
    );
  };

  const rememberFileClipboard = (entry: FileEntry, action: "copy" | "cut") => {
    if (!selectedHostId) {
      toast.warning(t("files.selectHostFirst"));
      return;
    }
    setSelectedEntry(entry);
    setFileClipboard({ action, entry, hostId: selectedHostId });
    toast.success(
      action === "copy"
        ? t("files.copiedToClipboard", { name: entry.name })
        : t("files.cutToClipboard", { name: entry.name })
    );
  };

  const copyEntryPath = async (entry: FileEntry) => {
    setSelectedEntry(entry);
    try {
      const copied = await copyTextToClipboard(entry.path);
      if (!copied) {
        throw new Error("clipboard unavailable");
      }
      toast.success(t("files.pathCopied"));
    } catch {
      toast.error(t("files.pathCopyFailed"));
    }
  };

  const openTerminalAtPath = (path: string) => {
    if (!selectedHostId) {
      toast.warning(t("files.selectHostFirst"));
      return;
    }
    const params = new URLSearchParams({
      host_id: selectedHostId,
      cwd: path
    });
    void navigate(`/terminal?${params.toString()}`);
  };

  const openTerminalAtEntry = (entry: FileEntry) => {
    openTerminalAtPath(terminalDirectoryForEntry(entry));
  };

  const pasteFileClipboard = async () => {
    if (!fileClipboard) {
      toast.warning(t("files.clipboardEmpty"));
      return;
    }
    if (!selectedHostId || fileClipboard.hostId !== selectedHostId) {
      toast.warning(t("files.clipboardHostMismatch"));
      return;
    }

    let targetName = fileClipboard.entry.name;
    let targetPath = joinPath(currentPath, targetName);
    if (fileClipboard.action === "copy" && targetPath === fileClipboard.entry.path) {
      targetName = duplicateFileName(fileClipboard.entry.name);
      targetPath = joinPath(currentPath, targetName);
    }
    if (targetPath === fileClipboard.entry.path) {
      toast.warning(t("files.pasteSamePath"));
      return;
    }

    const succeeded =
      fileClipboard.action === "copy"
        ? await performOperation(
          () =>
            copyFile({
              host_id: selectedHostId,
              source_path: fileClipboard.entry.path,
              target_path: targetPath
          }),
          t("files.action.copy"),
          t("files.copiedPath", { name: targetName }),
          t("files.copyFailed")
        )
        : await performOperation(
          () =>
            renameFile({
              host_id: selectedHostId,
              old_path: fileClipboard.entry.path,
              new_path: targetPath
            }),
          t("files.action.move"),
          t("files.movedPath")
        );

    if (succeeded && fileClipboard.action === "cut") {
      setFileClipboard(null);
      if (selectedEntry?.path === fileClipboard.entry.path) {
        setSelectedEntry(null);
      }
    }
  };

  const calculateChecksum = async (entry: FileEntry, algorithm: "md5" | "sha256") => {
    if (!selectedHostId || entry.entry_type !== "file") {
      return;
    }
    setSelectedEntry(entry);
    try {
      const result = await runWithFingerprint(
        selectedHostId,
        () =>
          calculateFileChecksum({
            host_id: selectedHostId,
            path: entry.path,
            algorithm
          }),
        t("files.action.checksum")
      );
      const label = algorithm.toUpperCase();
      try {
        const copied = await copyTextToClipboard(result.checksum);
        toast.success(
          copied
            ? t("files.checksumCalculatedCopied", { algorithm: label, checksum: result.checksum })
            : t("files.checksumCalculated", { algorithm: label, checksum: result.checksum })
        );
      } catch {
        toast.success(t("files.checksumCalculated", { algorithm: label, checksum: result.checksum }));
      }
    } catch {
      toast.error(t("files.checksumFailed"));
    }
  };

  const handleUploadEntry = () => {
    if (!selectedHostId) {
      toast.warning(t("files.selectHostBeforeUpload"));
      return;
    }

    uploadInputRef.current?.click();
  };

  const updateUploadQueueItem = (id: string, patch: Partial<UploadQueueItem>) => {
    setUploadQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const uploadSingleFile = async (file: File, queueItemId: string) => {
    updateUploadQueueItem(queueItemId, {
      status: "uploading",
      transferredBytes: 0,
      message: t("files.uploadPreparing")
    });
    setActiveTransfer({
      kind: "upload",
      fileName: file.name,
      status: "preparing",
      transferredBytes: 0,
      totalBytes: file.size,
      note: t("files.uploadPreparing")
    });

    const init = await initUploadTask({
      target_host_id: selectedHostId,
      target_path: currentPath,
      file_name: file.name,
      file_size: file.size
    });

    let offset = init.resume_offset;
    const chunkSize = init.chunk_size;
    setActiveTransfer({
      kind: "upload",
      fileName: file.name,
      status: init.status,
      transferredBytes: offset,
      totalBytes: file.size,
      note: t("files.uploadRunning")
    });
    updateUploadQueueItem(queueItemId, {
      transferredBytes: offset,
      message: t("files.uploadRunning")
    });
    if (offset < 0 || offset > file.size) {
      throw new Error(t("files.invalidResumeOffset"));
    }

    if (init.status === "paused") {
      const resumed = await resumeTransferTask(init.task_id);
      offset = Math.min(resumed.task.transferred_bytes, file.size);
      setActiveTransfer({
        kind: "upload",
        fileName: file.name,
        status: resumed.task.status,
        transferredBytes: offset,
        totalBytes: file.size,
        note: t("files.uploadRunning")
      });
      updateUploadQueueItem(queueItemId, {
        transferredBytes: offset,
        message: t("files.uploadRunning")
      });
    }

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      const result = await uploadTransferChunk(init.task_id, offset, chunk);
      offset = result.next_offset;
      setActiveTransfer({
        kind: "upload",
        fileName: file.name,
        status: result.status,
        transferredBytes: offset,
        totalBytes: file.size,
        note: t("files.uploadRunning")
      });
      updateUploadQueueItem(queueItemId, {
        transferredBytes: offset,
        message: t("files.uploadRunning")
      });
    }

    const completedTask = await waitForTransferTask(init.task_id, {
      timeoutMessage: t("files.transferTimeout"),
      isDone: (task) => task.status === "completed",
      onProgress: (task) => {
        setActiveTransfer({
          kind: "upload",
          fileName: task.file_name,
          status: task.status,
          transferredBytes: task.transferred_bytes,
          totalBytes: task.total_bytes || file.size,
          note: t("files.uploadFinalizing")
        });
        updateUploadQueueItem(queueItemId, {
          transferredBytes: task.transferred_bytes,
          message: t("files.uploadFinalizing")
        });
      }
    });

    if (completedTask.status !== "completed") {
      throw new Error(completedTask.error_message || t("files.uploadNotCompleted"));
    }

    updateUploadQueueItem(queueItemId, {
      status: "completed",
      transferredBytes: file.size,
      message: t("files.uploadCompleted")
    });
  };

  const uploadFiles = async (files: File[]) => {
    if (!selectedHostId) {
      toast.warning(t("files.selectHostBeforeUpload"));
      return;
    }

    if (files.length === 0) {
      return;
    }

    const existingNames = new Set((directory?.items || []).map((item) => item.name));
    const conflictingNames = Array.from(new Set(files.map((file) => file.name).filter((name) => existingNames.has(name))));
    if (conflictingNames.length > 0) {
      const previewNames = conflictingNames.slice(0, 5).join(", ");
      const shouldContinue = await confirmDialog.requestConfirmation({
        title: t("files.uploadOverwriteTitle"),
        message: t("files.uploadOverwriteMessage", {
          count: conflictingNames.length,
          names: conflictingNames.length > 5 ? `${previewNames}, ...` : previewNames
        }),
        confirmLabel: t("files.uploadOverwriteConfirm"),
        tone: "danger"
      });
      if (!shouldContinue) {
        return;
      }
    }

    resetMessages();
    const batchId = uploadBatchRef.current + 1;
    uploadBatchRef.current = batchId;
    const queueItems = files.map((file, index) => ({
      id: `${batchId}-${index}-${file.name}`,
      fileName: file.name,
      totalBytes: file.size,
      transferredBytes: 0,
      status: "queued" as const,
      message: t("files.uploadQueued")
    }));
    setUploadQueue(queueItems);

    let completedCount = 0;
    let failedCount = 0;
    try {
      for (const [index, file] of files.entries()) {
        const queueItemId = queueItems[index].id;
        try {
          await uploadSingleFile(file, queueItemId);
          completedCount += 1;
        } catch (error) {
          failedCount += 1;
          updateUploadQueueItem(queueItemId, {
            status: "failed",
            message: getApiErrorMessage(error, t("files.uploadFailed"), t)
          });
        }
      }

      if (completedCount > 0) {
        await refreshCurrentDirectory();
        toast.success(t("files.uploadBatchCompleted", { count: completedCount }));
      }
      if (failedCount > 0) {
        toast.error(t("files.uploadSomeFailed", { count: failedCount }));
      }
    } finally {
      setActiveTransfer(null);
    }
  };

  const handleUploadPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadFiles(files);
  };

  const handleUploadDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (selectedHostId) {
      event.dataTransfer.dropEffect = "copy";
      setIsUploadDropActive(true);
    }
  };

  const handleUploadDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsUploadDropActive(false);
    }
  };

  const handleUploadDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsUploadDropActive(false);
    await uploadFiles(Array.from(event.dataTransfer.files || []));
  };

  const beginFileDrag = (event: DragEvent<HTMLElement>, entry: FileEntry) => {
    if (!selectedHostId) {
      event.preventDefault();
      return;
    }
    if ((event.target as HTMLElement | null)?.closest("[data-files-menu-root='true'], button, a, input, select, textarea")) {
      event.preventDefault();
      return;
    }
    setRowMenu(null);
    clearScheduledFileSelect();
    setSelectedEntry(entry);
    setFileDragState({ sourcePath: entry.path, targetPath: null });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-online-ssh-file-path", entry.path);
    event.dataTransfer.setData("text/plain", entry.path);
  };

  const updateFileDragTarget = (event: DragEvent<HTMLElement>, target: FileEntry) => {
    if (!draggedEntry || !canMoveEntryToDirectory(draggedEntry, target)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setFileDragState((current) =>
      current && current.targetPath !== target.path ? { ...current, targetPath: target.path } : current
    );
  };

  const clearFileDragTarget = (event: DragEvent<HTMLElement>, target: FileEntry) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFileDragState((current) =>
        current?.targetPath === target.path ? { ...current, targetPath: null } : current
      );
    }
  };

  const endFileDrag = () => {
    setFileDragState(null);
  };

  const dropFileOnDirectory = async (event: DragEvent<HTMLElement>, target: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();

    const sourcePath = fileDragState?.sourcePath || event.dataTransfer.getData("application/x-online-ssh-file-path");
    const source = visibleItems.find((item) => item.path === sourcePath) || null;
    setFileDragState(null);

    if (!source || !selectedHostId || !canMoveEntryToDirectory(source, target)) {
      return;
    }

    const nextPath = joinPath(target.path, source.name);
    if (nextPath === source.path) {
      return;
    }

    const confirmed = await confirmDialog.requestConfirmation({
      title: t("files.moveConfirmTitle"),
      message: t("files.moveConfirmMessage", {
        name: source.name,
        from: source.path,
        to: target.path
      }),
      confirmLabel: t("files.moveConfirm")
    });
    if (!confirmed) {
      return;
    }

    const succeeded = await performOperation(
      () =>
        renameFile({
          host_id: selectedHostId,
          old_path: source.path,
          new_path: nextPath
        }),
      t("files.action.move"),
      t("files.movedPath")
    );
    if (succeeded && selectedEntry?.path === source.path) {
      setSelectedEntry(null);
    }
  };

  const handleActionDialogSubmit = async () => {
    if (!actionDialog || !selectedHostId || actionSubmitting) {
      return;
    }

    let succeeded = false;
    setActionSubmitting(true);

    try {
      if (actionDialog.kind === "create-directory") {
        const name = actionDialog.value.trim();
        if (!name) {
          toast.warning(t("files.directoryNameRequired"));
          return;
        }
        succeeded = await performOperation(
          () =>
            createDirectory({
              host_id: selectedHostId,
              path: joinPath(currentPath, name)
            }),
          t("files.action.createDirectory"),
          t("files.createdDirectory")
        );
      }

      if (actionDialog.kind === "create-file") {
        const name = actionDialog.value.trim();
        if (!name) {
          toast.warning(t("files.fileNameRequired"));
          return;
        }
        succeeded = await performOperation(
          () =>
            createFile({
              host_id: selectedHostId,
              path: joinPath(currentPath, name)
            }),
          t("files.action.createFile"),
          t("files.createdFile")
        );
      }

      if (actionDialog.kind === "rename") {
        const nextName = actionDialog.value.trim();
        if (!nextName || nextName === actionDialog.entry.name) {
          toast.warning(t("files.newNameRequired"));
          return;
        }

        const nextPath = joinPath(parentPathOf(actionDialog.entry.path), nextName);
        succeeded = await performOperation(
          () =>
            renameFile({
              host_id: selectedHostId,
              old_path: actionDialog.entry.path,
              new_path: nextPath
            }),
          t("files.action.rename"),
          t("files.renamedPath")
        );
        if (succeeded && selectedEntry?.path === actionDialog.entry.path) {
          setSelectedEntry(null);
        }
      }

      if (actionDialog.kind === "chmod") {
        const mode = actionDialog.value.trim();
        if (!mode) {
          toast.warning(t("files.modeRequired"));
          return;
        }

        succeeded = await performOperation(
          () =>
            chmodFile({
              host_id: selectedHostId,
              path: actionDialog.entry.path,
              mode
            }),
          t("files.action.chmod"),
          t("files.changedPermissions")
        );
      }

      if (actionDialog.kind === "delete") {
        succeeded = await performOperation(
          () =>
            deleteFile({
              host_id: selectedHostId,
              path: actionDialog.entry.path,
              recursive: actionDialog.entry.entry_type === "directory"
            }),
          t("files.action.delete"),
          t("files.deletedPath")
        );
        if (succeeded && selectedEntry?.path === actionDialog.entry.path) {
          setSelectedEntry(null);
        }
      }

      if (succeeded) {
        setActionDialog(null);
      }
    } finally {
      setActionSubmitting(false);
    }
  };

  const openContextMenuAt = (
    event: MouseEvent<HTMLElement>,
    menu: { kind: "entry"; path: string } | { kind: "blank" }
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 260;
    const menuHeight = menu.kind === "entry" ? 430 : 170;
    const viewportPadding = 8;
    const left = Math.max(
      viewportPadding,
      Math.min(window.innerWidth - menuWidth - viewportPadding, event.clientX)
    );
    const top = Math.max(
      viewportPadding,
      Math.min(window.innerHeight - menuHeight - viewportPadding, event.clientY)
    );
    setRowMenu({ ...menu, top, left });
  };

  const openEntryContextMenu = (event: MouseEvent<HTMLElement>, entry: FileEntry) => {
    clearScheduledFileSelect();
    setSelectedEntry(entry);
    openContextMenuAt(event, { kind: "entry", path: entry.path });
  };

  const openBlankContextMenu = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(".file-row, .files-grid-item, .ui-data-table-head, button, input, select, textarea, [role='button']")
    ) {
      return;
    }
    openContextMenuAt(event, { kind: "blank" });
  };

  const beginCreateDirectory = () => {
    resetMessages();
    setActionDialog({ kind: "create-directory", value: "" });
  };

  const beginCreateFile = () => {
    resetMessages();
    setActionDialog({ kind: "create-file", value: "" });
  };

  const beginRenameEntry = (entry: FileEntry) => {
    setSelectedEntry(entry);
    setActionDialog({ kind: "rename", entry, value: entry.name });
  };

  const beginChmodEntry = (entry: FileEntry) => {
    setSelectedEntry(entry);
    setActionDialog({ kind: "chmod", entry, value: entry.permissions });
  };

  const beginDeleteEntry = (entry: FileEntry) => {
    setSelectedEntry(entry);
    setActionDialog({ kind: "delete", entry });
  };

  const clearScheduledFileSelect = () => {
    if (fileSelectTimerRef.current !== null) {
      window.clearTimeout(fileSelectTimerRef.current);
      fileSelectTimerRef.current = null;
    }
  };

  const scheduleFileSelect = (entry: FileEntry) => {
    clearScheduledFileSelect();
    fileSelectTimerRef.current = window.setTimeout(() => {
      setSelectedEntry(entry);
      fileSelectTimerRef.current = null;
    }, 180);
  };

  const handleFileTileKeyDown = (event: KeyboardEvent<HTMLElement>, entry: FileEntry) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      clearScheduledFileSelect();
      beginRenameEntry(entry);
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      clearScheduledFileSelect();
      void openEntry(entry);
    }
  };

  const fileDragPropsFor = (entry: FileEntry) => {
    const canDrop = Boolean(draggedEntry && canMoveEntryToDirectory(draggedEntry, entry));
    const isDropTarget = fileDragState?.targetPath === entry.path && canDrop;
    return {
      "aria-grabbed": fileDragState?.sourcePath === entry.path ? true : undefined,
      draggable: Boolean(selectedHostId),
      onDragEnd: endFileDrag,
      onDragLeave: entry.entry_type === "directory" ? (event: DragEvent<HTMLElement>) => clearFileDragTarget(event, entry) : undefined,
      onDragOver: entry.entry_type === "directory" ? (event: DragEvent<HTMLElement>) => updateFileDragTarget(event, entry) : undefined,
      onDragStart: (event: DragEvent<HTMLElement>) => beginFileDrag(event, entry),
      onDrop: entry.entry_type === "directory" ? (event: DragEvent<HTMLElement>) => void dropFileOnDirectory(event, entry) : undefined,
      onContextMenu: (event: MouseEvent<HTMLElement>) => openEntryContextMenu(event, entry),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleFileTileKeyDown(event, entry),
      tabIndex: 0,
      className: [
        fileDragState?.sourcePath === entry.path ? "file-row-dragging" : "",
        canDrop ? "file-row-drop-available" : "",
        isDropTarget ? "file-row-drop-target" : ""
      ].filter(Boolean).join(" ")
    };
  };

  const fileColumns: Array<ColumnDef<FileEntry>> = [
    {
      id: "name",
      accessorFn: (item) => item.name,
      enableSorting: true,
      sortDescFirst: false,
      header: t("files.columnName"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <span
            className="file-row-main"
          >
            <span className="file-name">
              <span className={`file-kind file-kind-${item.entry_type}`} title={entryKindLabel(item.entry_type, t)}>
                <FileEntryTypeIcon entryType={item.entry_type} />
                <span className="visually-hidden">{entryKindLabel(item.entry_type, t)}</span>
              </span>
              <span className="file-row-name-text" title={item.name}>
                {item.name}
              </span>
            </span>
          </span>
        );
      }
    },
    {
      id: "size",
      accessorFn: (item) => item.size_bytes,
      enableSorting: true,
      sortDescFirst: false,
      header: t("files.columnSize"),
      cell: ({ row }) => <span className="file-row-meta">{formatBytes(row.original.size_bytes)}</span>
    },
    {
      id: "permissions",
      accessorFn: (item) => item.permissions,
      enableSorting: true,
      sortDescFirst: false,
      header: t("files.columnPermissions"),
      cell: ({ row }) => <span className="file-row-meta">{row.original.permissions}</span>
    },
    {
      id: "modified",
      accessorFn: (item) => item.modified_at,
      enableSorting: true,
      sortDescFirst: false,
      header: t("files.columnModified"),
      cell: ({ row }) => (
        <span className="file-row-meta file-row-meta-time">
          {formatDateTime(row.original.modified_at, language, t("common.notRecorded"))}
        </span>
      )
    }
  ];

  useEffect(() => {
    if (hostCatalog) {
      return;
    }

    const loadHosts = async () => {
      try {
        const response = await listHosts();
        setLocalHosts(response.items);
      } catch (error) {
        toast.error(getApiErrorMessage(error, t("files.hostsLoadFailed"), t));
      }
    };

    void loadHosts();
  }, [hostCatalog, t, toast]);

  useEffect(() => {
    const temporaryHost = queryHostId ? readTemporaryFileHost(queryHostId) : null;
    if (!temporaryHost) {
      return;
    }
    setTemporaryHosts((current) => {
      if (current.some((host) => host.id === temporaryHost.id)) {
        return current;
      }
      return [temporaryHost, ...current];
    });
  }, [queryHostId]);

  useEffect(() => {
    if (appliedStoredSnapshotRef.current || hosts.length === 0) {
      return;
    }
    appliedStoredSnapshotRef.current = true;

    if (!selectedHostId) {
      return;
    }

    const host = hosts.find((item) => item.id === selectedHostId);
    if (!host) {
      setConnectedHostIds((current) => current.filter((hostId) => hostId !== selectedHostId));
      setFileHostContexts((current) => removeFileHostContext(current, selectedHostId));
      setSearchKeyword("");
      clearActiveFileHost();
      return;
    }

    setConnectedHostIds((current) => (current.includes(selectedHostId) ? current : [selectedHostId, ...current]));
    void loadDirectory(currentPath || defaultHomePath(host), selectedHostId, { historyMode: "replace" });
    if (queryHostId) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, selectedHostId, queryHostId, setSearchParams]);

  useEffect(() => {
    workspace.updateFilesSnapshot({
      selected_host_id: selectedHostId,
      active_host_id: selectedHostId || null,
      open_host_ids: connectedHostIds,
      current_path: currentPath,
      search_keyword: searchKeyword
    });
  }, [connectedHostIds, currentPath, searchKeyword, selectedHostId, workspace]);

  useEffect(() => {
    if (!pathEditing) {
      setPathDraft(currentPath);
    }
  }, [currentPath, pathEditing]);

  useEffect(() => {
    if (!rowMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-files-menu-root='true']")) {
        return;
      }
      setRowMenu(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [rowMenu]);

  shortcutRuntimeRef.current = {
    actionBlocked: Boolean(actionDialog || compressDialog || editorDialog || infoEntry || remoteSearch.open || hostPickerOpen),
    beginCreateDirectory,
    beginCreateFile,
    beginDeleteEntry,
    beginRenameEntry,
    clearScheduledFileSelect,
    copyEntryPath,
    currentPath,
    openEntry,
    openTerminalAtEntry,
    openTerminalAtPath,
    pasteFileClipboard,
    refreshCurrentDirectory,
    rememberFileClipboard,
    selectedEntry: selectedShortcutEntry,
    selectedHostId,
    visible
  };

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      handleFilesShortcutKeyDown(event, shortcutRuntimeRef.current, () => {
        setRowMenu(null);
        shortcutRuntimeRef.current?.clearScheduledFileSelect();
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => () => clearScheduledFileSelect(), []);

  useEffect(() => {
    const objectUrl = editorDialog?.objectUrl;
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [editorDialog?.objectUrl]);

  const editorDraftSizeBytes =
    editorDialog?.status === "ready" ? new TextEncoder().encode(editorDialog.draft).length : 0;
  const editorDraftChanged =
    editorDialog?.status === "ready" && editorDialog.content
      ? editorDialog.draft !== editorDialog.content.content
      : false;
  const filesLoadingState = <LoadingState className="files-loading-state" label={t("files.loadingDirectory")} />;
  const filesEmptyState = selectedHostId && directoryState === "loading" ? (
    filesLoadingState
  ) : selectedHostId && directoryState === "error" ? (
    <EmptyState
      description={directoryErrorMessage || t("files.directoryLoadFailed")}
      title={t("files.directoryErrorTitle")}
    />
  ) : !selectedHostId ? (
    <EmptyState description={t("files.emptyNoHost2")} title={t("files.emptyNoHost1")} />
  ) : selectedHostId &&
    visibleItems.length === 0 &&
    directoryState === "ready" &&
    deferredSearchKeyword ? (
    <EmptyState description={t("files.emptySearch2")} title={t("files.emptySearch1")} />
  ) : selectedHostId &&
    visibleItems.length === 0 &&
    directoryState === "ready" &&
    !deferredSearchKeyword ? (
    <EmptyState description={t("files.emptyDirectory2")} title={t("files.emptyDirectory1")} />
  ) : null;
  const connectedHostContexts: FileHostSidebarContextMap = Object.fromEntries(
    connectedHosts.map((host) => [
      host.id,
      host.id === selectedHostId ? currentFileHostContext(host.id) : fileHostContexts[host.id]
    ])
  );
  const selectedVisibleCount = selectedShortcutEntry ? 1 : 0;

  const cancelEditorEdit = () => {
    setEditorDialog((current) =>
      current?.status === "ready" && current.content
        ? {
          ...current,
          draft: current.content.content,
          editing: false,
          errorMessage: null
        }
        : current
    );
  };

  return (
    <div className="route-page files-page">
      <p className="eyebrow route-eyebrow">File Browser</p>

      <div className="files-layout">
        <section className="content-card files-sidebar">
          <FileHostSidebar
            availableHosts={filteredAvailableHosts}
            connectedHostContexts={connectedHostContexts}
            connectedHosts={connectedHosts}
            filter={hostPickerFilter}
            onActivateHost={activateFileHost}
            onDisconnectHost={(hostId) => void disconnectFileHost(hostId)}
            onFilterChange={setHostPickerFilter}
            onOpenChange={(open) => {
              setHostPickerOpen(open);
              if (!open) {
                setHostPickerFilter("");
              }
            }}
            open={hostPickerOpen}
            selectedHostId={selectedHostId}
            t={t}
          />
          <input hidden multiple onChange={handleUploadPick} ref={uploadInputRef} type="file" />

          <section
            aria-label={t("files.uploadDropTitle")}
            className={[
              "files-upload-dropzone",
              isUploadDropActive ? "files-upload-dropzone-active" : "",
              !selectedHostId ? "files-upload-dropzone-disabled" : ""
            ].filter(Boolean).join(" ")}
            onClick={() => {
              if (selectedHostId) {
                uploadInputRef.current?.click();
              }
            }}
            onDragLeave={handleUploadDragLeave}
            onDragOver={handleUploadDragOver}
            onDrop={(event) => void handleUploadDrop(event)}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && selectedHostId) {
                event.preventDefault();
                uploadInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={selectedHostId ? 0 : -1}
          >
            <div>
              <strong>{isUploadDropActive ? t("files.uploadDropActive") : t("files.uploadDropTitle")}</strong>
              <p>{t("files.uploadDropCopy")}</p>
            </div>
            <span>{uploadQueue.length > 0 ? t("files.uploadQueueSummary", { count: uploadQueue.length }) : t("files.uploadQueueEmpty")}</span>
          </section>

          <FileTransferStatusPanel
            activeTransfer={activeTransfer}
            formatBytes={formatBytes}
            t={t}
            uploadQueue={uploadQueue}
          />
        </section>

        <section className="content-card files-main">
          <FileBrowserToolbar
            backDisabled={navigationHistory.back.length === 0}
            canUseCurrentHost={Boolean(selectedHostId)}
            currentPath={currentPath}
            directoryLoading={directoryState === "loading"}
            forwardDisabled={navigationHistory.forward.length === 0}
            itemCount={visibleItems.length}
            onBack={() => void goBackDirectory()}
            onBeginPathEdit={beginPathEdit}
            onCancelPathEdit={() => {
              setPathEditing(false);
              setPathDraft(currentPath);
            }}
            onClearSearch={() => setSearchKeyword("")}
            onCreateDirectory={() => {
              resetMessages();
              setActionDialog({ kind: "create-directory", value: "" });
            }}
            onCreateFile={() => {
              resetMessages();
              setActionDialog({ kind: "create-file", value: "" });
            }}
            onForward={() => void goForwardDirectory()}
            onGoRoot={() => void loadDirectory("/")}
            onOpenPath={(path) => void loadDirectory(path)}
            onParent={() => void loadDirectory(parentPathOf(currentPath))}
            onPathDraftChange={setPathDraft}
            onRefresh={() => void refreshCurrentDirectory()}
            onRemoteSearch={() => remoteSearch.setOpen(true)}
            onSearchKeywordChange={setSearchKeyword}
            onShowHiddenChange={setShowHiddenFiles}
            onSubmitPathEdit={() => void submitPathEdit()}
            onUpload={handleUploadEntry}
            onViewModeChange={setFileViewMode}
            pathDraft={pathDraft}
            pathEditing={pathEditing}
            searchKeyword={searchKeyword}
            showHidden={showHiddenFiles}
            t={t}
            viewMode={fileViewMode}
          />

          <div
            className={[
              "files-table",
              directoryState === "loading" ? "files-table-loading" : "",
              fileViewMode === "grid" ? "files-table-grid-mode" : ""
            ].filter(Boolean).join(" ")}
            onContextMenu={openBlankContextMenu}
          >
            {selectedHostId && directoryState === "loading" && sortedVisibleItems.length > 0 ? (
              <div className="loading-overlay files-loading-overlay">
                <LoadingState label={t("files.loadingDirectory")} />
              </div>
            ) : null}

            {fileViewMode === "list" ? (
              <DataTable
                className="files-data-table"
                columns={fileColumns}
                columnsTemplate="minmax(220px, 2fr) 86px 116px 172px"
                data={selectedHostId ? sortedVisibleItems : []}
                emptyState={filesEmptyState}
                getRowClassName={(item) => [
                  "file-row",
                  selectedEntry?.path === item.path ? "file-row-active" : "",
                  rowMenu?.kind === "entry" && rowMenu.path === item.path ? "file-row-open-menu" : ""
                ].filter(Boolean).join(" ")}
                getRowId={(item) => item.path}
                getRowProps={fileDragPropsFor}
                manualSorting
                onRowClick={(item) => scheduleFileSelect(item)}
                onRowDoubleClick={(item) => {
                  clearScheduledFileSelect();
                  void openEntry(item);
                }}
                onSortingChange={setFileSorting}
                sorting={fileSorting}
              />
            ) : selectedHostId && sortedVisibleItems.length > 0 ? (
              <div className="files-grid" role="list">
                {sortedVisibleItems.map((item) => {
                  const dragProps = fileDragPropsFor(item);
                  return (
                    <article
                      {...dragProps}
                      className={[
                        "files-grid-item",
                        selectedEntry?.path === item.path ? "files-grid-item-active" : "",
                        rowMenu?.kind === "entry" && rowMenu.path === item.path ? "file-row-open-menu" : "",
                        dragProps.className
                      ].filter(Boolean).join(" ")}
                      key={item.path}
                      onClick={() => scheduleFileSelect(item)}
                      onDoubleClick={() => {
                        clearScheduledFileSelect();
                        void openEntry(item);
                      }}
                      onKeyDown={(event) => handleFileTileKeyDown(event, item)}
                      role="listitem"
                      tabIndex={0}
                      title={item.path}
                    >
                      <div className="files-grid-item-top">
                        <span className={`files-grid-item-icon files-grid-item-icon-${item.entry_type}`}>
                          <FileEntryTypeIcon entryType={item.entry_type} />
                        </span>
                      </div>
                      <span className="files-grid-name">{item.name}</span>
                      <span className="files-grid-meta">
                        {item.entry_type === "directory" ? item.permissions : `${formatBytes(item.size_bytes)} / ${item.permissions}`}
                      </span>
                      <span className="files-grid-meta">
                        {formatDateTime(item.modified_at, language, t("common.notRecorded"))}
                      </span>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="files-grid-empty">{filesEmptyState}</div>
            )}

            <div className="files-status-bar" aria-live="polite">
              <span className="files-status-item">{t("files.totalItems", { count: visibleItems.length })}</span>
              <span className="files-status-item">{t("files.selectedItems", { count: selectedVisibleCount })}</span>
            </div>
          </div>
        </section>
      </div>

      {rowMenu?.kind === "entry" && activeMenuItem
        ? (
          <FileEntryActionMenu
            entry={activeMenuItem}
            left={rowMenu.left}
            onChecksumMd5={() => void calculateChecksum(activeMenuItem, "md5")}
            onChecksumSha256={() => void calculateChecksum(activeMenuItem, "sha256")}
            onChmod={() => beginChmodEntry(activeMenuItem)}
            onClose={() => setRowMenu(null)}
            onCompress={() => {
              setSelectedEntry(activeMenuItem);
              handleCompressArchive(activeMenuItem);
            }}
            onCopy={() => rememberFileClipboard(activeMenuItem, "copy")}
            onCopyPath={() => void copyEntryPath(activeMenuItem)}
            onCut={() => rememberFileClipboard(activeMenuItem, "cut")}
            onDelete={() => beginDeleteEntry(activeMenuItem)}
            onDownload={() => {
              setSelectedEntry(activeMenuItem);
              void handleDownload(activeMenuItem);
            }}
            onExtract={() => {
              setSelectedEntry(activeMenuItem);
              void handleExtractArchive(activeMenuItem);
            }}
            onInfo={() => {
              setSelectedEntry(activeMenuItem);
              setInfoEntry(activeMenuItem);
            }}
            onOpen={() => {
              setSelectedEntry(activeMenuItem);
              void openEntry(activeMenuItem);
            }}
            onOpenTerminal={() => openTerminalAtEntry(activeMenuItem)}
            onRename={() => beginRenameEntry(activeMenuItem)}
            t={t}
            top={rowMenu.top}
          />
        )
        : null}

      {rowMenu?.kind === "blank"
        ? (
          <FileBlankActionMenu
            canPaste={Boolean(fileClipboard && selectedHostId && fileClipboard.hostId === selectedHostId)}
            canUseCurrentHost={Boolean(selectedHostId)}
            left={rowMenu.left}
            onClose={() => setRowMenu(null)}
            onCreateDirectory={beginCreateDirectory}
            onCreateFile={beginCreateFile}
            onOpenTerminal={() => openTerminalAtPath(currentPath)}
            onPaste={() => void pasteFileClipboard()}
            onRefresh={() => void refreshCurrentDirectory()}
            t={t}
            top={rowMenu.top}
          />
        )
        : null}

      {remoteSearch.open ? (
        <FileRemoteSearchDialog
          includeHidden={remoteSearch.includeHidden}
          isActive={remoteSearch.isActive}
          keyword={remoteSearch.keyword}
          maxDepth={remoteSearch.maxDepth}
          onCancel={() => void remoteSearch.cancel()}
          onClose={() => remoteSearch.setOpen(false)}
          onIncludeHiddenChange={remoteSearch.setIncludeHidden}
          onKeywordChange={remoteSearch.setKeyword}
          onMaxDepthChange={remoteSearch.setMaxDepth}
          onOpenResult={(item) => void openRemoteSearchResult(item)}
          onPageChange={(page) => void remoteSearch.goToPage(page)}
          onPageSizeChange={(pageSize) => void remoteSearch.changePageSize(pageSize)}
          onRecursiveChange={remoteSearch.setRecursive}
          onRefresh={() => void remoteSearch.refresh()}
          onStart={() => void remoteSearch.start()}
          page={remoteSearch.page}
          pageSize={remoteSearch.pageSize}
          recursive={remoteSearch.recursive}
          results={remoteSearch.results}
          scopePath={remoteSearchScopePath}
          startDisabled={!selectedHostId}
          state={remoteSearch.state}
          t={t}
          task={remoteSearch.task}
          total={remoteSearch.total}
          totalPages={remoteSearch.totalPages}
        />
      ) : null}

      <FileActionDialogs
        actionDialog={actionDialog}
        actionSubmitting={actionSubmitting}
        compressDialog={compressDialog}
        compressSubmitting={compressSubmitting}
        onActionClose={() => setActionDialog(null)}
        onActionSubmit={() => void handleActionDialogSubmit()}
        onActionValueChange={(value) =>
          setActionDialog((current) =>
            current && current.kind !== "delete" ? { ...current, value } : current
          )
        }
        onCompressClose={() => setCompressDialog(null)}
        onCompressFormatChange={handleCompressFormatChange}
        onCompressNameChange={(name) =>
          setCompressDialog((current) =>
            current ? { ...current, name } : current
          )
        }
        onCompressSubmit={() => void submitCompressArchive()}
        t={t}
      />

      {infoEntry ? (
        <DetailDialog
          closeLabel={t("common.close")}
          items={[
            { label: t("files.name"), value: infoEntry.name },
            { label: t("files.path"), value: infoEntry.path, valueClassName: "mono-wrap" },
            { label: t("files.type"), value: entryKindLabel(infoEntry.entry_type, t) },
            { label: t("files.columnSize"), value: formatBytes(infoEntry.size_bytes) },
            { label: t("files.columnPermissions"), value: infoEntry.permissions },
            { label: t("files.owner"), value: `${infoEntry.owner || t("common.unknown")} / ${infoEntry.group || t("common.unknown")}` },
            { label: t("files.hidden"), value: infoEntry.is_hidden ? t("common.yes") : t("common.no") },
            {
              label: t("files.columnModified"),
              value: formatDateTime(infoEntry.modified_at, language, t("common.notRecorded"))
            }
          ]}
          onOpenChange={(open) => {
            if (!open) {
              setInfoEntry(null);
            }
          }}
          open
          title={t("files.infoTitle")}
        />
      ) : null}

      {editorDialog ? (
        <FilePreviewDialog
          dialog={editorDialog}
          draftChanged={editorDraftChanged}
          draftSizeBytes={editorDraftSizeBytes}
          language={language}
          onCancelEdit={cancelEditorEdit}
          onClose={() => setEditorDialog(null)}
          onDownload={(entry) => void handleDownload(entry)}
          onDraftChange={(value) =>
            setEditorDialog((current) =>
              current ? { ...current, draft: value } : current
            )
          }
          onSave={() => void handleSaveContent()}
          onStartEdit={() =>
            setEditorDialog((current) =>
              current?.status === "ready" ? { ...current, editing: true, errorMessage: null } : current
            )
          }
          t={t}
        />
      ) : null}
    </div>
  );
}
