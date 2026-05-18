import { Badge, Button, Dialog, EmptyState, FormField, InlineNote, Pagination, SelectInput, TextInput } from "../../shared/ui";
import type { FileEntry, FileSearchResult, FileSearchTask } from "./types";

type Translate = (key: string, params?: Record<string, string | number>) => string;

type RemoteSearchState = "idle" | "running" | "ready" | "error";

export type FileRemoteSearchDialogProps = {
  includeHidden: boolean;
  isActive: boolean;
  keyword: string;
  maxDepth: number;
  onCancel: () => void;
  onClose: () => void;
  onIncludeHiddenChange: (includeHidden: boolean) => void;
  onKeywordChange: (keyword: string) => void;
  onMaxDepthChange: (maxDepth: number) => void;
  onOpenResult: (result: FileSearchResult) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRecursiveChange: (recursive: boolean) => void;
  onRefresh: () => void;
  onStart: () => void;
  page: number;
  pageSize: number;
  recursive: boolean;
  results: FileSearchResult[];
  scopePath: string;
  startDisabled: boolean;
  state: RemoteSearchState;
  t: Translate;
  task: FileSearchTask | null;
  total: number;
  totalPages: number;
};

function entryKindLabel(entryType: FileEntry["entry_type"], t: Translate) {
  switch (entryType) {
    case "directory":
      return t("files.kind.directory");
    case "file":
      return t("files.kind.file");
    case "symlink":
      return t("files.kind.symlink");
    default:
      return t("files.kind.other");
  }
}

function entryKindTone(entryType: FileEntry["entry_type"]) {
  switch (entryType) {
    case "directory":
      return "warning";
    case "file":
      return "info";
    default:
      return "neutral";
  }
}

export function FileRemoteSearchDialog({
  includeHidden,
  isActive,
  keyword,
  maxDepth,
  onCancel,
  onClose,
  onIncludeHiddenChange,
  onKeywordChange,
  onMaxDepthChange,
  onOpenResult,
  onPageChange,
  onPageSizeChange,
  onRecursiveChange,
  onRefresh,
  onStart,
  page,
  pageSize,
  recursive,
  results,
  scopePath,
  startDisabled,
  state,
  t,
  task,
  total,
  totalPages
}: FileRemoteSearchDialogProps) {
  return (
    <Dialog
      closeLabel={t("common.close")}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      size="lg"
      title={t("files.remoteSearchTitle")}
    >
      <section className="files-remote-search-panel files-remote-search-panel-modal" aria-label={t("files.remoteSearchTitle")}>
        <div className="files-remote-search-header">
          <div>
            <h5>{t("files.remoteSearchTitle")}</h5>
            <p>
              {task
                ? t("files.remoteSearchSummary", {
                    scanned: task.scanned_entries,
                    matched: task.matched_entries,
                    status: task.status
                  })
                : t("files.remoteSearchIdle")}
            </p>
            <p className="files-remote-search-scope" title={scopePath}>
              {t("files.remoteSearchScope", { path: scopePath })}
            </p>
          </div>
          <div className="files-remote-search-actions">
            <Button disabled={!task} onClick={onRefresh} variant="secondary">
              {t("files.remoteSearchRefresh")}
            </Button>
            <Button disabled={!task || !isActive} onClick={onCancel} variant="secondary">
              {t("files.remoteSearchCancel")}
            </Button>
          </div>
        </div>

        <div className="files-remote-search-controls">
          <FormField label={t("files.remoteSearchKeyword")}>
            {(id) => (
              <TextInput
                id={id}
                onChange={(event) => onKeywordChange(event.target.value)}
                placeholder={t("files.remoteSearchKeywordPlaceholder")}
                value={keyword}
              />
            )}
          </FormField>
          <FormField className="files-remote-search-depth" label={t("files.remoteSearchDepth")}>
            {(id) => (
              <SelectInput
                id={id}
                onChange={(event) => onMaxDepthChange(Number(event.target.value))}
                value={maxDepth}
              >
                {[1, 2, 3, 4, 5, 6].map((depth) => (
                  <option key={depth} value={depth}>
                    {depth}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <label className="checkbox-row">
            <input
              checked={recursive}
              onChange={(event) => onRecursiveChange(event.target.checked)}
              type="checkbox"
            />
            <span>{t("files.remoteSearchRecursive")}</span>
          </label>
          <label className="checkbox-row">
            <input
              checked={includeHidden}
              onChange={(event) => onIncludeHiddenChange(event.target.checked)}
              type="checkbox"
            />
            <span>{t("files.remoteSearchHidden")}</span>
          </label>
          <Button disabled={startDisabled || state === "running"} onClick={onStart} variant="primary">
            {state === "running" ? t("files.remoteSearchRunning") : t("files.remoteSearchStart")}
          </Button>
        </div>

        {task ? (
          <div className="files-remote-search-progress">
            <span>{t("files.remoteSearchDirs", { count: task.scanned_dirs })}</span>
            <span>{t("files.remoteSearchEntries", { count: task.scanned_entries })}</span>
            <span>{t("files.remoteSearchMatches", { count: task.matched_entries })}</span>
            <span>{t("files.remoteSearchSkipped", { count: task.skipped_errors_count })}</span>
            {task.limit_reached ? <span>{t("files.remoteSearchLimitReached")}</span> : null}
          </div>
        ) : null}

        {isActive && total > 0 ? <InlineNote tone="info">{t("files.remoteSearchPartial")}</InlineNote> : null}

        {results.length > 0 ? (
          <div className="files-remote-results">
            {results.map((item) => (
              <button
                className="files-remote-result"
                key={item.id}
                onClick={() => onOpenResult(item)}
                type="button"
              >
                <Badge tone={entryKindTone(item.entry_type)}>{entryKindLabel(item.entry_type, t)}</Badge>
                <span className="files-remote-result-name">{item.name}</span>
                <span className="files-remote-result-path">{item.path}</span>
              </button>
            ))}
          </div>
        ) : task && task.status !== "pending" && task.status !== "running" ? (
          <EmptyState title={t("files.remoteSearchEmpty")} />
        ) : null}

        {task ? (
          <div className="files-remote-pagination">
            <p>{t("files.remoteSearchPageSummary", { page, totalPages, total })}</p>
            <Pagination
              firstLabel={t("pagination.first")}
              label={t("files.remoteSearchTitle")}
              lastLabel={t("pagination.last")}
              nextLabel={t("pagination.next")}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              page={page}
              pageSize={pageSize}
              pageSizeLabel={t("pagination.pageSize")}
              pageSizeOptions={[20, 50, 100]}
              previousLabel={t("pagination.previous")}
              totalPages={totalPages}
            />
          </div>
        ) : null}
      </section>
    </Dialog>
  );
}
