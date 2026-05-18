import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  FileBlankActionMenu,
  FileEntryActionMenu
} from "./FileEntryActionMenu";
import type { FileEntry } from "./types";

const labels: Record<string, string> = {
  "common.delete": "Delete",
  "files.calculateMd5": "Calculate MD5",
  "files.calculateSha256": "Calculate SHA256",
  "files.changePermissions": "Change permissions",
  "files.compress": "Compress",
  "files.copy": "Copy",
  "files.copyPath": "Copy path",
  "files.createDirectory": "New directory",
  "files.createFile": "New file",
  "files.cut": "Cut",
  "files.download": "Download",
  "files.extract": "Extract",
  "files.info": "View information",
  "files.openContent": "Open content",
  "files.openDirectory": "Open directory",
  "files.openTerminalHere": "Open in terminal",
  "files.paste": "Paste",
  "files.refreshDirectory": "Refresh current directory",
  "files.rename": "Rename"
};

function t(key: string) {
  return labels[key] || key;
}

function entry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    entry_type: "file",
    group: "root",
    is_hidden: false,
    modified_at: "2026-04-24T12:00:00Z",
    name: "notes.txt",
    owner: "root",
    path: "/root/notes.txt",
    permissions: "-rw-r--r--",
    size_bytes: 12,
    ...overrides
  };
}

function renderEntryMenu(overrides: Partial<ComponentProps<typeof FileEntryActionMenu>> = {}) {
  const props: ComponentProps<typeof FileEntryActionMenu> = {
    entry: entry(),
    left: 120,
    onChecksumMd5: vi.fn(),
    onChecksumSha256: vi.fn(),
    onChmod: vi.fn(),
    onClose: vi.fn(),
    onCompress: vi.fn(),
    onCopy: vi.fn(),
    onCopyPath: vi.fn(),
    onCut: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onExtract: vi.fn(),
    onInfo: vi.fn(),
    onOpen: vi.fn(),
    onOpenTerminal: vi.fn(),
    onRename: vi.fn(),
    t,
    top: 80,
    ...overrides
  };

  render(<FileEntryActionMenu {...props} />);
  const menu = document.body.querySelector(".files-row-menu") as HTMLElement;
  return { menu, props };
}

function renderBlankMenu(overrides: Partial<ComponentProps<typeof FileBlankActionMenu>> = {}) {
  const props: ComponentProps<typeof FileBlankActionMenu> = {
    canPaste: true,
    canUseCurrentHost: true,
    left: 200,
    onClose: vi.fn(),
    onCreateDirectory: vi.fn(),
    onCreateFile: vi.fn(),
    onOpenTerminal: vi.fn(),
    onPaste: vi.fn(),
    onRefresh: vi.fn(),
    t,
    top: 140,
    ...overrides
  };

  render(<FileBlankActionMenu {...props} />);
  const menu = document.body.querySelector(".files-row-menu") as HTMLElement;
  return { menu, props };
}

function expectShortcut(button: HTMLElement, ariaShortcut: string, keys: string[]) {
  expect(button).toHaveAttribute("aria-keyshortcuts", ariaShortcut);
  const shortcut = button.querySelector(".files-row-menu-shortcut");
  expect(shortcut).not.toBeNull();
  for (const key of keys) {
    expect(within(shortcut as HTMLElement).getByText(key)).toBeInTheDocument();
  }
}

describe("FileEntryActionMenu", () => {
  it("renders entry actions with shortcut hints and portal positioning", () => {
    const { menu } = renderEntryMenu();

    expect(menu).not.toBeNull();
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveAttribute("data-files-menu-root", "true");
    expect(menu).toHaveStyle({ left: "120px", top: "80px" });

    expect(within(menu).getByRole("button", { name: "View information" })).toBeInTheDocument();
    expectShortcut(within(menu).getByRole("button", { name: "Open content" }), "Space", ["Space"]);
    expectShortcut(within(menu).getByRole("button", { name: "Rename" }), "Enter", ["Enter"]);
    expectShortcut(within(menu).getByRole("button", { name: "Copy" }), "Control+C", ["Ctrl", "C"]);
    expectShortcut(within(menu).getByRole("button", { name: "Cut" }), "Control+X", ["Ctrl", "X"]);
    expectShortcut(within(menu).getByRole("button", { name: "Copy path" }), "Control+Shift+C", ["Ctrl", "Shift", "C"]);
    expectShortcut(within(menu).getByRole("button", { name: "Open in terminal" }), "Control+Shift+T", ["Ctrl", "Shift", "T"]);
    expectShortcut(within(menu).getByRole("button", { name: "Delete" }), "Delete", ["Delete"]);
    expect(within(menu).getByRole("button", { name: "Delete" })).toHaveClass("files-row-menu-item-danger");
  });

  it("shows archive actions only for supported row types", () => {
    let result = renderEntryMenu({
      entry: entry({
        entry_type: "directory",
        name: "logs",
        path: "/root/logs"
      })
    });
    expect(within(result.menu).getByRole("button", { name: "Open directory" })).toBeInTheDocument();
    expect(within(result.menu).getByRole("button", { name: "Compress" })).toBeInTheDocument();
    expect(within(result.menu).queryByRole("button", { name: "Extract" })).not.toBeInTheDocument();

    cleanup();
    result = renderEntryMenu({
      entry: entry({
        name: "backup.tar.gz",
        path: "/root/backup.tar.gz"
      })
    });
    expect(within(result.menu).queryByRole("button", { name: "Compress" })).not.toBeInTheDocument();
    expect(within(result.menu).getByRole("button", { name: "Extract" })).toBeInTheDocument();

    cleanup();
    result = renderEntryMenu();
    expect(within(result.menu).queryByRole("button", { name: "Compress" })).not.toBeInTheDocument();
    expect(within(result.menu).queryByRole("button", { name: "Extract" })).not.toBeInTheDocument();
  });

  it("forwards entry actions after closing the menu", async () => {
    const user = userEvent.setup();
    const { menu, props } = renderEntryMenu();

    await user.click(within(menu).getByRole("button", { name: "Copy path" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onCopyPath).toHaveBeenCalledTimes(1);

    await user.click(within(menu).getByRole("button", { name: "Calculate SHA256" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onChecksumSha256).toHaveBeenCalledTimes(1);
  });
});

describe("FileBlankActionMenu", () => {
  it("renders blank-area actions with shortcut hints", () => {
    const { menu } = renderBlankMenu();

    expect(menu).not.toBeNull();
    expect(menu.parentElement).toBe(document.body);
    expectShortcut(within(menu).getByRole("button", { name: "New directory" }), "Control+Shift+N", ["Ctrl", "Shift", "N"]);
    expectShortcut(within(menu).getByRole("button", { name: "New file" }), "Control+N", ["Ctrl", "N"]);
    expectShortcut(within(menu).getByRole("button", { name: "Open in terminal" }), "Control+Shift+T", ["Ctrl", "Shift", "T"]);
    expectShortcut(within(menu).getByRole("button", { name: "Paste" }), "Control+V", ["Ctrl", "V"]);
    expectShortcut(within(menu).getByRole("button", { name: "Refresh current directory" }), "Control+Y", ["Ctrl", "Y"]);
  });

  it("keeps host and paste availability as parent-owned disabled props", async () => {
    const user = userEvent.setup();
    const { menu, props } = renderBlankMenu({
      canPaste: false,
      canUseCurrentHost: false
    });

    expect(within(menu).getByRole("button", { name: "New directory" })).toBeDisabled();
    expect(within(menu).getByRole("button", { name: "New file" })).toBeDisabled();
    expect(within(menu).getByRole("button", { name: "Open in terminal" })).toBeDisabled();
    expect(within(menu).getByRole("button", { name: "Paste" })).toBeDisabled();
    expect(within(menu).getByRole("button", { name: "Refresh current directory" })).toBeDisabled();

    await user.click(within(menu).getByRole("button", { name: "Paste" }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onPaste).not.toHaveBeenCalled();
  });

  it("forwards blank-area actions after closing the menu", async () => {
    const user = userEvent.setup();
    const { menu, props } = renderBlankMenu();

    await user.click(within(menu).getByRole("button", { name: "New directory" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onCreateDirectory).toHaveBeenCalledTimes(1);

    await user.click(within(menu).getByRole("button", { name: "Paste" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onPaste).toHaveBeenCalledTimes(1);
  });
});
