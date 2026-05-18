import {
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FolderPlus,
  Home,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Upload
} from "lucide-react";

import { IconButton, SegmentedControl, Toolbar } from "../../shared/ui";
import { pathSegments } from "./fileViewModel";

export type FileBrowserViewMode = "list" | "grid";

type FileBrowserToolbarProps = {
  backDisabled: boolean;
  canUseCurrentHost: boolean;
  currentPath: string;
  directoryLoading: boolean;
  forwardDisabled: boolean;
  itemCount: number;
  onBack: () => void;
  onBeginPathEdit: () => void;
  onCancelPathEdit: () => void;
  onClearSearch: () => void;
  onCreateDirectory: () => void;
  onCreateFile: () => void;
  onForward: () => void;
  onGoRoot: () => void;
  onOpenPath: (path: string) => void;
  onParent: () => void;
  onPathDraftChange: (value: string) => void;
  onRefresh: () => void;
  onRemoteSearch: () => void;
  onSearchKeywordChange: (value: string) => void;
  onSubmitPathEdit: () => void;
  onUpload: () => void;
  onViewModeChange: (mode: FileBrowserViewMode) => void;
  pathDraft: string;
  pathEditing: boolean;
  searchKeyword: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  viewMode: FileBrowserViewMode;
};

export function FileBrowserToolbar({
  backDisabled,
  canUseCurrentHost,
  currentPath,
  directoryLoading,
  forwardDisabled,
  itemCount,
  onBack,
  onBeginPathEdit,
  onCancelPathEdit,
  onClearSearch,
  onCreateDirectory,
  onCreateFile,
  onForward,
  onGoRoot,
  onOpenPath,
  onParent,
  onPathDraftChange,
  onRefresh,
  onRemoteSearch,
  onSearchKeywordChange,
  onSubmitPathEdit,
  onUpload,
  onViewModeChange,
  pathDraft,
  pathEditing,
  searchKeyword,
  t,
  viewMode
}: FileBrowserToolbarProps) {
  return (
    <div className="section-header files-main-header">
      <div>
        <h4>{t("files.listTitle")}</h4>
        <p>
          {directoryLoading
            ? t("files.loadingDirectory")
            : t("files.listSummary", { count: itemCount })}
        </p>
      </div>
      <div className="files-main-controls">
        <div className="files-main-toolbar-row">
          <div className="files-search-field files-main-search">
            <input
              onChange={(event) => onSearchKeywordChange(event.target.value)}
              placeholder={t("files.searchPlaceholder")}
              type="search"
              value={searchKeyword}
            />
            <button
              className="files-search-clear"
              disabled={!searchKeyword}
              onClick={onClearSearch}
              type="button"
            >
              <span className="visually-hidden">{t("files.clearSearch")}</span>
              <span aria-hidden="true">x</span>
            </button>
          </div>

          <Toolbar className="files-toolbar">
            <IconButton
              className="files-icon-button"
              disabled={!canUseCurrentHost || backDisabled}
              label={t("files.back")}
              onClick={onBack}
              variant="ghost"
            >
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <IconButton
              className="files-icon-button"
              disabled={!canUseCurrentHost || forwardDisabled}
              label={t("files.forward")}
              onClick={onForward}
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" />
            </IconButton>
            <SegmentedControl
              ariaLabel={t("files.viewMode")}
              className="files-view-switch"
              items={[
                {
                  label: (
                    <>
                      <List aria-hidden="true" />
                      <span className="visually-hidden">{t("files.viewList")}</span>
                    </>
                  ),
                  value: "list"
                },
                {
                  label: (
                    <>
                      <LayoutGrid aria-hidden="true" />
                      <span className="visually-hidden">{t("files.viewGrid")}</span>
                    </>
                  ),
                  value: "grid"
                }
              ]}
              onChange={onViewModeChange}
              value={viewMode}
            />
            <IconButton className="files-icon-button" disabled={!canUseCurrentHost} label={t("files.goRoot")} onClick={onGoRoot} variant="ghost">
              <Home aria-hidden="true" />
            </IconButton>
            <IconButton
              className="files-icon-button"
              disabled={!canUseCurrentHost || currentPath === "/"}
              label={t("files.parent")}
              onClick={onParent}
              variant="ghost"
            >
              <span aria-hidden="true" className="files-parent-symbol">..</span>
            </IconButton>
            <IconButton className="files-icon-button" disabled={!canUseCurrentHost} label={t("files.refreshDirectory")} onClick={onRefresh} variant="ghost">
              <RefreshCw aria-hidden="true" />
            </IconButton>
            <IconButton className="files-icon-button" disabled={!canUseCurrentHost} label={t("files.remoteSearchTitle")} onClick={onRemoteSearch} variant="ghost">
              <Search aria-hidden="true" />
            </IconButton>
            <IconButton
              className="files-icon-button"
              disabled={!canUseCurrentHost}
              label={t("files.createDirectory")}
              onClick={onCreateDirectory}
              variant="ghost"
            >
              <FolderPlus aria-hidden="true" />
            </IconButton>
            <IconButton
              className="files-icon-button"
              disabled={!canUseCurrentHost}
              label={t("files.createFile")}
              onClick={onCreateFile}
              variant="ghost"
            >
              <FilePlus aria-hidden="true" />
            </IconButton>
            <IconButton className="files-icon-button" disabled={!canUseCurrentHost} label={t("files.uploadEntry")} onClick={onUpload} variant="ghost">
              <Upload aria-hidden="true" />
            </IconButton>
          </Toolbar>
        </div>

        <div
          className="files-inline-breadcrumb"
          onClick={(event) => {
            if (event.currentTarget === event.target) {
              onBeginPathEdit();
            }
          }}
        >
          {pathEditing ? (
            <div className="files-path-editor">
              <input
                autoFocus
                className="files-path-input"
                onBlur={onCancelPathEdit}
                onChange={(event) => onPathDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmitPathEdit();
                  }
                  if (event.key === "Escape") {
                    onCancelPathEdit();
                  }
                }}
                value={pathDraft}
              />
              <button
                className="files-path-go"
                onClick={onSubmitPathEdit}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                {t("files.go")}
              </button>
            </div>
          ) : (
            pathSegments(currentPath).map((segment, index, items) => (
              <span className="files-breadcrumb-text-item" key={segment.value}>
                <button
                  disabled={!canUseCurrentHost}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPath(segment.value);
                  }}
                  title={segment.value}
                  type="button"
                >
                  {segment.label}
                </button>
                {index < items.length - 1 ? <span>&gt;</span> : null}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
