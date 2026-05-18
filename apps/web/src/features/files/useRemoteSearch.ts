import { useEffect, useMemo, useRef, useState } from "react";

import type { FileSearchResult, FileSearchResultListResponse, FileSearchTask, FileSearchTaskResponse } from "./types";

type RemoteSearchState = "idle" | "running" | "ready" | "error";

type CreateRemoteSearchTaskInput = {
  host_id: string;
  base_path: string;
  keyword: string;
  match_mode: "name" | "path";
  recursive: boolean;
  include_hidden: boolean;
  max_depth: number;
  max_results: number;
  max_scanned_entries: number;
  timeout_seconds: number;
};

type UseRemoteSearchOptions = {
  activeHostId: string;
  currentPath: string;
  createTaskRequest: (input: CreateRemoteSearchTaskInput) => Promise<FileSearchTaskResponse>;
  getTaskRequest: (taskId: string) => Promise<FileSearchTaskResponse>;
  listResultsRequest: (input: { task_id: string; page: number; page_size: number }) => Promise<FileSearchResultListResponse>;
  cancelTaskRequest: (taskId: string) => Promise<FileSearchTaskResponse>;
  onSelectHostRequired: () => void;
  onKeywordRequired: () => void;
  onSearchStarted: () => void;
  onTaskError: (message: string) => void;
  onRefreshError: (error: unknown) => void;
  onSearchError: (error: unknown) => void;
  onCancelSuccess: () => void;
  onCancelError: (error: unknown) => void;
  pollingEnabled?: boolean;
};

export function useRemoteSearch({
  activeHostId,
  cancelTaskRequest,
  createTaskRequest,
  currentPath,
  getTaskRequest,
  listResultsRequest,
  onCancelError,
  onCancelSuccess,
  onKeywordRequired,
  onRefreshError,
  onSearchError,
  onSearchStarted,
  onSelectHostRequired,
  onTaskError,
  pollingEnabled = true
}: UseRemoteSearchOptions) {
  const taskErrorMessageRef = useRef<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [maxDepth, setMaxDepth] = useState(6);
  const [recursive, setRecursive] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [state, setState] = useState<RemoteSearchState>("idle");
  const [task, setTask] = useState<FileSearchTask | null>(null);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);
  const isActive = task?.status === "pending" || task?.status === "running";

  const resetMessages = () => {
    taskErrorMessageRef.current = null;
  };

  const resetTaskState = () => {
    setTask(null);
    setResults([]);
    setPage(1);
    setTotal(0);
    setState("idle");
    resetMessages();
  };

  const clearContext = () => {
    setKeyword("");
    setOpen(false);
    resetTaskState();
  };

  const refresh = async (
    taskId = task?.id,
    options?: { page?: number; pageSize?: number }
  ) => {
    if (!taskId || !activeHostId) {
      return;
    }
    const nextPage = options?.page ?? page;
    const nextPageSize = options?.pageSize ?? pageSize;

    try {
      const taskResponse = await getTaskRequest(taskId);
      const resultsResponse = await listResultsRequest({
        task_id: taskId,
        page: nextPage,
        page_size: nextPageSize
      });
      setTask(taskResponse.task);
      setResults(resultsResponse.items);
      setPage(resultsResponse.page);
      setPageSize(resultsResponse.page_size);
      setTotal(resultsResponse.total);
      setState(
        taskResponse.task.status === "pending" || taskResponse.task.status === "running" ? "running" : "ready"
      );
      if (taskResponse.task.error_message && taskResponse.task.error_message !== taskErrorMessageRef.current) {
        taskErrorMessageRef.current = taskResponse.task.error_message;
        onTaskError(taskResponse.task.error_message);
      }
      if (!taskResponse.task.error_message) {
        taskErrorMessageRef.current = null;
      }
    } catch (error) {
      setState("error");
      onRefreshError(error);
    }
  };

  const start = async () => {
    if (!activeHostId) {
      onSelectHostRequired();
      return;
    }

    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword.length < 2) {
      onKeywordRequired();
      return;
    }

    resetMessages();
    setState("running");
    setResults([]);
    setPage(1);
    setTotal(0);

    try {
      const response = await createTaskRequest({
        host_id: activeHostId,
        base_path: currentPath,
        keyword: trimmedKeyword,
        match_mode: "path",
        recursive,
        include_hidden: includeHidden,
        max_depth: maxDepth,
        max_results: 500,
        max_scanned_entries: 50000,
        timeout_seconds: 30
      });
      setTask(response.task);
      onSearchStarted();
      await refresh(response.task.id, { page: 1, pageSize });
    } catch (error) {
      setState("error");
      onSearchError(error);
    }
  };

  const cancel = async () => {
    if (!task || !activeHostId) {
      return;
    }

    try {
      const response = await cancelTaskRequest(task.id);
      setTask(response.task);
      setState("ready");
      onCancelSuccess();
      await refresh(response.task.id);
    } catch (error) {
      setState("error");
      onCancelError(error);
    }
  };

  const goToPage = async (targetPage: number) => {
    if (!task) {
      return;
    }
    const nextPage = Math.min(totalPages, Math.max(1, targetPage));
    setPage(nextPage);
    await refresh(task.id, { page: nextPage });
  };

  const changePageSize = async (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
    if (task) {
      await refresh(task.id, { page: 1, pageSize: nextPageSize });
    }
  };

  useEffect(() => {
    if (!task || !isActive || !pollingEnabled) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh(task.id);
    }, 1500);
    return () => window.clearInterval(interval);
    // `refresh` intentionally reads the latest hook state while the polling
    // lifecycle is keyed to the active task and host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHostId, isActive, pollingEnabled, task?.id]);

  return {
    cancel,
    changePageSize,
    clearContext,
    goToPage,
    includeHidden,
    isActive,
    keyword,
    maxDepth,
    open,
    page,
    pageSize,
    recursive,
    refresh,
    resetMessages,
    resetTaskState,
    results,
    setIncludeHidden,
    setKeyword,
    setMaxDepth,
    setOpen,
    setRecursive,
    start,
    state,
    task,
    total,
    totalPages
  };
}
