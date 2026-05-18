import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Download, Info, RefreshCw, Trash2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { getApiErrorMessage } from "../features/auth/api";
import { getAuditLog, listAuditLogs } from "../features/audit/api";
import type { AuditLog, AuditResult } from "../features/audit/types";
import { cancelAuditExport, createAuditExport, deleteAuditExport, downloadAuditExport, listAuditExports } from "../features/auditExports/api";
import type { AuditExportTask, AuditExportTaskStatus, CreateAuditExportInput } from "../features/auditExports/types";
import { listHosts } from "../features/hosts/api";
import type { Host } from "../features/hosts/types";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useToast } from "../features/ui/ToastContext";
import { datetimeLocalToIso, formatDateTime } from "../shared/lib/date";
import { saveBlobAsFile } from "../shared/lib/download";
import { Button, DataTable, DetailDialog, Dialog, EmptyState, FilterBar, FilterChip, FormField, IconButton, LoadingState, Pagination, SelectInput, TextInput, Toolbar } from "../shared/ui";
import { createDateRangePickerLabels, DateRangePicker } from "../shared/ui/DateRangePicker";

function auditResultLabel(result: AuditResult, t: (key: string) => string) {
  return result === "success" ? t("audit.result.success") : t("audit.result.failure");
}

function auditResultClass(result: AuditResult) {
  return result === "success" ? "terminal-status-connected" : "terminal-status-failed";
}

const auditEventLabelKeys: Record<string, string> = {
  auth_login: "audit.eventType.authLogin",
  auth_login_failed: "audit.eventType.authLoginFailed",
  auth_logout: "audit.eventType.authLogout",
  auth_email_code_send: "audit.eventType.authEmailCodeSend",
  auth_email_code_verify_failed: "audit.eventType.authEmailCodeVerifyFailed",
  admin_user_disabled: "audit.eventType.adminUserDisabled",
  admin_user_enabled: "audit.eventType.adminUserEnabled",
  admin_user_kicked: "audit.eventType.adminUserKicked",
  admin_user_role_changed: "audit.eventType.adminUserRoleChanged",
  file_list: "audit.eventType.fileList",
  file_read: "audit.eventType.fileRead",
  file_write: "audit.eventType.fileWrite",
  file_upload_start: "audit.eventType.fileUploadStart",
  file_upload_success: "audit.eventType.fileUploadSuccess",
  file_download_start: "audit.eventType.fileDownloadStart",
  file_download_success: "audit.eventType.fileDownloadSuccess",
  transfer_task_failed: "audit.eventType.transferFailed",
  transfer_task_retry: "audit.eventType.transferRetry",
  terminal_session_create: "audit.eventType.terminalCreate",
  terminal_session_failed: "audit.eventType.terminalFailed",
  host_test_success: "audit.eventType.hostTestSuccess",
  host_test_failure: "audit.eventType.hostTestFailure"
};

const auditEventPresets = [
  { value: "", labelKey: "audit.presetAllEvents" },
  { value: "auth_login", labelKey: "audit.preset.login" },
  { value: "file_upload_start", labelKey: "audit.preset.fileUpload" },
  { value: "file_download_start", labelKey: "audit.preset.fileDownload" },
  { value: "transfer_task_failed", labelKey: "audit.preset.transferFailed" },
  { value: "terminal_session_create", labelKey: "audit.preset.terminalCreate" },
  { value: "host_test_failure", labelKey: "audit.preset.hostFailure" }
];

function eventTypeLabel(eventType: string, t: (key: string) => string) {
  const labelKey = auditEventLabelKeys[eventType];
  if (labelKey) {
    return t(labelKey);
  }

  const compact = eventType.replaceAll("_", " ");
  if (eventType.startsWith("file_")) {
    return `${t("audit.event.file")} / ${compact}`;
  }
  if (eventType.startsWith("transfer_")) {
    return `${t("audit.event.transfer")} / ${compact}`;
  }
  if (eventType.startsWith("terminal_")) {
    return `${t("audit.event.terminal")} / ${compact}`;
  }
  if (eventType.startsWith("host_")) {
    return `${t("audit.event.host")} / ${compact}`;
  }
  if (eventType.startsWith("auth_")) {
    return `${t("audit.event.auth")} / ${compact}`;
  }
  return compact;
}

function stringifyMetadataValue(value: unknown) {
  if (value === null || value === undefined) {
    return "--";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function auditExportStatusLabel(status: AuditExportTaskStatus, t: (key: string) => string) {
  return t(`audit.export.status.${status}`);
}

function auditExportStatusClass(status: AuditExportTaskStatus) {
  if (status === "completed") {
    return "terminal-status-connected";
  }
  if (status === "failed" || status === "canceled") {
    return "terminal-status-failed";
  }
  return "terminal-status-connecting";
}

function isAuditExportActive(status: AuditExportTaskStatus) {
  return status === "pending" || status === "running";
}

function compactCreateAuditExportInput(input: {
  event_type: string;
  target_host_id: string;
  result: AuditResult | "";
  start_time: string;
  end_time: string;
}): CreateAuditExportInput {
  return {
    ...(input.event_type ? { event_type: input.event_type } : {}),
    ...(input.target_host_id ? { target_host_id: input.target_host_id } : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(input.start_time ? { start_time: input.start_time } : {}),
    ...(input.end_time ? { end_time: input.end_time } : {})
  };
}

function auditExportFileName(task: AuditExportTask) {
  return `audit-export-${task.id}.csv`;
}

type AuditPageProps = {
  hostCatalog?: {
    hosts: Host[];
  };
  visible?: boolean;
};

export function AuditPage({ hostCatalog, visible = true }: AuditPageProps = {}) {
  const { language, t } = usePreferences();
  const toast = useToast();
  const navigate = useNavigate();
  const { logId: routeLogId } = useParams();
  const [localHosts, setLocalHosts] = useState<Host[]>([]);
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportTasks, setExportTasks] = useState<AuditExportTask[]>([]);
  const [exportTasksLoading, setExportTasksLoading] = useState(false);
  const [exportTaskError, setExportTaskError] = useState<string | null>(null);
  const [creatingExport, setCreatingExport] = useState(false);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);
  const [cancelingExportId, setCancelingExportId] = useState<string | null>(null);
  const [deletingExportId, setDeletingExportId] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<AuditResult | "">("");
  const [hostFilter, setHostFilter] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const exportRequestId = useRef(0);
  const hosts = hostCatalog?.hosts ?? localHosts;

  const hostMap = useMemo(() => {
    const result = new Map<string, Host>();
    hosts.forEach((host) => result.set(host.id, host));
    return result;
  }, [hosts]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadList = useCallback(async () => {
    const requestId = listRequestId.current + 1;
    listRequestId.current = requestId;
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await listAuditLogs({
        page,
        page_size: pageSize,
        event_type: eventTypeFilter.trim(),
        target_host_id: hostFilter,
        result: resultFilter,
        start_time: datetimeLocalToIso(startTime),
        end_time: datetimeLocalToIso(endTime)
      });
      if (requestId !== listRequestId.current) {
        return;
      }
      setItems(response.items);
      setTotal(response.total);
    } catch (error) {
      if (requestId !== listRequestId.current) {
        return;
      }
      const message = getApiErrorMessage(error, t("audit.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      if (requestId === listRequestId.current) {
        setLoading(false);
      }
    }
  }, [endTime, eventTypeFilter, hostFilter, page, pageSize, resultFilter, startTime, t]);

  const currentFilterParams = useCallback(() => ({
    event_type: eventTypeFilter.trim(),
    target_host_id: hostFilter,
    result: resultFilter,
      start_time: datetimeLocalToIso(startTime),
      end_time: datetimeLocalToIso(endTime)
  }), [endTime, eventTypeFilter, hostFilter, resultFilter, startTime]);

  const loadExportTasks = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = exportRequestId.current + 1;
    exportRequestId.current = requestId;
    if (!options?.silent) {
      setExportTasksLoading(true);
      setExportTaskError(null);
    }
    try {
      const response = await listAuditExports({ page: 1, page_size: 20 });
      if (requestId !== exportRequestId.current) {
        return;
      }
      setExportTasks(response.items);
    } catch (error) {
      if (requestId !== exportRequestId.current) {
        return;
      }
      if (!options?.silent) {
        const message = getApiErrorMessage(error, t("audit.exportTasksLoadFailed"), t);
        setExportTaskError(message);
        toast.error(message);
      }
    } finally {
      if (requestId === exportRequestId.current && !options?.silent) {
        setExportTasksLoading(false);
      }
    }
  }, [t]);

  const createExportTask = useCallback(async () => {
    setCreatingExport(true);
    setExportTaskError(null);
    try {
      await createAuditExport(compactCreateAuditExportInput(currentFilterParams()));
      toast.success(t("audit.exportCreated"));
      await loadExportTasks();
    } catch (error) {
      const message = getApiErrorMessage(error, t("audit.exportCreateFailed"), t);
      setExportTaskError(message);
      toast.error(message);
    } finally {
      setCreatingExport(false);
    }
  }, [currentFilterParams, loadExportTasks, t]);

  const downloadExportTask = useCallback(async (task: AuditExportTask) => {
    setDownloadingExportId(task.id);
    setExportTaskError(null);
    try {
      const blob = await downloadAuditExport(task.id);
      saveBlobAsFile(blob, auditExportFileName(task));
      toast.success(t("audit.exportDownloaded"));
    } catch (error) {
      const message = getApiErrorMessage(error, t("audit.exportDownloadFailed"), t);
      setExportTaskError(message);
      toast.error(message);
    } finally {
      setDownloadingExportId(null);
    }
  }, [t]);

  const cancelExportTask = useCallback(async (task: AuditExportTask) => {
    if (!isAuditExportActive(task.status)) {
      return;
    }
    setCancelingExportId(task.id);
    setExportTaskError(null);
    try {
      await cancelAuditExport(task.id);
      toast.success(t("audit.exportCanceled"));
      await loadExportTasks();
    } catch (error) {
      const message = getApiErrorMessage(error, t("audit.exportCancelFailed"), t);
      setExportTaskError(message);
      toast.error(message);
    } finally {
      setCancelingExportId(null);
    }
  }, [loadExportTasks, t]);

  const deleteExportTask = useCallback(async (task: AuditExportTask) => {
    setDeletingExportId(task.id);
    setExportTaskError(null);
    try {
      await deleteAuditExport(task.id);
      setExportTasks((current) => current.filter((item) => item.id !== task.id));
      toast.success(t("audit.exportDeleted"));
    } catch (error) {
      const message = getApiErrorMessage(error, t("audit.exportDeleteFailed"), t);
      setExportTaskError(message);
      toast.error(message);
    } finally {
      setDeletingExportId(null);
    }
  }, [t]);

  const openDetail = useCallback((item: AuditLog) => {
    setDetailLog(item);
    setDetailError(null);
    setErrorMessage(null);
    navigate(`/audit/${item.id}`);
  }, [navigate]);

  const closeDetail = useCallback(() => {
    setDetailLog(null);
    setDetailError(null);
    setDetailLoading(false);
    navigate("/audit");
  }, [navigate]);

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
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!exportDialogOpen || !visible) {
      return;
    }

    void loadExportTasks();
  }, [exportDialogOpen, loadExportTasks, visible]);

  useEffect(() => {
    if (!exportDialogOpen || !visible || !exportTasks.some((task) => isAuditExportActive(task.status))) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadExportTasks({ silent: true });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [exportDialogOpen, exportTasks, loadExportTasks, visible]);

  useEffect(() => {
    if (!routeLogId) {
      setDetailLog(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const cached = items.find((item) => item.id === routeLogId);
    if (cached) {
      setDetailLog(cached);
    }

    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;
    setDetailLoading(true);
    setDetailError(null);

    const loadDetail = async () => {
      try {
        const response = await getAuditLog(routeLogId);
        if (requestId !== detailRequestId.current) {
          return;
        }
        setDetailLog(response.log);
      } catch (error) {
        if (requestId !== detailRequestId.current) {
          return;
        }
        const message = getApiErrorMessage(error, t("audit.loadFailed"), t);
        setDetailError(message);
        toast.error(message);
        if (!cached) {
          setDetailLog(null);
        }
      } finally {
        if (requestId === detailRequestId.current) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();
  }, [items, routeLogId, t]);

  const auditColumns = useMemo<Array<ColumnDef<AuditLog>>>(() => [
    {
      id: "event",
      header: t("audit.event"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="audit-event-cell">
            <strong>{eventTypeLabel(item.event_type, t)}</strong>
            {item.message ? <p className="audit-item-message">{item.message}</p> : null}
          </div>
        );
      }
    },
    {
      id: "result",
      header: t("common.result"),
      cell: ({ row }) => (
        <span className={`terminal-status ${auditResultClass(row.original.result)}`}>
          {auditResultLabel(row.original.result, t)}
        </span>
      )
    },
    {
      id: "type",
      header: t("audit.type"),
      cell: ({ row }) => row.original.event_type
    },
    {
      id: "targetHost",
      header: t("audit.targetHost"),
      cell: ({ row }) => {
        const item = row.original;
        const host = item.target_host_id ? hostMap.get(item.target_host_id) : null;
        return host ? host.name : item.target_host_id || t("audit.noTargetHost");
      }
    },
    {
      id: "time",
      header: t("common.time"),
      cell: ({ row }) => formatDateTime(row.original.occurred_at, language, t("common.notRecorded"))
    },
    {
      id: "details",
      header: t("common.details"),
      cell: ({ row }) => (
        <IconButton className="ui-action-icon" label={t("common.viewDetails")} onClick={() => openDetail(row.original)}>
          <Info aria-hidden="true" />
        </IconButton>
      )
    }
  ], [hostMap, language, openDetail, t]);

  return (
    <div className="route-page audit-page">
      <p className="eyebrow route-eyebrow">Audit Viewer</p>

      <section className="content-card audit-filter-panel">
        <div className="section-header">
          <div>
            <h4>{t("audit.filterTitle")}</h4>
          </div>
          <Toolbar>
            <IconButton
              label={t("audit.refresh")}
              onClick={() => void loadList()}
            >
              <RefreshCw aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t("audit.exportCsv")}
              onClick={() => setExportDialogOpen(true)}
            >
              <Download aria-hidden="true" />
            </IconButton>
            <IconButton
              className="ui-action-icon"
              label={t("common.clearFilters")}
              onClick={() => {
                const shouldReload =
                  eventTypeFilter === "" &&
                  resultFilter === "" &&
                  hostFilter === "" &&
                  startTime === "" &&
                  endTime === "" &&
                  page === 1;
                setEventTypeFilter("");
                setResultFilter("");
                setHostFilter("");
                setStartTime("");
                setEndTime("");
                setPage(1);
                if (shouldReload) {
                  void loadList();
                }
              }}
            >
              <X aria-hidden="true" />
            </IconButton>
          </Toolbar>
        </div>

        <FilterBar>
          <FormField label={t("audit.eventType")}>
            {(id) => (
              <TextInput
                id={id}
                onChange={(event) => {
                  setEventTypeFilter(event.target.value);
                  setPage(1);
                }}
                placeholder={t("audit.eventPlaceholder")}
                value={eventTypeFilter}
              />
            )}
          </FormField>

          <FormField label={t("common.result")}>
            {(id) => (
              <SelectInput
                id={id}
                onChange={(event) => {
                  setResultFilter(event.target.value as AuditResult | "");
                  setPage(1);
                }}
                value={resultFilter}
              >
                <option value="">{t("common.all")}</option>
                <option value="success">{auditResultLabel("success", t)}</option>
                <option value="failure">{auditResultLabel("failure", t)}</option>
              </SelectInput>
            )}
          </FormField>

          <FormField label={t("audit.targetHost")}>
            {(id) => (
              <SelectInput
                id={id}
                onChange={(event) => {
                  setHostFilter(event.target.value);
                  setPage(1);
                }}
                value={hostFilter}
              >
                <option value="">{t("audit.allHosts")}</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name} · {host.username}@{host.host}:{host.port}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>

          <DateRangePicker
            labels={createDateRangePickerLabels(t)}
            locale={language}
            onChange={(nextValue) => {
              setStartTime(nextValue.start);
              setEndTime(nextValue.end);
              setPage(1);
            }}
            value={{ start: startTime, end: endTime }}
          />
        </FilterBar>

        <div className="audit-preset-panel">
          <div className="audit-preset-group" aria-label={t("audit.eventPresets")}>
            <span>{t("audit.eventPresets")}</span>
            {auditEventPresets.map((preset) => (
              <FilterChip
                active={eventTypeFilter === preset.value}
                key={preset.value}
                onClick={() => {
                  setEventTypeFilter(preset.value);
                  setPage(1);
                }}
              >
                {t(preset.labelKey)}
              </FilterChip>
            ))}
          </div>
        </div>

      </section>

      <section className="content-card audit-main audit-main-single">
        <div className="section-header">
          <div>
            <h4>{t("audit.listTitle")}</h4>
            <p>{t("pagination.summary", { page, totalPages, total })}</p>
          </div>
        </div>

        <div className={loading ? "resource-card-area resource-card-area-loading" : "resource-card-area"}>
          {loading ? (
            <div className="loading-overlay">
              <LoadingState label={t("audit.loading")} />
            </div>
          ) : null}

          <DataTable
            className="audit-data-table"
            columns={auditColumns}
            columnsTemplate="minmax(210px, 0.95fr) 104px minmax(150px, 0.9fr) minmax(130px, 0.72fr) 230px 66px"
            data={items}
            emptyState={<EmptyState description={t("audit.empty2")} title={t("audit.empty1")} />}
            getRowClassName={() => "audit-item audit-item-static"}
            getRowId={(item) => item.id}
          />
        </div>

        <Pagination
          firstLabel={t("pagination.first")}
          jumpLabel={t("pagination.jump")}
          label={t("audit.listTitle")}
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

      {exportDialogOpen ? (
        <Dialog
          closeLabel={t("common.close")}
          onOpenChange={(open) => {
            if (!open) {
              setExportDialogOpen(false);
            }
          }}
          open
          size="lg"
          title={t("audit.exportTasksTitle")}
        >
          <div className="audit-export-dialog">
            <div className="audit-export-toolbar">
              <div>
                <p className="modal-copy">{t("audit.exportTasksCopy")}</p>
                <p className="audit-export-filter-summary">
                  {t("audit.exportFilterSummary", {
                    event: currentFilterParams().event_type || t("common.all"),
                    result: currentFilterParams().result ? auditResultLabel(currentFilterParams().result as AuditResult, t) : t("common.all"),
                    host: hostFilter ? hostMap.get(hostFilter)?.name || hostFilter : t("audit.allHosts")
                  })}
                </p>
              </div>
              <Toolbar>
                <IconButton disabled={exportTasksLoading} label={t("common.refresh")} onClick={() => void loadExportTasks()}>
                  <RefreshCw aria-hidden="true" />
                </IconButton>
                <Button disabled={creatingExport} onClick={() => void createExportTask()} variant="primary">
                  {creatingExport ? t("audit.exportCreating") : t("audit.exportCreate")}
                </Button>
              </Toolbar>
            </div>

            <div className={exportTasksLoading ? "audit-export-list audit-export-list-loading" : "audit-export-list"}>
              {exportTasksLoading ? (
                <div className="loading-overlay loading-overlay-inline">
                  <LoadingState label={t("audit.exportTasksLoading")} />
                </div>
              ) : null}

              <div className="audit-export-table-header" aria-hidden="true">
                <span>{t("common.status")}</span>
                <span>{t("audit.exportRows")}</span>
                <span>{t("common.time")}</span>
                <span>{t("common.details")}</span>
              </div>

              {exportTasks.map((task) => (
                <article className="audit-export-item" key={task.id}>
                  <div className="audit-export-status">
                    <span className={`terminal-status ${auditExportStatusClass(task.status)}`}>
                      {auditExportStatusLabel(task.status, t)}
                    </span>
                    {task.error_message ? <small>{task.error_message}</small> : null}
                  </div>
                  <div>
                    <strong>{task.exported_rows} / {task.total_rows}</strong>
                    <div className="transfer-progress">
                      <div
                        className="transfer-progress-bar"
                        style={{ width: `${task.total_rows > 0 ? Math.min(100, (task.exported_rows / task.total_rows) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="audit-export-time">
                    <span>{formatDateTime(task.created_at, language, t("common.notRecorded"))}</span>
                    <small>{t("audit.exportExpiresAt", { time: formatDateTime(task.expires_at, language, t("common.notRecorded")) })}</small>
                  </div>
                  <div className="transfer-actions">
                    {task.status === "completed" ? (
                      <IconButton
                        className="ui-action-icon"
                        disabled={downloadingExportId === task.id}
                        label={t("audit.exportDownload")}
                        onClick={() => void downloadExportTask(task)}
                      >
                        <Download aria-hidden="true" />
                      </IconButton>
                    ) : null}
                    {isAuditExportActive(task.status) ? (
                      <IconButton
                        className="ui-action-icon"
                        disabled={cancelingExportId === task.id}
                        label={t("common.cancel")}
                        onClick={() => void cancelExportTask(task)}
                      >
                        <X aria-hidden="true" />
                      </IconButton>
                    ) : (
                      <IconButton
                        className="ui-action-icon"
                        disabled={deletingExportId === task.id}
                        label={t("common.delete")}
                        onClick={() => void deleteExportTask(task)}
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    )}
                  </div>
                </article>
              ))}

              {!exportTasksLoading && exportTasks.length === 0 ? (
                <EmptyState title={t("audit.exportTasksEmpty")} />
              ) : null}
            </div>
          </div>
        </Dialog>
      ) : null}

      {routeLogId ? (
        <DetailDialog
          closeLabel={t("common.close")}
          emptyState={!detailLoading && !detailError ? <EmptyState title={t("audit.empty1")} /> : null}
          items={detailLog ? [
            { label: t("audit.eventType"), value: detailLog.event_type },
            { label: t("common.result"), value: auditResultLabel(detailLog.result, t) },
            {
              label: t("audit.resource"),
              value: `${detailLog.resource_type || "--"} ${detailLog.resource_id ? `/ ${detailLog.resource_id}` : ""}`
            },
            { label: t("audit.targetPath"), value: detailLog.target_path || "--", valueClassName: "mono-wrap" },
            {
              label: t("audit.terminalSession"),
              value: detailLog.terminal_session_id || "--",
              valueClassName: "mono-wrap"
            },
            { label: t("audit.client"), value: detailLog.client_ip || "--" },
            {
              label: t("common.time"),
              value: formatDateTime(detailLog.occurred_at, language, t("common.notRecorded"))
            },
            { label: t("common.message"), value: detailLog.message || "--" }
          ] : []}
          leadingContent={(
            <>
              {detailLoading ? (
                <div className="loading-overlay loading-overlay-inline">
                  <LoadingState label={t("audit.loading")} />
                </div>
              ) : null}
            </>
          )}
          onOpenChange={(open) => {
            if (!open) {
              closeDetail();
            }
          }}
          open
          size="lg"
          title={t("audit.detailTitle")}
        >
          {detailLog ? (
            <div className="content-card audit-metadata-card">
              <h4>Metadata</h4>
              {detailLog.metadata && Object.keys(detailLog.metadata).length > 0 ? (
                <div className="audit-metadata-list">
                  {Object.entries(detailLog.metadata).map(([key, value]) => (
                    <div key={key} className="audit-metadata-item">
                      <span>{key}</span>
                      <pre>{stringifyMetadataValue(value)}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title={t("audit.noMetadata")} />
              )}
            </div>
          ) : null}
        </DetailDialog>
      ) : null}
    </div>
  );
}
