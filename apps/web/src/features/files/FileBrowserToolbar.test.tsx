import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileBrowserToolbar, type FileBrowserViewMode } from "./FileBrowserToolbar";

const labels: Record<string, string> = {
  "files.back": "Back",
  "files.clearSearch": "Clear search",
  "files.createDirectory": "New directory",
  "files.createFile": "New file",
  "files.forward": "Forward",
  "files.go": "Go",
  "files.goRoot": "Go to root",
  "files.listSummary": "{{count}} entries",
  "files.listTitle": "Files",
  "files.loadingDirectory": "Loading directory...",
  "files.parent": "Parent directory",
  "files.refreshDirectory": "Refresh",
  "files.remoteSearchTitle": "Remote search",
  "files.searchPlaceholder": "Search current directory",
  "files.uploadEntry": "Upload",
  "files.viewGrid": "Grid view",
  "files.viewList": "List view",
  "files.viewMode": "View mode"
};

function t(key: string, values?: Record<string, string | number>) {
  let value = labels[key] || key;
  Object.entries(values || {}).forEach(([name, replacement]) => {
    value = value.replace(`{{${name}}}`, String(replacement));
  });
  return value;
}

function renderToolbar(overrides?: Partial<Parameters<typeof FileBrowserToolbar>[0]>) {
  const props = {
    canUseCurrentHost: true,
    currentPath: "/root/logs",
    directoryLoading: false,
    forwardDisabled: false,
    backDisabled: false,
    itemCount: 3,
    onBack: vi.fn(),
    onBeginPathEdit: vi.fn(),
    onCancelPathEdit: vi.fn(),
    onClearSearch: vi.fn(),
    onCreateDirectory: vi.fn(),
    onCreateFile: vi.fn(),
    onForward: vi.fn(),
    onGoRoot: vi.fn(),
    onOpenPath: vi.fn(),
    onParent: vi.fn(),
    onPathDraftChange: vi.fn(),
    onRefresh: vi.fn(),
    onRemoteSearch: vi.fn(),
    onSearchKeywordChange: vi.fn(),
    onSubmitPathEdit: vi.fn(),
    onUpload: vi.fn(),
    onViewModeChange: vi.fn<(mode: FileBrowserViewMode) => void>(),
    pathDraft: "/root/logs",
    pathEditing: false,
    searchKeyword: "log",
    t,
    viewMode: "list" as FileBrowserViewMode,
    ...overrides
  };

  render(<FileBrowserToolbar {...props} />);
  return props;
}

describe("FileBrowserToolbar", () => {
  it("renders summary and keeps navigation controls in the established order", () => {
    renderToolbar();

    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByText("3 entries")).toBeInTheDocument();

    const toolbar = document.querySelector(".files-toolbar");
    expect(toolbar).not.toBeNull();
    const controls = Array.from((toolbar as HTMLElement).children).map((element) => {
      if (element.getAttribute("role") === "group") {
        return element.getAttribute("aria-label");
      }
      return element.getAttribute("aria-label");
    });

    expect(controls.slice(0, 5)).toEqual(["Back", "Forward", "View mode", "Go to root", "Parent directory"]);
  });

  it("forwards search, clear, and toolbar actions without owning file state", async () => {
    const user = userEvent.setup();
    const props = renderToolbar();

    await user.type(screen.getByPlaceholderText("Search current directory"), "s");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Forward" }));
    await user.click(screen.getByRole("button", { name: "Go to root" }));
    await user.click(screen.getByRole("button", { name: "Parent directory" }));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getByRole("button", { name: "Remote search" }));
    await user.click(screen.getByRole("button", { name: "New directory" }));
    await user.click(screen.getByRole("button", { name: "New file" }));
    await user.click(screen.getByRole("button", { name: "Upload" }));

    const viewMode = screen.getByRole("group", { name: "View mode" });
    await user.click(within(viewMode).getByRole("button", { name: "Grid view" }));

    expect(props.onSearchKeywordChange).toHaveBeenLastCalledWith("logs");
    expect(props.onClearSearch).toHaveBeenCalledTimes(1);
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onForward).toHaveBeenCalledTimes(1);
    expect(props.onGoRoot).toHaveBeenCalledTimes(1);
    expect(props.onParent).toHaveBeenCalledTimes(1);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onRemoteSearch).toHaveBeenCalledTimes(1);
    expect(props.onCreateDirectory).toHaveBeenCalledTimes(1);
    expect(props.onCreateFile).toHaveBeenCalledTimes(1);
    expect(props.onUpload).toHaveBeenCalledTimes(1);
    expect(props.onViewModeChange).toHaveBeenCalledWith("grid");
  });

  it("forwards breadcrumb navigation and blank breadcrumb edit requests", async () => {
    const user = userEvent.setup();
    const props = renderToolbar();

    await user.click(screen.getByRole("button", { name: "root" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("/root");

    await user.click(screen.getByRole("button", { name: "logs" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("/root/logs");

    const breadcrumb = document.querySelector(".files-inline-breadcrumb");
    expect(breadcrumb).not.toBeNull();
    await user.click(breadcrumb as HTMLElement);
    expect(props.onBeginPathEdit).toHaveBeenCalledTimes(1);
  });

  it("supports path editing submit and cancel flows", async () => {
    const user = userEvent.setup();
    const props = renderToolbar({ pathEditing: true, pathDraft: "/var/log" });

    const input = screen.getByDisplayValue("/var/log");
    fireEvent.change(input, { target: { value: "/etc" } });
    expect(props.onPathDraftChange).toHaveBeenLastCalledWith("/etc");

    await user.keyboard("{Enter}");
    expect(props.onSubmitPathEdit).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(props.onCancelPathEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(props.onSubmitPathEdit).toHaveBeenCalledTimes(2);
  });
});
