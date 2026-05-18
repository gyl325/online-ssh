import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Info, Pause, Play, RefreshCw, RotateCcw, X } from "lucide-react";

import { getApiErrorMessage } from "../features/auth/api";
import { listHosts } from "../features/hosts/api";
import type { Host } from "../features/hosts/types";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useToast } from "../features/ui/ToastContext";
import {
  cancelTransferTask,
  listTransferTasks,
  pauseTransferTask,
  resumeTransferTask,
  retryTransferTask
} from "../features/transfers/api";
import {
  canCancelTransfer,
  canPauseTransfer,
  canResumeTransfer,
  canRetryTransfer,
  type TransferTask,
  type TransferTaskResponse,
  type TransferTaskStatus,
  type TransferTaskType,
  isTransferActiveStatus
} from "../features/transfers/types";
import { datetimeLocalToIso, formatDateTime } from "../shared/lib/date";
import { Button, DataTable, DetailDialog, EmptyState, FilterBar, FilterBarGroup, FilterChip, FormField, IconButton, LoadingState, Pagination, SelectInput, Toolbar, Tooltip } from "../shared/ui";
import { createDateRangePickerLabels, DateRangePicker } from "../shared/ui/DateRangePicker";

function formatDecimal(value: number, fractionDigits = 1) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(fractionDigits).replace(/\.0$/, "");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${formatDecimal(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function transferTiming(task: TransferTask, fallback: string) {
  const start = Date.parse(task.started_at || task.created_at);
  const end = Date.parse(task.finished_at || task.updated_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return {
      duration: fallback,
      averageSpeed: fallback
    };
  }

  const seconds = Math.max(1, Math.round((end - start) / 1000));
  return {
    duration: formatDuration(seconds),
    averageSpeed: task.transferred_bytes > 0 ? `${formatBytes(task.transferred_bytes / seconds)}/s` : fallback
  };
}

function transferFailureReason(task: TransferTask, fallback: string) {
  const code = task.error_code?.trim();
  const message = task.error_message?.trim();
  if (code && message) {
    return `${code}: ${message}`;
  }
  return message || code || fallback;
}

function transferStatusLabel(status: TransferTaskStatus, t: (key: string) => string) {
  switch (status) {
    case "pending":
      return t("transfer.status.pending");
    case "uploading_to_platform":
      return t("transfer.status.uploading_to_platform");
    case "queued_for_remote_transfer":
      return t("transfer.status.queued_for_remote_transfer");
    case "transferring":
      return t("transfer.status.transferring");
    case "paused":
      return t("transfer.status.paused");
    case "failed":
      return t("transfer.status.failed");
    case "completed":
      return t("transfer.status.completed");
    case "canceled":
      return t("transfer.status.canceled");
    default:
      return status;
  }
}

function progressPercent(task: TransferTask) {
  if (task.total_bytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((task.transferred_bytes / task.total_bytes) * 100));
}

function directionLabel(task: TransferTask, t: (key: string) => string) {
  return task.task_type === "upload" ? t("transfer.direction.upload") : t("transfer.direction.download");
}

const transferStatusOptions: TransferTaskStatus[] = [
  "pending",
  "uploading_to_platform",
  "queued_for_remote_transfer",
  "transferring",
  "paused",
  "failed",
  "completed",
  "canceled"
];

type TransfersPageProps = {
  hostCatalog?: {
    hosts: Host[];
  };
  visible?: boolean;
};

export function TransfersPage({ hostCatalog, visible = true }: TransfersPageProps = {}) {
  const { language, t } = usePreferences();
  const toast = useToast();
  const [localHosts, setLocalHosts] = useState<Host[]>([]);
  const [tasks, setTasks] = useState<TransferTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [taskTypeFilter, setTaskTypeFilter] = useState<TransferTaskType | "">("");
  const [statusFilter, setStatusFilter] = useState<TransferTaskStatus | "">("");
  const [createdFromInput, setCreatedFromInput] = useState("");
  const [createdToInput, setCreatedToInput] = useState("");
  const [detailTask, setDetailTask] = useState<TransferTask | null>(null);
  const [controlTaskId, setControlTaskId] = useState<string | null>(null);
  const tasksRequestId = useRef(0);
  const hosts = hostCatalog?.hosts ?? localHosts;

  const hostMap = useMemo(() => {
    const items = new Map<string, Host>();
    hosts.forEach((host) => items.set(host.id, host));
    return items;
  }, [hosts]);
  const detailTiming = detailTask ? transferTiming(detailTask, t("common.notRecorded")) : null;
  const failedTaskSummaries = useMemo(() => {
    const groups = new Map<string, { count: number }>();
    tasks
      .filter((task) => task.status === "failed")
      .forEach((task) => {
        const reason = transferFailureReason(task, t("transfer.errorUnknown"));
        const current = groups.get(reason) || { count: 0 };
        current.count += 1;
        groups.set(reason, current);
      });

    return Array.from(groups.entries()).map(([reason, summary]) => ({
      reason,
      ...summary
    }));
  }, [tasks, t]);
  const historySummary = useMemo(() => {
    const activeCount = tasks.filter((task) => isTransferActiveStatus(task.status)).length;
    const failedCount = tasks.filter((task) => task.status === "failed").length;
    const completedCount = tasks.filter((task) => task.status === "completed").length;
    const uploadCount = tasks.filter((task) => task.task_type === "upload").length;
    const downloadCount = tasks.filter((task) => task.task_type === "download").length;
    const totalBytes = tasks.reduce((sum, task) => sum + task.total_bytes, 0);
    const transferredBytes = tasks.reduce((sum, task) => sum + task.transferred_bytes, 0);

    return {
      activeCount,
      completedCount,
      downloadCount,
      failedCount,
      totalBytes,
      transferredBytes,
      uploadCount
    };
  }, [tasks]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadTasks = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = tasksRequestId.current + 1;
    tasksRequestId.current = requestId;
    if (!options?.silent) {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const query: {
        page: number;
        page_size: number;
        task_type: TransferTaskType | "";
        status: TransferTaskStatus | "";
        created_from?: string;
        created_to?: string;
      } = {
        page,
        page_size: pageSize,
        task_type: taskTypeFilter,
        status: statusFilter
      };
      const createdFrom = datetimeLocalToIso(createdFromInput);
      const createdTo = datetimeLocalToIso(createdToInput);
      if (createdFrom) {
        query.created_from = createdFrom;
      }
      if (createdTo) {
        query.created_to = createdTo;
      }
      const response = await listTransferTasks(query);
      if (requestId !== tasksRequestId.current) {
        return;
      }
      setTasks(response.items);
      setTotal(response.total);
    } catch (error) {
      if (requestId !== tasksRequestId.current) {
        return;
      }
      const message = getApiErrorMessage(error, t("transfer.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      if (requestId === tasksRequestId.current) {
        setLoading(false);
      }
    }
  }, [createdFromInput, createdToInput, page, pageSize, statusFilter, t, taskTypeFilter]);

  const updateTaskInView = useCallback((updatedTask: TransferTask) => {
    setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
    setDetailTask((current) => (current?.id === updatedTask.id ? updatedTask : current));
  }, []);

  const runControlAction = useCallback(async (
    task: TransferTask,
    request: (taskId: string) => Promise<TransferTaskResponse>
  ) => {
    setControlTaskId(task.id);
    setErrorMessage(null);
    try {
      const response = await request(task.id);
      updateTaskInView(response.task);
      await loadTasks({ silent: true });
    } catch (error) {
      const message = getApiErrorMessage(error, t("transfer.actionFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setControlTaskId((current) => (current === task.id ? null : current));
    }
  }, [loadTasks, t, updateTaskInView]);

  useEffect(() => {
    if (hostCatalog) {
      return;
    }

    const loadHosts = async () => {
      try {
        const response = await listHosts();
        setLocalHosts(response.items);
      } catch (error) {
        const message = getApiErrorMessage(error, t("host.loadFailed"), t);
        setErrorMessage(message);
        toast.error(message);
      }
    };

    void loadHosts();
  }, [hostCatalog, t, toast]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    void loadTasks();
  }, [loadTasks, visible]);

  const transferColumns = useMemo<Array<ColumnDef<TransferTask>>>(() => [
    {
      id: "file",
      header: t("transfer.fileName"),
      cell: ({ row }) => {
        const task = row.original;
        const failureReason = task.status === "failed"
          ? transferFailureReason(task, t("transfer.errorUnknown"))
          : "";
        const fileName = (
          <strong
            className={failureReason ? "transfer-file-name transfer-file-name-has-error" : "transfer-file-name"}
            tabIndex={failureReason ? 0 : undefined}
            title={failureReason || undefined}
          >
            {task.file_name}
          </strong>
        );
        return (
          <div className="transfer-file-cell">
            {failureReason ? <Tooltip content={failureReason}>{fileName}</Tooltip> : fileName}
          </div>
        );
      }
    },
    {
      id: "status",
      header: t("transfer.status"),
      cell: ({ row }) => {
        const task = row.original;
        return (
          <span className={`terminal-status terminal-status-${task.status === "completed" ? "connected" : task.status === "failed" ? "failed" : task.status === "paused" ? "disconnected" : "connecting"}`}>
            {transferStatusLabel(task.status, t)}
          </span>
        );
      }
    },
    {
      id: "direction",
      header: t("transfer.direction"),
      cell: ({ row }) => directionLabel(row.original, t)
    },
    {
      id: "host",
      header: t("transfer.host"),
      cell: ({ row }) => {
        const task = row.original;
        const hostId = task.task_type === "upload" ? task.target_host_id : task.source_host_id;
        const host = hostId ? hostMap.get(hostId) : null;
        return host ? host.name : t("transfer.unresolvedHost");
      }
    },
    {
      id: "progress",
      header: t("transfer.progress"),
      cell: ({ row }) => {
        const task = row.original;
        return (
          <div className="transfer-progress-cell">
            <span>{formatBytes(task.transferred_bytes)} / {formatBytes(task.total_bytes)}</span>
            <div className="transfer-progress" aria-hidden="true">
              <div className="transfer-progress-bar" style={{ width: `${progressPercent(task)}%` }} />
            </div>
          </div>
        );
      }
    },
    {
      id: "speed",
      header: t("transfer.speed"),
      cell: ({ row }) => transferTiming(row.original, t("common.notRecorded")).averageSpeed
    },
    {
      id: "duration",
      header: t("transfer.duration"),
      cell: ({ row }) => transferTiming(row.original, t("common.notRecorded")).duration
    },
    {
      id: "actions",
      header: t("transfer.actions"),
      cell: ({ row }) => {
        const task = row.original;
        const hasActions =
          canPauseTransfer(task) ||
          canResumeTransfer(task) ||
          canRetryTransfer(task) ||
          canCancelTransfer(task);
        return (
          <span className="transfer-actions">
            {canPauseTransfer(task) ? (
              <IconButton
                className="ui-action-icon"
                disabled={controlTaskId === task.id}
                label={t("transfer.pause")}
                onClick={() => void runControlAction(task, pauseTransferTask)}
              >
                <Pause aria-hidden="true" />
              </IconButton>
            ) : null}
            {canResumeTransfer(task) ? (
              <IconButton
                className="ui-action-icon"
                disabled={controlTaskId === task.id}
                label={t("transfer.resume")}
                onClick={() => void runControlAction(task, resumeTransferTask)}
              >
                <Play aria-hidden="true" />
              </IconButton>
            ) : null}
            {canRetryTransfer(task) ? (
              <IconButton
                className="ui-action-icon"
                disabled={controlTaskId === task.id}
                label={t("transfer.retry")}
                onClick={() => void runControlAction(task, retryTransferTask)}
              >
                <RotateCcw aria-hidden="true" />
              </IconButton>
            ) : null}
            {canCancelTransfer(task) ? (
              <IconButton
                className="ui-action-icon ui-action-icon-danger"
                disabled={controlTaskId === task.id}
                label={t("transfer.cancel")}
                onClick={() => void runControlAction(task, cancelTransferTask)}
                variant="danger"
              >
                <X aria-hidden="true" />
              </IconButton>
            ) : null}
            {!hasActions ? <span className="transfer-actions-empty">{t("common.notRecorded")}</span> : null}
          </span>
        );
      }
    },
    {
      id: "details",
      header: t("common.details"),
      cell: ({ row }) => (
        <IconButton className="ui-action-icon" label={t("common.viewDetails")} onClick={() => setDetailTask(row.original)}>
          <Info aria-hidden="true" />
        </IconButton>
      )
    }
  ], [controlTaskId, hostMap, runControlAction, t]);

  return (
    <div className="route-page transfers-page">
      <p className="eyebrow route-eyebrow">Transfer Center</p>

      <section className="content-card transfer-main transfer-main-single">
        <div className="section-header">
          <div>
            <h4>{t("transfer.title")}</h4>
            <p>{t("pagination.summary", { page, totalPages, total })}</p>
          </div>
          <Toolbar>
            <IconButton label={t("transfer.refresh")} onClick={() => void loadTasks()}>
              <RefreshCw aria-hidden="true" />
            </IconButton>
            <IconButton
              className="ui-action-icon"
              label={t("common.clearFilters")}
              onClick={() => {
                const shouldReload = taskTypeFilter === "" && statusFilter === "" && createdFromInput === "" && createdToInput === "" && page === 1;
                setTaskTypeFilter("");
                setStatusFilter("");
                setCreatedFromInput("");
                setCreatedToInput("");
                setPage(1);
                if (shouldReload) {
                  void loadTasks();
                }
              }}
            >
              <X aria-hidden="true" />
            </IconButton>
          </Toolbar>
        </div>

        <FilterBar>
          <FormField label={t("transfer.direction")}>
            {(id) => (
              <SelectInput
                id={id}
                onChange={(event) => {
                  setTaskTypeFilter(event.target.value as TransferTaskType | "");
                  setPage(1);
                }}
                value={taskTypeFilter}
              >
                <option value="">{t("common.all")}</option>
                <option value="upload">{t("transfer.upload")}</option>
                <option value="download">{t("transfer.download")}</option>
              </SelectInput>
            )}
          </FormField>

          <FormField label={t("transfer.status")}>
            {(id) => (
              <SelectInput
                id={id}
                onChange={(event) => {
                  setStatusFilter(event.target.value as TransferTaskStatus | "");
                  setPage(1);
                }}
                value={statusFilter}
              >
                <option value="">{t("common.all")}</option>
                {transferStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {transferStatusLabel(status, t)}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>

          <DateRangePicker
            labels={createDateRangePickerLabels(t)}
            locale={language}
            onChange={(nextValue) => {
              setCreatedFromInput(nextValue.start);
              setCreatedToInput(nextValue.end);
              setPage(1);
            }}
            value={{ start: createdFromInput, end: createdToInput }}
          />

          <FilterBarGroup aria-label={t("transfer.statusPresets")}>
            {[
              { label: t("transfer.presetAll"), value: "" },
              { label: t("transfer.presetFailed"), value: "failed" },
              { label: t("transfer.presetCompleted"), value: "completed" },
              { label: t("transfer.presetCanceled"), value: "canceled" }
            ].map((preset) => (
              <FilterChip
                active={statusFilter === preset.value}
                key={preset.label}
                onClick={() => {
                  setStatusFilter(preset.value as TransferTaskStatus | "");
                  setPage(1);
                }}
              >
                {preset.label}
              </FilterChip>
            ))}
          </FilterBarGroup>
        </FilterBar>

        <section className="transfer-history-summary" aria-label={t("transfer.historySummaryTitle")}>
          <article className="transfer-history-card">
            <span>{t("transfer.historyTotal")}</span>
            <strong>{total}</strong>
            <p>{t("transfer.historyTotalCopy", { count: tasks.length })}</p>
          </article>
          <article className="transfer-history-card">
            <span>{t("transfer.historyActive")}</span>
            <strong>{historySummary.activeCount}</strong>
            <p>{t("transfer.historyActiveCopy", { failed: historySummary.failedCount })}</p>
          </article>
          <article className="transfer-history-card">
            <span>{t("transfer.historyCompleted")}</span>
            <strong>{historySummary.completedCount}</strong>
            <p>{t("transfer.historyDirectionCopy", { uploads: historySummary.uploadCount, downloads: historySummary.downloadCount })}</p>
          </article>
          <article className="transfer-history-card">
            <span>{t("transfer.historyVolume")}</span>
            <strong>{formatBytes(historySummary.transferredBytes)}</strong>
            <p>{t("transfer.historyVolumeCopy", { total: formatBytes(historySummary.totalBytes) })}</p>
          </article>
        </section>

        {failedTaskSummaries.length > 0 ? (
          <section className="transfer-failure-summary" aria-label={t("transfer.failureSummaryTitle")}>
            <div className="transfer-failure-summary-top">
              <div>
                <strong>{t("transfer.failureSummaryTitle")}</strong>
                <p>{t("transfer.failureSummaryCopy", { count: failedTaskSummaries.reduce((sum, item) => sum + item.count, 0) })}</p>
              </div>
              {statusFilter !== "failed" ? (
                <Button
                  onClick={() => {
                    setStatusFilter("failed");
                    setPage(1);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {t("transfer.viewFailedOnly")}
                </Button>
              ) : null}
            </div>
            <div className="transfer-failure-reasons">
              {failedTaskSummaries.map((summary) => (
                <div className="transfer-failure-reason" key={summary.reason}>
                  <span>{t("transfer.failureReasonCount", { count: summary.count })}</span>
                  <strong>{summary.reason}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className={loading ? "resource-card-area resource-card-area-loading" : "resource-card-area"}>
          {loading ? (
            <div className="loading-overlay">
              <LoadingState label={t("transfer.loading")} />
            </div>
          ) : null}

          <DataTable
            className="transfer-data-table"
            columns={transferColumns}
            columnsTemplate="minmax(168px, 0.9fr) 124px minmax(128px, 0.78fr) minmax(96px, 0.48fr) minmax(226px, 1.22fr) 104px 74px 104px 64px"
            data={tasks}
            emptyState={<EmptyState description={t("transfer.empty2")} title={t("transfer.empty1")} />}
            getRowClassName={() => "transfer-item transfer-item-static"}
            getRowId={(task) => task.id}
          />
        </div>

        <Pagination
          firstLabel={t("pagination.first")}
          jumpLabel={t("pagination.jump")}
          label={t("transfer.title")}
          lastLabel={t("pagination.last")}
          nextLabel={t("pagination.next")}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
          page={page}
          pageInputLabel={t("pagination.jump")}
          pageSize={pageSize}
          pageSizeLabel={t("pagination.pageSize")}
          pageSizeOptions={[5, 10, 15]}
          previousLabel={t("pagination.previous")}
          totalPages={totalPages}
        />
      </section>

      {detailTask ? (
        <DetailDialog
          closeLabel={t("common.close")}
          items={[
            { label: t("transfer.fileName"), value: detailTask.file_name },
            { label: t("transfer.direction"), value: directionLabel(detailTask, t) },
            { label: t("transfer.status"), value: transferStatusLabel(detailTask.status, t) },
            {
              label: t("transfer.progress"),
              value: `${progressPercent(detailTask)}% (${formatBytes(detailTask.transferred_bytes)} / ${formatBytes(detailTask.total_bytes)})`
            },
            { label: t("transfer.speed"), value: detailTiming?.averageSpeed || t("common.notRecorded") },
            { label: t("transfer.duration"), value: detailTiming?.duration || t("common.notRecorded") },
            {
              label: t("transfer.sourcePath"),
              value: detailTask.source_path || t("common.notRecorded"),
              valueClassName: "mono-wrap"
            },
            {
              label: t("transfer.targetPath"),
              value: detailTask.target_path || t("common.notRecorded"),
              valueClassName: "mono-wrap"
            },
            { label: t("transfer.error"), value: transferFailureReason(detailTask, t("common.notRecorded")) },
            {
              label: t("transfer.updatedAt"),
              value: formatDateTime(detailTask.updated_at, language, t("common.notRecorded"))
            }
          ]}
          onOpenChange={(open) => {
            if (!open) {
              setDetailTask(null);
            }
          }}
          open
          size="lg"
          title={t("transfer.detailTitle")}
        />
      ) : null}
    </div>
  );
}
