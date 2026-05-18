import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Eye, RotateCw, Star, Trash2 } from "lucide-react";

import { getApiErrorMessage } from "../auth/api";
import { usePreferences } from "../preferences/PreferencesContext";
import { useConfirmDialog } from "../ui/ConfirmDialogContext";
import { useToast } from "../ui/ToastContext";
import { formatDateTime } from "../../shared/lib/date";
import { saveBlobAsFile } from "../../shared/lib/download";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  InlineNote,
  LoadingState,
  Pagination,
  SelectInput,
  ToggleRow
} from "../../shared/ui";
import {
  deleteTerminalRecording,
  getTerminalRecordingSettings,
  listTerminalRecordingChunks,
  listTerminalRecordings,
  updateTerminalRecordingBookmark,
  updateTerminalRecordingSettings
} from "./api";
import type { TerminalRecording, TerminalRecordingChunk, TerminalRecordingSettings } from "./types";
import { TerminalHistoryReplay } from "./TerminalHistoryReplay";

type TerminalHistoryDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

type HistoryMode = "list" | "replay";

const retentionOptions = [1, 3, 7, 14, 30];
const recordingPageSize = 20;
const recordingDownloadChunkLimit = 500;

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRecordingFileTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace(/[^0-9A-Za-z]+/g, "").slice(0, 15) || "unknown";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join("");
}

function terminalRecordingFileName(recording: TerminalRecording) {
  return `terminal-history-${formatRecordingFileTimestamp(recording.started_at)}-${recording.id}.log`;
}

function buildTerminalRecordingLog(recording: TerminalRecording, chunks: TerminalRecordingChunk[]) {
  const lines = [
    `Terminal history ${recording.id}`,
    `Session: ${recording.terminal_session_id || "-"}`,
    `Host: ${recording.host_id || "-"}`,
    `Started: ${recording.started_at}`,
    `Ended: ${recording.ended_at || "-"}`,
    `Status: ${recording.status}`,
    ""
  ];

  for (const chunk of chunks) {
    lines.push(`[${chunk.occurred_at}] ${chunk.direction}`);
    lines.push(chunk.data.endsWith("\n") ? chunk.data : `${chunk.data}\n`);
  }

  return lines.join("\n");
}

function recordingStatusLabel(status: TerminalRecording["status"], t: (key: string) => string) {
  switch (status) {
    case "active":
      return t("terminal.history.status.active");
    case "failed":
      return t("terminal.history.status.failed");
    default:
      return t("terminal.history.status.completed");
  }
}

export function TerminalHistoryDialog({ onOpenChange, open }: TerminalHistoryDialogProps) {
  const { language, t } = usePreferences();
  const { requestConfirmation } = useConfirmDialog();
  const toast = useToast();
  const [settings, setSettings] = useState<TerminalRecordingSettings | null>(null);
  const [recordings, setRecordings] = useState<TerminalRecording[]>([]);
  const [recordingsPage, setRecordingsPage] = useState(1);
  const [recordingsTotal, setRecordingsTotal] = useState(0);
  const [historyMode, setHistoryMode] = useState<HistoryMode>("list");
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<TerminalRecordingChunk[]>([]);
  const [nextCursor, setNextCursor] = useState(0);
  const [hasMoreChunks, setHasMoreChunks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [bookmarkSubmittingIds, setBookmarkSubmittingIds] = useState<Set<string>>(() => new Set());
  const [downloadSubmittingIds, setDownloadSubmittingIds] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const recordingsTotalPages = Math.max(1, Math.ceil(recordingsTotal / recordingPageSize));

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedRecordingId) || null,
    [recordings, selectedRecordingId]
  );

  const loadRecordings = async (page = recordingsPage) => {
    const nextPage = Math.max(1, page);
    setLoading(true);
    setErrorMessage(null);
    try {
      const [settingsResponse, recordingsResponse] = await Promise.all([
        getTerminalRecordingSettings(),
        listTerminalRecordings({ page: nextPage, page_size: recordingPageSize })
      ]);
      setSettings(settingsResponse.settings);
      setRecordings(recordingsResponse.items);
      setRecordingsPage(recordingsResponse.page || nextPage);
      setRecordingsTotal(recordingsResponse.total);
      setSelectedRecordingId((current) => current && recordingsResponse.items.some((recording) => recording.id === current) ? current : null);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.history.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const loadChunks = async (recordingId: string, cursor = 0, append = false) => {
    setChunksLoading(true);
    setErrorMessage(null);
    try {
      const response = await listTerminalRecordingChunks(recordingId, { cursor, limit: 200 });
      setChunks((current) => append ? [...current, ...response.items] : response.items);
      setNextCursor(response.next_cursor);
      setHasMoreChunks(response.has_more);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.history.chunksFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setChunksLoading(false);
    }
  };

  const loadAllChunks = async (recordingId: string) => {
    const allChunks: TerminalRecordingChunk[] = [];
    let cursor = 0;
    let guard = 0;

    while (true) {
      const response = await listTerminalRecordingChunks(recordingId, {
        cursor,
        limit: recordingDownloadChunkLimit
      });
      allChunks.push(...response.items);

      if (!response.has_more) {
        return allChunks;
      }

      if (response.next_cursor === cursor || guard > 1000) {
        throw new Error(t("terminal.history.downloadFailed"));
      }
      cursor = response.next_cursor;
      guard += 1;
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setHistoryMode("list");
    setSelectedRecordingId(null);
    setRecordingsPage(1);
    setRecordingsTotal(0);
    setChunks([]);
    setNextCursor(0);
    setHasMoreChunks(false);
    void loadRecordings(1);
  }, [open]);

  useEffect(() => {
    if (!open || historyMode !== "replay" || !selectedRecordingId) {
      setChunks([]);
      setNextCursor(0);
      setHasMoreChunks(false);
      return;
    }
    void loadChunks(selectedRecordingId);
  }, [historyMode, open, selectedRecordingId]);

  const formatEndTime = (recording: TerminalRecording) =>
    recording.ended_at ? formatDateTime(recording.ended_at, language, recording.ended_at) : t("terminal.history.inProgress");

  const retentionLabel = (recording: TerminalRecording) =>
    recording.is_bookmarked
      ? t("terminal.history.bookmarkedRetention")
      : t("terminal.history.expiresAt", { date: formatDateTime(recording.expires_at, language, recording.expires_at) });

  const showReplay = (recording: TerminalRecording) => {
    setSelectedRecordingId(recording.id);
    setHistoryMode("replay");
  };

  const backToList = () => {
    setHistoryMode("list");
    setSelectedRecordingId(null);
    setChunks([]);
    setNextCursor(0);
    setHasMoreChunks(false);
  };

  const toggleBookmark = async (recording: TerminalRecording) => {
    const nextBookmarked = !recording.is_bookmarked;
    setBookmarkSubmittingIds((current) => new Set([...current, recording.id]));
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await updateTerminalRecordingBookmark(recording.id, nextBookmarked);
      setRecordings((current) => current.map((item) => item.id === response.recording.id ? response.recording : item));
      const message = response.recording.is_bookmarked
        ? t("terminal.history.bookmarkAdded")
        : t("terminal.history.bookmarkRemoved");
      setSuccessMessage(message);
      toast.success(message);
      const shouldReturnToList = !response.recording.is_bookmarked && new Date(response.recording.expires_at).getTime() <= Date.now();
      if (shouldReturnToList) {
        backToList();
      }
      await loadRecordings(recordingsPage);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.history.bookmarkFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setBookmarkSubmittingIds((current) => {
        const next = new Set(current);
        next.delete(recording.id);
        return next;
      });
    }
  };

  const saveSettings = async () => {
    if (!settings) {
      return;
    }
    setSavingSettings(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await updateTerminalRecordingSettings({
        enabled: settings.enabled,
        retention_days: settings.retention_days
      });
      setSettings(response.settings);
      const message = t("terminal.history.settingsSaved");
      setSuccessMessage(message);
      toast.success(message);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.history.settingsFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSavingSettings(false);
    }
  };

  const deleteRecording = async (recording: TerminalRecording) => {
    const confirmed = await requestConfirmation({
      title: t("terminal.history.deleteTitle"),
      message: t("terminal.history.deleteMessage", { date: formatDateTime(recording.started_at, language, recording.started_at) }),
      confirmLabel: t("terminal.history.deleteConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteTerminalRecording(recording.id);
      const message = t("terminal.history.deleted");
      setSuccessMessage(message);
      toast.success(message);
      if (selectedRecordingId === recording.id) {
        backToList();
      }
      await loadRecordings(recordingsPage);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.history.deleteFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const downloadRecording = async (recording: TerminalRecording) => {
    setDownloadSubmittingIds((current) => new Set([...current, recording.id]));
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const allChunks = await loadAllChunks(recording.id);
      const blob = new Blob([buildTerminalRecordingLog(recording, allChunks)], {
        type: "text/plain;charset=utf-8"
      });
      saveBlobAsFile(blob, terminalRecordingFileName(recording));
      const message = t("terminal.history.downloaded");
      setSuccessMessage(message);
      toast.success(message);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.history.downloadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setDownloadSubmittingIds((current) => {
        const next = new Set(current);
        next.delete(recording.id);
        return next;
      });
    }
  };

  return (
    <Dialog
      closeLabel={t("common.close")}
      description={<span>{t("terminal.history.copy")}</span>}
      headerActions={
        <IconButton disabled={loading} label={t("common.refresh")} onClick={() => void loadRecordings(recordingsPage)} variant="ghost">
          <RotateCw aria-hidden="true" />
        </IconButton>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={t("terminal.history.title")}
    >
      <div className="terminal-history-dialog">
        <section className="terminal-history-settings">
          <section aria-label={t("terminal.history.captureTitle")} className="terminal-history-capture">
            <span className="terminal-history-setting-label">{t("terminal.history.captureTitle")}</span>
            <ToggleRow
              checked={Boolean(settings?.enabled)}
              className="terminal-history-check-row"
              disabled={!settings || savingSettings}
              label={t("terminal.history.enabled")}
              onChange={(event) => setSettings((current) => current ? { ...current, enabled: event.target.checked } : current)}
            />
          </section>

          <FormField className="terminal-history-retention" label={t("terminal.history.retention")}>
            {(id) => (
              <SelectInput
                disabled={!settings || savingSettings}
                id={id}
                onChange={(event) => setSettings((current) => current ? { ...current, retention_days: Number(event.target.value) } : current)}
                value={settings?.retention_days || 7}
              >
                {retentionOptions.map((days) => (
                  <option key={days} value={days}>{t("terminal.history.retentionDays", { days })}</option>
                ))}
              </SelectInput>
            )}
          </FormField>

          <Button className="terminal-history-save-button" disabled={!settings || savingSettings} onClick={() => void saveSettings()} size="sm" variant="primary">
            {savingSettings ? t("common.saving") : t("common.save")}
          </Button>
        </section>

        <InlineNote tone="warning">
          {t("terminal.history.warning")}
        </InlineNote>

        {historyMode === "list" ? (
          <section className="terminal-history-table-panel" aria-label={t("terminal.history.listLabel")}>
            {loading ? <LoadingState label={t("terminal.history.loading")} /> : null}
            {!loading && recordings.length === 0 ? (
              <EmptyState title={t("terminal.history.empty")} />
            ) : null}
            {!loading && recordings.length > 0 ? (
              <>
                <div className="terminal-history-table-scroll">
                  <table className="terminal-history-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("terminal.history.startTime")}</th>
                        <th scope="col">{t("terminal.history.endTime")}</th>
                        <th scope="col">{t("terminal.history.status")}</th>
                        <th scope="col">{t("terminal.history.ioBytes")}</th>
                        <th scope="col">{t("terminal.history.retentionState")}</th>
                        <th scope="col">{t("terminal.history.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recordings.map((recording) => (
                        <tr key={recording.id}>
                          <td>{formatDateTime(recording.started_at, language, recording.started_at)}</td>
                          <td>{formatEndTime(recording)}</td>
                          <td>{recordingStatusLabel(recording.status, t)}</td>
                          <td>
                            {formatBytes(recording.input_bytes)} {t("terminal.history.input")} / {formatBytes(recording.output_bytes)} {t("terminal.history.output")}
                          </td>
                          <td>
                            <Badge
                              appearance="outline"
                              tone={recording.is_bookmarked ? "warning" : "neutral"}
                            >
                              {retentionLabel(recording)}
                            </Badge>
                          </td>
                          <td>
                            <div className="terminal-history-actions">
                              <IconButton label={t("terminal.history.showDetails")} onClick={() => showReplay(recording)} size="sm" variant="ghost">
                                <Eye aria-hidden="true" />
                              </IconButton>
                              <IconButton
                                aria-pressed={recording.is_bookmarked}
                                className={recording.is_bookmarked ? "terminal-history-bookmark-active" : undefined}
                                disabled={bookmarkSubmittingIds.has(recording.id)}
                                label={recording.is_bookmarked ? t("terminal.history.removeBookmark") : t("terminal.history.addBookmark")}
                                onClick={() => void toggleBookmark(recording)}
                                size="sm"
                                variant="ghost"
                              >
                                <Star aria-hidden="true" />
                              </IconButton>
                              <IconButton label={t("terminal.history.delete")} onClick={() => void deleteRecording(recording)} size="sm" variant="danger">
                                <Trash2 aria-hidden="true" />
                              </IconButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="terminal-history-pagination">
                  <p>{t("pagination.summary", { page: recordingsPage, totalPages: recordingsTotalPages, total: recordingsTotal })}</p>
                  <Pagination
                    firstLabel={t("pagination.first")}
                    label={t("terminal.history.pagination")}
                    lastLabel={t("pagination.last")}
                    nextLabel={t("pagination.next")}
                    onPageChange={(page) => void loadRecordings(page)}
                    page={recordingsPage}
                    previousLabel={t("pagination.previous")}
                    totalPages={recordingsTotalPages}
                  />
                </div>
              </>
            ) : null}
          </section>
        ) : (
          <section className="terminal-history-replay-panel">
            {selectedRecording ? (
              <>
                <div className="terminal-history-replay-toolbar">
                  <IconButton label={t("terminal.history.backToList")} onClick={backToList} size="sm" variant="ghost">
                    <ArrowLeft aria-hidden="true" />
                  </IconButton>
                  <div className="terminal-history-replay-heading">
                    <strong>
                      {formatDateTime(selectedRecording.started_at, language, selectedRecording.started_at)} - {formatEndTime(selectedRecording)}
                    </strong>
                    <p>
                      {recordingStatusLabel(selectedRecording.status, t)}
                      {" · "}
                      <Badge appearance="outline" tone={selectedRecording.is_bookmarked ? "warning" : "neutral"}>
                        {retentionLabel(selectedRecording)}
                      </Badge>
                    </p>
                  </div>
                  <div className="terminal-history-actions">
                    <IconButton
                      disabled={downloadSubmittingIds.has(selectedRecording.id)}
                      label={t("terminal.history.download")}
                      onClick={() => void downloadRecording(selectedRecording)}
                      size="sm"
                      variant="ghost"
                    >
                      <Download aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-pressed={selectedRecording.is_bookmarked}
                      className={selectedRecording.is_bookmarked ? "terminal-history-bookmark-active" : undefined}
                      disabled={bookmarkSubmittingIds.has(selectedRecording.id)}
                      label={selectedRecording.is_bookmarked ? t("terminal.history.removeBookmark") : t("terminal.history.addBookmark")}
                      onClick={() => void toggleBookmark(selectedRecording)}
                      size="sm"
                      variant="ghost"
                    >
                      <Star aria-hidden="true" />
                    </IconButton>
                    <IconButton label={t("terminal.history.delete")} onClick={() => void deleteRecording(selectedRecording)} size="sm" variant="danger">
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>

                <TerminalHistoryReplay ariaLabel={t("terminal.history.replayLabel")} chunks={chunks} />

                {chunksLoading ? <LoadingState label={t("terminal.history.chunksLoading")} /> : null}
                {hasMoreChunks ? (
                  <Button disabled={chunksLoading} onClick={() => void loadChunks(selectedRecording.id, nextCursor, true)} size="sm" variant="secondary">
                    {t("terminal.history.loadMore")}
                  </Button>
                ) : null}
                {selectedRecording.dropped_bytes > 0 ? (
                  <InlineNote tone="warning">
                    {t("terminal.history.dropped", { bytes: formatBytes(selectedRecording.dropped_bytes) })}
                  </InlineNote>
                ) : null}
              </>
            ) : (
              <EmptyState title={t("terminal.history.selectEmpty")} />
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
