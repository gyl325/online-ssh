import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { selectInputOption } from "../../test/selectInput";
import { FileRemoteSearchDialog } from "./FileRemoteSearchDialog";
import type { FileSearchResult, FileSearchTask } from "./types";

const labels: Record<string, string> = {
  "common.close": "Close",
  "files.kind.directory": "Directory",
  "files.kind.file": "File",
  "files.kind.other": "Other",
  "files.kind.symlink": "Symlink",
  "files.remoteSearchCancel": "Cancel search",
  "files.remoteSearchDepth": "Depth",
  "files.remoteSearchDirs": "{{count}} dirs",
  "files.remoteSearchEmpty": "No remote search results.",
  "files.remoteSearchEntries": "{{count}} entries",
  "files.remoteSearchHidden": "Include hidden",
  "files.remoteSearchIdle": "No remote search has started",
  "files.remoteSearchKeyword": "Keyword",
  "files.remoteSearchKeywordPlaceholder": "At least 2 characters",
  "files.remoteSearchLimitReached": "Limit reached",
  "files.remoteSearchMatches": "{{count}} matches",
  "files.remoteSearchPageSummary": "Page {{page}} / {{totalPages}}, {{total}} results total.",
  "files.remoteSearchPartial": "Search is still running. Showing partial results written so far.",
  "files.remoteSearchRecursive": "Recursive",
  "files.remoteSearchRefresh": "Refresh results",
  "files.remoteSearchRunning": "Searching",
  "files.remoteSearchScope": "Search scope: {{path}}",
  "files.remoteSearchSkipped": "{{count}} skipped",
  "files.remoteSearchStart": "Start remote search",
  "files.remoteSearchSummary": "{{status}} · scanned {{scanned}} · matched {{matched}}",
  "files.remoteSearchTitle": "Remote search",
  "pagination.first": "First",
  "pagination.last": "Last",
  "pagination.next": "Next",
  "pagination.pageSize": "Per page",
  "pagination.previous": "Previous"
};

function t(key: string, params?: Record<string, string | number>) {
  let value = labels[key] || key;
  Object.entries(params || {}).forEach(([param, replacement]) => {
    value = value.replace(`{{${param}}}`, String(replacement));
  });
  return value;
}

const task: FileSearchTask = {
  id: "search-task-1",
  host_id: "host-1",
  base_path: "/var/log",
  keyword: "nginx",
  match_mode: "path",
  recursive: true,
  include_hidden: false,
  max_depth: 4,
  max_results: 500,
  max_scanned_entries: 50000,
  timeout_seconds: 30,
  status: "completed",
  scanned_dirs: 3,
  scanned_entries: 18,
  matched_entries: 2,
  skipped_errors_count: 1,
  limit_reached: false,
  error_code: null,
  error_message: null,
  warnings_json: [],
  started_at: "2026-05-12T10:00:00Z",
  finished_at: "2026-05-12T10:00:01Z",
  expires_at: "2026-05-12T11:00:00Z",
  created_at: "2026-05-12T10:00:00Z",
  updated_at: "2026-05-12T10:00:01Z"
};

const result: FileSearchResult = {
  id: "result-1",
  task_id: "search-task-1",
  rank: 1,
  name: "nginx.conf",
  path: "/var/log/nginx.conf",
  entry_type: "file",
  size_bytes: 12,
  permissions: "0644",
  owner: "root",
  group: "root",
  modified_at: "2026-05-12T10:00:00Z",
  is_hidden: false,
  created_at: "2026-05-12T10:00:01Z"
};

function renderDialog(overrides?: Partial<ComponentProps<typeof FileRemoteSearchDialog>>) {
  const props: ComponentProps<typeof FileRemoteSearchDialog> = {
    includeHidden: false,
    isActive: false,
    keyword: "",
    maxDepth: 6,
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onIncludeHiddenChange: vi.fn(),
    onKeywordChange: vi.fn(),
    onMaxDepthChange: vi.fn(),
    onOpenResult: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onRecursiveChange: vi.fn(),
    onRefresh: vi.fn(),
    onStart: vi.fn(),
    page: 1,
    pageSize: 50,
    recursive: true,
    results: [],
    scopePath: "/var/log",
    startDisabled: false,
    state: "idle",
    t,
    task: null,
    total: 0,
    totalPages: 1,
    ...overrides
  };

  render(<FileRemoteSearchDialog {...props} />);
  return props;
}

describe("FileRemoteSearchDialog", () => {
  it("renders idle scope and search controls, then forwards start", async () => {
    const user = userEvent.setup();
    const props = renderDialog({ keyword: "nginx", maxDepth: 2 });

    const dialog = screen.getByRole("dialog", { name: "Remote search" });
    expect(within(dialog).getByText("No remote search has started")).toBeInTheDocument();
    expect(within(dialog).getByText("Search scope: /var/log")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Keyword")).toHaveValue("nginx");
    expect(within(dialog).getByLabelText("Depth")).toHaveTextContent("2");
    expect(within(dialog).getByLabelText("Recursive")).toBeChecked();
    expect(within(dialog).getByLabelText("Include hidden")).not.toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Start remote search" }));

    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it("forwards search control changes", async () => {
    const user = userEvent.setup();
    const props = renderDialog({ keyword: "nginx", maxDepth: 2 });

    const dialog = screen.getByRole("dialog", { name: "Remote search" });
    fireEvent.change(within(dialog).getByLabelText("Keyword"), { target: { value: "error" } });
    await selectInputOption(user, within(dialog).getByLabelText("Depth"), 5);
    await user.click(within(dialog).getByLabelText("Recursive"));
    await user.click(within(dialog).getByLabelText("Include hidden"));

    expect(props.onKeywordChange).toHaveBeenLastCalledWith("error");
    expect(props.onMaxDepthChange).toHaveBeenCalledWith(5);
    expect(props.onRecursiveChange).toHaveBeenCalledWith(false);
    expect(props.onIncludeHiddenChange).toHaveBeenCalledWith(true);
  });

  it("forwards refresh and only enables cancel for active tasks", async () => {
    const user = userEvent.setup();
    const inactiveProps = renderDialog({ task });
    const inactiveDialog = screen.getByRole("dialog", { name: "Remote search" });

    await user.click(within(inactiveDialog).getByRole("button", { name: "Refresh results" }));
    expect(inactiveProps.onRefresh).toHaveBeenCalledTimes(1);
    expect(within(inactiveDialog).getByRole("button", { name: "Cancel search" })).toBeDisabled();

    cleanup();
    const activeProps = renderDialog({ isActive: true, state: "running", task: { ...task, status: "running" } });
    const activeDialog = screen.getByRole("dialog", { name: "Remote search" });
    await user.click(within(activeDialog).getByRole("button", { name: "Cancel search" }));

    expect(activeProps.onCancel).toHaveBeenCalledTimes(1);
    expect(within(activeDialog).getByRole("button", { name: "Searching" })).toBeDisabled();
  });

  it("renders results and forwards result opening", async () => {
    const user = userEvent.setup();
    const props = renderDialog({ results: [result], task, total: 1 });

    const dialog = screen.getByRole("dialog", { name: "Remote search" });
    expect(within(dialog).getByText("completed · scanned 18 · matched 2")).toBeInTheDocument();
    expect(within(dialog).getByText("3 dirs")).toBeInTheDocument();
    expect(within(dialog).getByText("18 entries")).toBeInTheDocument();
    expect(within(dialog).getByText("2 matches")).toBeInTheDocument();
    expect(within(dialog).getByText("1 skipped")).toBeInTheDocument();
    expect(within(dialog).getByText("File").closest(".ui-badge")).toHaveClass("ui-badge-info");
    expect(within(dialog).getByText("File").closest(".file-kind")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /nginx\.conf/ }));

    expect(props.onOpenResult).toHaveBeenCalledWith(result);
  });

  it("renders empty, partial note, and forwards pagination changes", async () => {
    const user = userEvent.setup();
    renderDialog({ results: [], task, total: 0 });
    expect(screen.getByText("No remote search results.").closest(".ui-empty-state")).toBeInTheDocument();
    cleanup();

    const props = renderDialog({
      isActive: true,
      page: 2,
      pageSize: 50,
      results: [],
      task: { ...task, status: "running" },
      total: 70,
      totalPages: 4
    });

    const dialog = screen.getByRole("dialog", { name: "Remote search" });
    expect(within(dialog).getByText("Search is still running. Showing partial results written so far.").closest(".ui-inline-note")).toHaveClass("ui-inline-note-info");
    expect(within(dialog).queryByText("No remote search results.")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Page 2 / 4, 70 results total.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await selectInputOption(user, within(dialog).getByLabelText("Per page"), 100);

    expect(props.onPageChange).toHaveBeenCalledWith(3);
    expect(props.onPageSizeChange).toHaveBeenCalledWith(100);
  });
});
