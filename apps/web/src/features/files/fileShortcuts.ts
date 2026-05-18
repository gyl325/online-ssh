import type { FileEntry } from "./types";

type FilesShortcutCallback = () => void | Promise<void>;

export type FilesShortcutRuntime = {
  actionBlocked: boolean;
  currentPath: string;
  visible: boolean;
  selectedEntry: FileEntry | null;
  selectedHostId: string;
  beginCreateDirectory: FilesShortcutCallback;
  beginCreateFile: FilesShortcutCallback;
  beginDeleteEntry: (entry: FileEntry) => void;
  beginRenameEntry: (entry: FileEntry) => void;
  copyEntryPath: (entry: FileEntry) => void | Promise<void>;
  openEntry: (entry: FileEntry) => void | Promise<void>;
  openTerminalAtEntry: (entry: FileEntry) => void;
  openTerminalAtPath: (path: string) => void;
  pasteFileClipboard: FilesShortcutCallback;
  refreshCurrentDirectory: FilesShortcutCallback;
  rememberFileClipboard: (entry: FileEntry, action: "copy" | "cut") => void;
};

export function isEditableFilesShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, select, textarea, [role='textbox'], [contenteditable='true']"))
  );
}

export function isInteractiveFilesShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, [role='button']"))
  );
}

export function handleFilesShortcutKeyDown(
  event: KeyboardEvent,
  runtime: FilesShortcutRuntime | null | undefined,
  onShortcut: () => void
) {
  if (!runtime || !runtime.visible) {
    return false;
  }
  if (event.defaultPrevented || event.repeat || isEditableFilesShortcutTarget(event.target)) {
    return false;
  }
  if (runtime.actionBlocked) {
    return false;
  }

  const entry = runtime.selectedEntry;
  const key = event.key.toLowerCase();
  const isCtrlOnly = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  const isCtrlShift = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
  const isPlain = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  const isInteractiveTarget = isInteractiveFilesShortcutTarget(event.target);

  const runShortcut = (callback: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    onShortcut();
    callback();
    return true;
  };

  if (isPlain && !isInteractiveTarget && event.key === "Enter" && entry) {
    return runShortcut(() => runtime.beginRenameEntry(entry));
  }

  if (isPlain && !isInteractiveTarget && event.key === "Delete" && entry) {
    return runShortcut(() => runtime.beginDeleteEntry(entry));
  }

  if (isPlain && !isInteractiveTarget && (event.key === " " || event.key === "Spacebar") && entry) {
    return runShortcut(() => {
      void runtime.openEntry(entry);
    });
  }

  if (isCtrlShift && key === "c" && entry) {
    return runShortcut(() => {
      void runtime.copyEntryPath(entry);
    });
  }

  if (isCtrlShift && key === "t" && runtime.selectedHostId) {
    return runShortcut(() => {
      if (entry) {
        runtime.openTerminalAtEntry(entry);
        return;
      }
      runtime.openTerminalAtPath(runtime.currentPath);
    });
  }

  if (isCtrlShift && key === "n" && runtime.selectedHostId) {
    return runShortcut(runtime.beginCreateDirectory);
  }

  if (isCtrlOnly && key === "c" && entry) {
    return runShortcut(() => runtime.rememberFileClipboard(entry, "copy"));
  }

  if (isCtrlOnly && key === "x" && entry) {
    return runShortcut(() => runtime.rememberFileClipboard(entry, "cut"));
  }

  if (isCtrlOnly && key === "v" && runtime.selectedHostId) {
    return runShortcut(() => {
      void runtime.pasteFileClipboard();
    });
  }

  if (isCtrlOnly && key === "n" && runtime.selectedHostId) {
    return runShortcut(runtime.beginCreateFile);
  }

  if (isCtrlOnly && key === "y" && runtime.selectedHostId) {
    return runShortcut(() => {
      void runtime.refreshCurrentDirectory();
    });
  }

  return false;
}
