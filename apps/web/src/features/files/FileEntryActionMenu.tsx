import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { canExtractArchive } from "./fileViewModel";
import type { FileEntry } from "./types";

export type FileShortcutHint = {
  aria: string;
  keys: readonly string[];
};

export const fileActionMenuShortcuts = {
  open: { aria: "Space", keys: ["Space"] },
  rename: { aria: "Enter", keys: ["Enter"] },
  copy: { aria: "Control+C", keys: ["Ctrl", "C"] },
  cut: { aria: "Control+X", keys: ["Ctrl", "X"] },
  copyPath: { aria: "Control+Shift+C", keys: ["Ctrl", "Shift", "C"] },
  openTerminal: { aria: "Control+Shift+T", keys: ["Ctrl", "Shift", "T"] },
  delete: { aria: "Delete", keys: ["Delete"] },
  paste: { aria: "Control+V", keys: ["Ctrl", "V"] },
  createFile: { aria: "Control+N", keys: ["Ctrl", "N"] },
  createDirectory: { aria: "Control+Shift+N", keys: ["Ctrl", "Shift", "N"] },
  refresh: { aria: "Control+Y", keys: ["Ctrl", "Y"] }
} as const satisfies Record<string, FileShortcutHint>;

type MenuAction = () => void;

type FileActionMenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  onAction?: MenuAction;
  onClose: () => void;
  shortcut?: FileShortcutHint;
};

type FileEntryActionMenuProps = {
  entry: FileEntry;
  left: number;
  onChecksumMd5: MenuAction;
  onChecksumSha256: MenuAction;
  onChmod: MenuAction;
  onClose: () => void;
  onCompress: MenuAction;
  onCopy: MenuAction;
  onCopyPath: MenuAction;
  onCut: MenuAction;
  onDelete: MenuAction;
  onDownload: MenuAction;
  onExtract: MenuAction;
  onInfo: MenuAction;
  onOpen: MenuAction;
  onOpenTerminal: MenuAction;
  onRename: MenuAction;
  t: (key: string, values?: Record<string, string | number>) => string;
  top: number;
};

type FileBlankActionMenuProps = {
  canPaste: boolean;
  canUseCurrentHost: boolean;
  left: number;
  onClose: () => void;
  onCreateDirectory: MenuAction;
  onCreateFile: MenuAction;
  onOpenTerminal: MenuAction;
  onPaste: MenuAction;
  onRefresh: MenuAction;
  t: (key: string, values?: Record<string, string | number>) => string;
  top: number;
};

function FileActionMenuItem({
  children,
  className,
  onAction,
  onClick,
  onClose,
  shortcut,
  type = "button",
  ...buttonProps
}: FileActionMenuItemProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || buttonProps.disabled) {
      return;
    }
    event.stopPropagation();
    onClose();
    onAction?.();
  };

  return (
    <button
      {...buttonProps}
      aria-keyshortcuts={shortcut?.aria}
      className={["files-row-menu-item", className || ""].filter(Boolean).join(" ")}
      onClick={handleClick}
      type={type}
    >
      <span className="files-row-menu-label">{children}</span>
      {shortcut ? (
        <span className="files-row-menu-shortcut" aria-hidden="true">
          {shortcut.keys.map((key) => (
            <kbd className="files-row-menu-key" key={key}>
              {key}
            </kbd>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function FileActionMenuSurface({
  children,
  left,
  top
}: {
  children: ReactNode;
  left: number;
  top: number;
}) {
  return createPortal(
    <div
      className="files-row-menu"
      data-files-menu-root="true"
      style={{ top, left }}
    >
      {children}
    </div>,
    document.body
  );
}

export function FileEntryActionMenu({
  entry,
  left,
  onChecksumMd5,
  onChecksumSha256,
  onChmod,
  onClose,
  onCompress,
  onCopy,
  onCopyPath,
  onCut,
  onDelete,
  onDownload,
  onExtract,
  onInfo,
  onOpen,
  onOpenTerminal,
  onRename,
  t,
  top
}: FileEntryActionMenuProps) {
  return (
    <FileActionMenuSurface left={left} top={top}>
      <FileActionMenuItem onAction={onInfo} onClose={onClose}>
        {t("files.info")}
      </FileActionMenuItem>
      <FileActionMenuItem onAction={onOpen} onClose={onClose} shortcut={fileActionMenuShortcuts.open}>
        {entry.entry_type === "directory" ? t("files.openDirectory") : t("files.openContent")}
      </FileActionMenuItem>
      <div className="files-row-menu-separator" role="separator" />
      <FileActionMenuItem onAction={onRename} onClose={onClose} shortcut={fileActionMenuShortcuts.rename}>
        {t("files.rename")}
      </FileActionMenuItem>
      <FileActionMenuItem onAction={onChmod} onClose={onClose}>
        {t("files.changePermissions")}
      </FileActionMenuItem>
      <FileActionMenuItem onAction={onCopy} onClose={onClose} shortcut={fileActionMenuShortcuts.copy}>
        {t("files.copy")}
      </FileActionMenuItem>
      <FileActionMenuItem onAction={onCut} onClose={onClose} shortcut={fileActionMenuShortcuts.cut}>
        {t("files.cut")}
      </FileActionMenuItem>
      <FileActionMenuItem onAction={onCopyPath} onClose={onClose} shortcut={fileActionMenuShortcuts.copyPath}>
        {t("files.copyPath")}
      </FileActionMenuItem>
      <FileActionMenuItem onAction={onOpenTerminal} onClose={onClose} shortcut={fileActionMenuShortcuts.openTerminal}>
        {t("files.openTerminalHere")}
      </FileActionMenuItem>
      <div className="files-row-menu-separator" role="separator" />
      {entry.entry_type === "directory" ? (
        <FileActionMenuItem onAction={onCompress} onClose={onClose}>
          {t("files.compress")}
        </FileActionMenuItem>
      ) : null}
      {canExtractArchive(entry) ? (
        <FileActionMenuItem onAction={onExtract} onClose={onClose}>
          {t("files.extract")}
        </FileActionMenuItem>
      ) : null}
      <FileActionMenuItem disabled={entry.entry_type !== "file"} onAction={onDownload} onClose={onClose}>
        {t("files.download")}
      </FileActionMenuItem>
      <FileActionMenuItem disabled={entry.entry_type !== "file"} onAction={onChecksumMd5} onClose={onClose}>
        {t("files.calculateMd5")}
      </FileActionMenuItem>
      <FileActionMenuItem disabled={entry.entry_type !== "file"} onAction={onChecksumSha256} onClose={onClose}>
        {t("files.calculateSha256")}
      </FileActionMenuItem>
      <div className="files-row-menu-separator" role="separator" />
      <FileActionMenuItem
        className="files-row-menu-item-danger"
        onAction={onDelete}
        onClose={onClose}
        shortcut={fileActionMenuShortcuts.delete}
      >
        {t("common.delete")}
      </FileActionMenuItem>
    </FileActionMenuSurface>
  );
}

export function FileBlankActionMenu({
  canPaste,
  canUseCurrentHost,
  left,
  onClose,
  onCreateDirectory,
  onCreateFile,
  onOpenTerminal,
  onPaste,
  onRefresh,
  t,
  top
}: FileBlankActionMenuProps) {
  return (
    <FileActionMenuSurface left={left} top={top}>
      <FileActionMenuItem
        disabled={!canUseCurrentHost}
        onAction={onCreateDirectory}
        onClose={onClose}
        shortcut={fileActionMenuShortcuts.createDirectory}
      >
        {t("files.createDirectory")}
      </FileActionMenuItem>
      <FileActionMenuItem
        disabled={!canUseCurrentHost}
        onAction={onCreateFile}
        onClose={onClose}
        shortcut={fileActionMenuShortcuts.createFile}
      >
        {t("files.createFile")}
      </FileActionMenuItem>
      <FileActionMenuItem
        disabled={!canUseCurrentHost}
        onAction={onOpenTerminal}
        onClose={onClose}
        shortcut={fileActionMenuShortcuts.openTerminal}
      >
        {t("files.openTerminalHere")}
      </FileActionMenuItem>
      <div className="files-row-menu-separator" role="separator" />
      <FileActionMenuItem
        disabled={!canPaste}
        onAction={onPaste}
        onClose={onClose}
        shortcut={fileActionMenuShortcuts.paste}
      >
        {t("files.paste")}
      </FileActionMenuItem>
      <FileActionMenuItem
        disabled={!canUseCurrentHost}
        onAction={onRefresh}
        onClose={onClose}
        shortcut={fileActionMenuShortcuts.refresh}
      >
        {t("files.refreshDirectory")}
      </FileActionMenuItem>
    </FileActionMenuSurface>
  );
}
