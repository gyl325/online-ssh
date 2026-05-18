import { describe, expect, it, vi } from "vitest";

import {
  handleFilesShortcutKeyDown,
  isEditableFilesShortcutTarget,
  isInteractiveFilesShortcutTarget,
  type FilesShortcutRuntime
} from "./fileShortcuts";
import type { FileEntry } from "./types";

const fileEntry: FileEntry = {
  name: "notes.txt",
  path: "/root/notes.txt",
  entry_type: "file",
  size_bytes: 12,
  permissions: "-rw-r--r--",
  modified_at: "2026-04-24T12:00:00Z",
  is_hidden: false
};

function createRuntime(overrides: Partial<FilesShortcutRuntime> = {}): FilesShortcutRuntime {
  return {
    actionBlocked: false,
    beginCreateDirectory: vi.fn(),
    beginCreateFile: vi.fn(),
    beginDeleteEntry: vi.fn(),
    beginRenameEntry: vi.fn(),
    copyEntryPath: vi.fn(),
    currentPath: "/root",
    openEntry: vi.fn(),
    openTerminalAtEntry: vi.fn(),
    openTerminalAtPath: vi.fn(),
    pasteFileClipboard: vi.fn(),
    refreshCurrentDirectory: vi.fn(),
    rememberFileClipboard: vi.fn(),
    selectedEntry: fileEntry,
    selectedHostId: "host-1",
    visible: true,
    ...overrides
  };
}

function dispatchShortcut(
  init: KeyboardEventInit,
  runtime: FilesShortcutRuntime,
  options: { target?: HTMLElement; onShortcut?: () => void } = {}
) {
  const target = options.target ?? document.body;
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init
  });
  const onShortcut = vi.fn(options.onShortcut);

  target.addEventListener(
    "keydown",
    (keyboardEvent) => handleFilesShortcutKeyDown(keyboardEvent, runtime, onShortcut),
    { once: true }
  );
  target.dispatchEvent(event);

  return { event, onShortcut };
}

describe("file shortcut target helpers", () => {
  it("detects editable and interactive shortcut targets", () => {
    document.body.innerHTML = `
      <div>
        <label><input data-testid="input" /></label>
        <div role="textbox" data-testid="textbox"></div>
        <button data-testid="button"><span data-testid="button-child">Run</span></button>
        <a data-testid="link" href="/">Link</a>
        <div data-testid="plain"></div>
      </div>
    `;

    expect(isEditableFilesShortcutTarget(document.querySelector("[data-testid='input']"))).toBe(true);
    expect(isEditableFilesShortcutTarget(document.querySelector("[data-testid='textbox']"))).toBe(true);
    expect(isEditableFilesShortcutTarget(document.querySelector("[data-testid='plain']"))).toBe(false);
    expect(isInteractiveFilesShortcutTarget(document.querySelector("[data-testid='button-child']"))).toBe(true);
    expect(isInteractiveFilesShortcutTarget(document.querySelector("[data-testid='link']"))).toBe(true);
    expect(isInteractiveFilesShortcutTarget(document.querySelector("[data-testid='plain']"))).toBe(false);
  });
});

describe("handleFilesShortcutKeyDown", () => {
  it("ignores hidden, blocked, repeated, prevented, and editable target shortcuts", () => {
    const hiddenRuntime = createRuntime({ visible: false });
    dispatchShortcut({ ctrlKey: true, key: "n" }, hiddenRuntime);
    expect(hiddenRuntime.beginCreateFile).not.toHaveBeenCalled();

    const blockedRuntime = createRuntime({ actionBlocked: true });
    dispatchShortcut({ ctrlKey: true, key: "n" }, blockedRuntime);
    expect(blockedRuntime.beginCreateFile).not.toHaveBeenCalled();

    const repeatRuntime = createRuntime();
    dispatchShortcut({ ctrlKey: true, key: "n", repeat: true }, repeatRuntime);
    expect(repeatRuntime.beginCreateFile).not.toHaveBeenCalled();

    const preventedRuntime = createRuntime();
    const preventedEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "n"
    });
    preventedEvent.preventDefault();
    const preventedShortcut = vi.fn();
    handleFilesShortcutKeyDown(preventedEvent, preventedRuntime, preventedShortcut);
    expect(preventedRuntime.beginCreateFile).not.toHaveBeenCalled();
    expect(preventedShortcut).not.toHaveBeenCalled();

    const input = document.createElement("input");
    document.body.append(input);
    const editableRuntime = createRuntime();
    dispatchShortcut({ ctrlKey: true, key: "n" }, editableRuntime, { target: input });
    expect(editableRuntime.beginCreateFile).not.toHaveBeenCalled();
  });

  it("runs selected-entry shortcuts and calls the shortcut boundary callback", () => {
    const runtime = createRuntime();

    const rename = dispatchShortcut({ key: "Enter" }, runtime);
    expect(runtime.beginRenameEntry).toHaveBeenCalledWith(fileEntry);
    expect(rename.event.defaultPrevented).toBe(true);
    expect(rename.onShortcut).toHaveBeenCalledTimes(1);

    dispatchShortcut({ key: "Delete" }, runtime);
    expect(runtime.beginDeleteEntry).toHaveBeenCalledWith(fileEntry);

    dispatchShortcut({ key: " " }, runtime);
    expect(runtime.openEntry).toHaveBeenCalledWith(fileEntry);

    dispatchShortcut({ ctrlKey: true, key: "c" }, runtime);
    expect(runtime.rememberFileClipboard).toHaveBeenCalledWith(fileEntry, "copy");

    dispatchShortcut({ ctrlKey: true, key: "x" }, runtime);
    expect(runtime.rememberFileClipboard).toHaveBeenCalledWith(fileEntry, "cut");

    dispatchShortcut({ ctrlKey: true, shiftKey: true, key: "C" }, runtime);
    expect(runtime.copyEntryPath).toHaveBeenCalledWith(fileEntry);
  });

  it("runs current-directory shortcuts and opens terminal at the selected entry or current path", () => {
    const runtime = createRuntime();

    dispatchShortcut({ ctrlKey: true, shiftKey: true, key: "T" }, runtime);
    expect(runtime.openTerminalAtEntry).toHaveBeenCalledWith(fileEntry);
    expect(runtime.openTerminalAtPath).not.toHaveBeenCalled();

    const directoryRuntime = createRuntime({ selectedEntry: null });
    dispatchShortcut({ ctrlKey: true, shiftKey: true, key: "T" }, directoryRuntime);
    expect(directoryRuntime.openTerminalAtPath).toHaveBeenCalledWith("/root");

    dispatchShortcut({ ctrlKey: true, shiftKey: true, key: "N" }, runtime);
    expect(runtime.beginCreateDirectory).toHaveBeenCalled();

    dispatchShortcut({ ctrlKey: true, key: "n" }, runtime);
    expect(runtime.beginCreateFile).toHaveBeenCalled();

    dispatchShortcut({ ctrlKey: true, key: "v" }, runtime);
    expect(runtime.pasteFileClipboard).toHaveBeenCalled();

    dispatchShortcut({ ctrlKey: true, key: "y" }, runtime);
    expect(runtime.refreshCurrentDirectory).toHaveBeenCalled();
  });

  it("requires a selected host for current-directory shortcuts and avoids plain shortcuts from interactive targets", () => {
    const noHostRuntime = createRuntime({ selectedHostId: "" });

    dispatchShortcut({ ctrlKey: true, key: "n" }, noHostRuntime);
    expect(noHostRuntime.beginCreateFile).not.toHaveBeenCalled();

    dispatchShortcut({ ctrlKey: true, shiftKey: true, key: "N" }, noHostRuntime);
    expect(noHostRuntime.beginCreateDirectory).not.toHaveBeenCalled();

    dispatchShortcut({ ctrlKey: true, shiftKey: true, key: "T" }, noHostRuntime);
    expect(noHostRuntime.openTerminalAtEntry).not.toHaveBeenCalled();
    expect(noHostRuntime.openTerminalAtPath).not.toHaveBeenCalled();

    const button = document.createElement("button");
    document.body.append(button);
    const runtime = createRuntime();
    dispatchShortcut({ key: "Enter" }, runtime, { target: button });
    expect(runtime.beginRenameEntry).not.toHaveBeenCalled();
  });
});
