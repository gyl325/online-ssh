import { ProgressBar } from "../../shared/ui";

export type FileTransferProgressState = {
  kind: "upload" | "download";
  fileName: string;
  status: string;
  transferredBytes: number;
  totalBytes: number;
  note: string;
};

export type UploadQueueItem = {
  id: string;
  fileName: string;
  totalBytes: number;
  transferredBytes: number;
  status: "queued" | "uploading" | "completed" | "failed";
  message: string | null;
};

type FileTransferStatusPanelProps = {
  activeTransfer: FileTransferProgressState | null;
  formatBytes: (bytes: number) => string;
  t: (key: string, values?: Record<string, string | number>) => string;
  uploadQueue: UploadQueueItem[];
};

function transferProgressPercent(progress: Pick<FileTransferProgressState, "totalBytes" | "transferredBytes">) {
  if (progress.totalBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((progress.transferredBytes / progress.totalBytes) * 100));
}

export function FileTransferStatusPanel({
  activeTransfer,
  formatBytes,
  t,
  uploadQueue
}: FileTransferStatusPanelProps) {
  const activeTransferLabel = activeTransfer?.kind === "upload" ? t("files.uploadProgress") : t("files.downloadProgress");

  return (
    <section className="files-sidebar-transfer-panel" aria-label={t("files.transferPanelTitle")}>
      <div className="files-sidebar-panel-header">
        <strong>{t("files.transferPanelTitle")}</strong>
        <span>{activeTransfer ? t("files.transferPanelActive") : t("files.transferPanelIdle")}</span>
      </div>

      {activeTransfer ? (
        <div className="files-transfer-progress-card">
          <div className="files-transfer-progress-top">
            <strong>{activeTransferLabel}</strong>
            <span>{transferProgressPercent(activeTransfer)}%</span>
          </div>
          <div className="files-transfer-progress-meta">
            <span className="mono-wrap">{activeTransfer.fileName}</span>
            <span>{formatBytes(activeTransfer.transferredBytes)} / {formatBytes(activeTransfer.totalBytes)}</span>
            <span>{activeTransfer.status}</span>
          </div>
          <ProgressBar
            className="files-transfer-progress-track"
            label={activeTransferLabel}
            value={transferProgressPercent(activeTransfer)}
          />
          <p>{activeTransfer.note}</p>
        </div>
      ) : null}

      {uploadQueue.length > 0 ? (
        <section className="files-upload-queue" aria-label={t("files.uploadQueueTitle")}>
          <div className="files-upload-queue-header">
            <strong>{t("files.uploadQueueTitle")}</strong>
            <span>{t("files.uploadQueueSummary", { count: uploadQueue.length })}</span>
          </div>
          {uploadQueue.map((item) => {
            const progress = transferProgressPercent(item);
            return (
              <div className={`files-upload-queue-row files-upload-queue-${item.status}`} key={item.id}>
                <div className="files-upload-queue-main">
                  <span className="mono-wrap">{item.fileName}</span>
                  <span>{formatBytes(item.transferredBytes)} / {formatBytes(item.totalBytes)}</span>
                  <span>{t(`files.uploadStatus.${item.status}`)}</span>
                </div>
                <ProgressBar value={progress} />
                {item.message ? <p>{item.message}</p> : null}
              </div>
            );
          })}
        </section>
      ) : (
        <p className="files-sidebar-empty">{t("files.transferPanelEmpty")}</p>
      )}
    </section>
  );
}
