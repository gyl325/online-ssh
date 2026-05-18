import { Button, Dialog, FormField, SelectInput, TextInput } from "../../shared/ui";
import {
  type CompressArchiveFormat,
  compressArchiveFormats
} from "./fileViewModel";
import type { FileEntry } from "./types";

export type ActionDialogState =
  | { kind: "create-directory"; value: string }
  | { kind: "create-file"; value: string }
  | { kind: "rename"; entry: FileEntry; value: string }
  | { kind: "chmod"; entry: FileEntry; value: string }
  | { kind: "delete"; entry: FileEntry };

export type CompressDialogState = {
  entry: FileEntry;
  format: CompressArchiveFormat;
  name: string;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

type FileActionDialogsProps = {
  actionDialog: ActionDialogState | null;
  actionSubmitting: boolean;
  compressDialog: CompressDialogState | null;
  compressSubmitting: boolean;
  onActionClose: () => void;
  onActionSubmit: () => void;
  onActionValueChange: (value: string) => void;
  onCompressClose: () => void;
  onCompressFormatChange: (format: CompressArchiveFormat) => void;
  onCompressNameChange: (name: string) => void;
  onCompressSubmit: () => void;
  t: Translate;
};

function actionDialogTitle(actionDialog: ActionDialogState, t: Translate) {
  if (actionDialog.kind === "create-directory") {
    return t("files.createDirectory");
  }
  if (actionDialog.kind === "create-file") {
    return t("files.createFile");
  }
  if (actionDialog.kind === "rename") {
    return t("files.rename");
  }
  if (actionDialog.kind === "chmod") {
    return t("files.action.chmod");
  }
  return t("files.deleteConfirmTitle");
}

export function FileActionDialogs({
  actionDialog,
  actionSubmitting,
  compressDialog,
  compressSubmitting,
  onActionClose,
  onActionSubmit,
  onActionValueChange,
  onCompressClose,
  onCompressFormatChange,
  onCompressNameChange,
  onCompressSubmit,
  t
}: FileActionDialogsProps) {
  return (
    <>
      {actionDialog ? (
        <Dialog
          closeLabel={t("common.close")}
          onOpenChange={(open) => {
            if (!open && !actionSubmitting) {
              onActionClose();
            }
          }}
          open
          title={actionDialogTitle(actionDialog, t)}
        >
          {actionDialog.kind === "delete" ? (
            <>
              <p className="modal-copy">
                {actionDialog.entry.entry_type === "directory"
                  ? t("files.confirmDeleteDirectory", { path: actionDialog.entry.path })
                  : t("files.confirmDeleteFile", { path: actionDialog.entry.path })}
              </p>
              <div className="dialog-action-row">
                <Button disabled={actionSubmitting} onClick={onActionClose} variant="secondary">
                  {t("common.cancel")}
                </Button>
                <Button disabled={actionSubmitting} onClick={onActionSubmit} variant="danger">
                  {actionSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
                  {actionSubmitting ? t("common.deleting") : t("files.confirmDelete")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <FormField
                label={actionDialog.kind === "chmod"
                  ? t("files.mode")
                  : actionDialog.kind === "rename"
                    ? t("files.newName")
                    : t("files.name")}
              >
                {(id) => (
                  <TextInput
                    autoFocus
                    disabled={actionSubmitting}
                    id={id}
                    onChange={(event) => onActionValueChange(event.target.value)}
                    placeholder={actionDialog.kind === "chmod" ? t("files.modePlaceholder") : t("files.namePlaceholder")}
                    value={actionDialog.value}
                  />
                )}
              </FormField>
              <div className="dialog-action-row">
                <Button disabled={actionSubmitting} onClick={onActionClose} variant="secondary">
                  {t("common.cancel")}
                </Button>
                <Button disabled={actionSubmitting} onClick={onActionSubmit} variant="primary">
                  {actionSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
                  {actionSubmitting ? t("common.executing") : t("common.execute")}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      ) : null}

      {compressDialog ? (
        <Dialog
          closeLabel={t("common.close")}
          description={t("files.compressArchiveCopy", { count: 1 })}
          onOpenChange={(open) => {
            if (!open && !compressSubmitting) {
              onCompressClose();
            }
          }}
          open
          title={t("files.compressArchiveTitle")}
        >
          <div className="dialog-form-stack">
            <FormField label={t("files.archiveName")}>
              {(id) => (
                <TextInput
                  autoFocus
                  disabled={compressSubmitting}
                  id={id}
                  onChange={(event) => onCompressNameChange(event.target.value)}
                  placeholder={t("files.archiveNamePlaceholder")}
                  value={compressDialog.name}
                />
              )}
            </FormField>
            <FormField label={t("files.archiveFormat")}>
              {(id) => (
                <SelectInput
                  disabled={compressSubmitting}
                  id={id}
                  onChange={(event) => onCompressFormatChange(event.target.value as CompressArchiveFormat)}
                  value={compressDialog.format}
                >
                  {compressArchiveFormats.map((format) => (
                    <option key={format.id} value={format.id}>
                      {t(format.labelKey)}
                    </option>
                  ))}
                </SelectInput>
              )}
            </FormField>
            <div className="archive-source-summary">
              <span>{t("files.archiveSource")}</span>
              <strong>{compressDialog.entry.name}</strong>
            </div>
            <div className="dialog-action-row">
              <Button disabled={compressSubmitting} onClick={onCompressClose} variant="secondary">
                {t("common.cancel")}
              </Button>
              <Button disabled={compressSubmitting} onClick={onCompressSubmit} variant="primary">
                {compressSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
                {compressSubmitting ? t("common.executing") : t("files.compress")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
