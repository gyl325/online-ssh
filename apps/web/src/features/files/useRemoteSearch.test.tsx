import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileSearchResult, FileSearchTask } from "./types";
import { useRemoteSearch } from "./useRemoteSearch";

const completedTask: FileSearchTask = {
  id: "search-task-1",
  host_id: "host-1",
  base_path: "/root",
  keyword: "log",
  match_mode: "path",
  recursive: true,
  include_hidden: false,
  max_depth: 2,
  max_results: 500,
  max_scanned_entries: 50000,
  timeout_seconds: 30,
  status: "completed",
  scanned_dirs: 2,
  scanned_entries: 12,
  matched_entries: 1,
  skipped_errors_count: 0,
  limit_reached: false,
  error_code: null,
  error_message: null,
  warnings_json: [],
  started_at: "2026-04-24T12:00:00Z",
  finished_at: "2026-04-24T12:00:01Z",
  expires_at: "2026-04-25T12:00:00Z",
  created_at: "2026-04-24T12:00:00Z",
  updated_at: "2026-04-24T12:00:01Z"
};

const runningTask: FileSearchTask = {
  ...completedTask,
  status: "running",
  finished_at: null,
  updated_at: "2026-04-24T12:00:00Z"
};

const remoteResult: FileSearchResult = {
  id: "result-1",
  task_id: "search-task-1",
  rank: 1,
  name: "app.log",
  path: "/root/logs/app.log",
  entry_type: "file",
  size_bytes: 20,
  permissions: "0644",
  owner: "root",
  group: "root",
  modified_at: "2026-04-24T12:00:00Z",
  is_hidden: false,
  created_at: "2026-04-24T12:00:01Z"
};

function setupRemoteSearch(options?: { activeHostId?: string; pollingEnabled?: boolean; task?: FileSearchTask }) {
  const task = options?.task ?? completedTask;
  const createTaskRequest = vi.fn().mockResolvedValue({ task });
  const getTaskRequest = vi.fn().mockResolvedValue({ task });
  const listResultsRequest = vi.fn().mockResolvedValue({
    items: [remoteResult],
    page: 1,
    page_size: 50,
    total: 70
  });
  const cancelTaskRequest = vi.fn().mockResolvedValue({ task: { ...completedTask, status: "canceled" } });
  const notifications = {
    onCancelError: vi.fn(),
    onCancelSuccess: vi.fn(),
    onKeywordRequired: vi.fn(),
    onRefreshError: vi.fn(),
    onSearchError: vi.fn(),
    onSearchStarted: vi.fn(),
    onSelectHostRequired: vi.fn(),
    onTaskError: vi.fn()
  };

  const hook = renderHook(() =>
    useRemoteSearch({
      activeHostId: options?.activeHostId ?? "host-1",
      cancelTaskRequest,
      createTaskRequest,
      currentPath: "/root",
      getTaskRequest,
      listResultsRequest,
      pollingEnabled: options?.pollingEnabled,
      ...notifications
    })
  );

  return {
    cancelTaskRequest,
    createTaskRequest,
    getTaskRequest,
    hook,
    listResultsRequest,
    notifications
  };
}

describe("useRemoteSearch", () => {
  it("starts a remote search task and refreshes the first result page", async () => {
    const { createTaskRequest, getTaskRequest, hook, listResultsRequest, notifications } = setupRemoteSearch();

    await act(async () => {
      hook.result.current.setKeyword(" log ");
      hook.result.current.setMaxDepth(2);
    });

    await act(async () => {
      await hook.result.current.start();
    });

    expect(createTaskRequest).toHaveBeenCalledWith({
      host_id: "host-1",
      base_path: "/root",
      keyword: "log",
      match_mode: "path",
      recursive: true,
      include_hidden: false,
      max_depth: 2,
      max_results: 500,
      max_scanned_entries: 50000,
      timeout_seconds: 30
    });
    expect(notifications.onSearchStarted).toHaveBeenCalledTimes(1);
    expect(getTaskRequest).toHaveBeenCalledWith("search-task-1");
    expect(listResultsRequest).toHaveBeenCalledWith({
      task_id: "search-task-1",
      page: 1,
      page_size: 50
    });
    expect(hook.result.current.results).toEqual([remoteResult]);
    expect(hook.result.current.state).toBe("ready");
    expect(hook.result.current.totalPages).toBe(2);
  });

  it("refreshes a clamped page when paging through existing task results", async () => {
    const { hook, listResultsRequest } = setupRemoteSearch();

    await act(async () => {
      hook.result.current.setKeyword("log");
    });
    await act(async () => {
      await hook.result.current.start();
    });

    await act(async () => {
      await hook.result.current.goToPage(99);
    });

    expect(listResultsRequest).toHaveBeenLastCalledWith({
      task_id: "search-task-1",
      page: 2,
      page_size: 50
    });
    expect(hook.result.current.page).toBe(1);
  });

  it("warns instead of creating a search task without an active host", async () => {
    const { createTaskRequest, hook, notifications } = setupRemoteSearch({ activeHostId: "" });

    await act(async () => {
      hook.result.current.setKeyword("log");
      await hook.result.current.start();
    });

    expect(createTaskRequest).not.toHaveBeenCalled();
    expect(notifications.onSelectHostRequired).toHaveBeenCalledTimes(1);
  });

  it("does not schedule polling while polling is disabled", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(() => 123);
    const { hook } = setupRemoteSearch({ pollingEnabled: false, task: runningTask });

    try {
      await act(async () => {
        hook.result.current.setKeyword("log");
      });
      await act(async () => {
        await hook.result.current.start();
      });

      expect(hook.result.current.isActive).toBe(true);
      expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 1500);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
