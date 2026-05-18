import { lazy, Suspense } from "react";

import { formatDateTime } from "../../shared/lib/date";
import { Badge, Button, Dialog, InlineNote, LoadingState } from "../../shared/ui";
import type { FilePreviewKind } from "./fileViewModel";
import { maxEditableFileBytes } from "./fileViewModel";
import { FileEntryTypeIcon } from "./FileEntryTypeIcon";
import type { FileContentResponse, FileEntry } from "./types";

const FileTextEditor = lazy(() =>
  import("./FileTextEditor").then((module) => ({ default: module.FileTextEditor }))
);
const FilePdfPreview = lazy(() =>
  import("./FilePdfPreview").then((module) => ({ default: module.FilePdfPreview }))
);

export type FilePreviewDialogState = {
  entry: FileEntry;
  previewKind: FilePreviewKind;
  status: "loading" | "ready" | "error";
  content: FileContentResponse | null;
  draft: string;
  editing: boolean;
  objectUrl: string | null;
  saving: boolean;
  errorMessage: string | null;
};

type FilePreviewDialogProps = {
  dialog: FilePreviewDialogState;
  draftChanged: boolean;
  draftSizeBytes: number;
  language: string;
  onCancelEdit: () => void;
  onClose: () => void;
  onDownload: (entry: FileEntry) => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onStartEdit: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function previewKindLabel(previewKind: FilePreviewKind, t: (key: string) => string) {
  switch (previewKind) {
    case "image":
      return t("files.previewKind.image");
    case "pdf":
      return t("files.previewKind.pdf");
    case "text":
    default:
      return t("files.previewKind.text");
  }
}

export function FilePreviewDialog({
  dialog,
  draftChanged,
  draftSizeBytes,
  language,
  onCancelEdit,
  onClose,
  onDownload,
  onDraftChange,
  onSave,
  onStartEdit,
  t
}: FilePreviewDialogProps) {
  return (
    <Dialog
      bodyClassName={dialog.status === "ready" ? "files-preview-dialog-body" : undefined}
      closeLabel={t("common.close")}
      contentClassName={dialog.status === "ready" ? "files-preview-modal" : undefined}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      size="lg"
      title={dialog.entry.name}
    >
      {dialog.status === "loading" ? (
        <LoadingState
          className="files-preview-loading"
          label={dialog.previewKind === "text" ? t("files.readingContent") : t("files.loadingPreview")}
        />
      ) : null}

      {dialog.status === "error" ? (
        <>
          <p className="modal-copy">{dialog.errorMessage}</p>
          <div className="login-actions">
            <Button onClick={onClose} variant="secondary">
              {t("common.close")}
            </Button>
            {dialog.entry.entry_type === "file" ? (
              <Button onClick={() => onDownload(dialog.entry)} variant="primary">
                {t("files.download")}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {dialog.status === "ready" ? (
        <div className="files-preview-dialog">
          <div className="files-preview-filebar">
            <span className="files-preview-file-icon"><FileEntryTypeIcon entryType={dialog.entry.entry_type} /></span>
            <div className="files-preview-file-copy">
              <strong>{dialog.entry.name}</strong>
              <span>
                {dialog.content?.encoding ? `${dialog.content.encoding} · ` : ""}
                {formatBytes(dialog.content?.size_bytes ?? dialog.entry.size_bytes)}
                {" · "}
                {t("common.lastModified", {
                  time: formatDateTime(
                    dialog.content?.last_modified_at || dialog.entry.modified_at,
                    language,
                    t("common.notRecorded")
                  )
                })}
              </span>
            </div>
            <Badge size="sm" tone="neutral">{previewKindLabel(dialog.previewKind, t)}</Badge>
            <Button onClick={() => onDownload(dialog.entry)} variant="secondary">
              {t("files.download")}
            </Button>
          </div>

          <div className="files-preview-main">
            {dialog.previewKind === "text" && dialog.content ? (
              <Suspense fallback={<LoadingState className="files-preview-loading" label={t("files.loadingPreview")} />}>
                <FileTextEditor
                  ariaLabel={t("files.previewTextAria")}
                  disabled={dialog.saving}
                  editable={dialog.editing}
                  onChange={onDraftChange}
                  value={dialog.draft}
                />
              </Suspense>
            ) : null}

            {dialog.previewKind === "image" && dialog.objectUrl ? (
              <div className="files-image-preview-shell">
                <img alt={dialog.entry.name} className="files-image-preview" src={dialog.objectUrl} />
              </div>
            ) : null}

            {dialog.previewKind === "pdf" && dialog.objectUrl ? (
              <Suspense fallback={<LoadingState className="files-preview-loading" label={t("files.pdfLoading")} />}>
                <FilePdfPreview
                  fileName={dialog.entry.name}
                  fileUrl={dialog.objectUrl}
                  labels={{
                    error: t("files.pdfLoadFailed"),
                    loading: t("files.pdfLoading"),
                    nextPage: t("files.pdfNextPage"),
                    pageStatus: (page, totalPages) => t("files.pdfPageStatus", { page, total: totalPages }),
                    previousPage: t("files.pdfPreviousPage"),
                    zoomIn: t("files.pdfZoomIn"),
                    zoomOut: t("files.pdfZoomOut")
                  }}
                />
              </Suspense>
            ) : null}
          </div>

          <div className="files-editor-footer">
            <InlineNote
              className="files-preview-note"
              title={dialog.previewKind === "text"
                ? dialog.editing ? t("files.editorNote") : t("files.editorReadOnlyNote")
                : undefined}
            >
              {dialog.previewKind === "text"
                ? t("files.draftSize", { size: formatBytes(draftSizeBytes) })
                : dialog.previewKind === "pdf" ? t("files.pdfPreviewNote") : t("files.imagePreviewNote")}
            </InlineNote>

            <div className="login-actions">
              <Button disabled={dialog.saving} onClick={onClose} variant="secondary">
                {t("common.close")}
              </Button>
              {dialog.previewKind === "text" && dialog.editing ? (
                <>
                  <Button disabled={dialog.saving} onClick={onCancelEdit} variant="secondary">
                    {t("files.cancelEdit")}
                  </Button>
                  <Button
                    disabled={
                      dialog.saving ||
                      !draftChanged ||
                      draftSizeBytes > maxEditableFileBytes
                    }
                    loading={dialog.saving}
                    onClick={onSave}
                    variant="primary"
                  >
                    {dialog.saving ? t("common.saving") : t("common.save")}
                  </Button>
                </>
              ) : dialog.previewKind === "text" ? (
                <Button onClick={onStartEdit} variant="primary">
                  {t("files.editContent")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
