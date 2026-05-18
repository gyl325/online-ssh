import type { AppLanguage } from "../preferences/PreferencesContext";
import type { Translator } from "../preferences/i18n/translator";
import { formatDateTime } from "../../shared/lib/date";
import { Button, Dialog } from "../../shared/ui";

type FingerprintShape = {
  algorithm: string;
  fingerprint: string;
  status: string;
  first_seen_at?: string | null;
  last_verified_at?: string | null;
};

type FingerprintConflict = {
  code: string;
  message: string;
  current_fingerprint: FingerprintShape;
  previous_fingerprint?: FingerprintShape | null;
};

export type FingerprintDialogOptions = {
  hostId: string;
  hostLabel: string;
  actionLabel: string;
  conflict: FingerprintConflict;
};

type FingerprintDialogPresenterProps = {
  language: AppLanguage;
  onCancel: () => void;
  onConfirm: () => void;
  pendingRequest: FingerprintDialogOptions;
  submitting: boolean;
  t: Translator;
};

export function FingerprintDialogPresenter({
  language,
  onCancel,
  onConfirm,
  pendingRequest,
  submitting,
  t
}: FingerprintDialogPresenterProps) {
  return (
    <Dialog
      closeLabel={t("common.close")}
      description={
        <span className="fingerprint-dialog-description">
          <span>
            {t("fingerprint.copy", {
              action: pendingRequest.actionLabel,
              host: pendingRequest.hostLabel
            })}
          </span>
          <span className="fingerprint-dialog-note-list">
            <span>{t("fingerprint.note1")}</span>
            <span>{t("fingerprint.note2")}</span>
          </span>
        </span>
      }
      footer={
        <>
          <Button onClick={onCancel} variant="secondary">
            {t("fingerprint.cancel")}
          </Button>
          <Button disabled={submitting} onClick={onConfirm} variant="primary">
            {submitting ? t("fingerprint.confirming") : t("fingerprint.confirm")}
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
      size="lg"
      title={t("fingerprint.title")}
    >
      <div className="result-card result-card-warning">
        <strong>{pendingRequest.conflict.message}</strong>
        <dl className="detail-list">
          <div>
            <dt>{t("fingerprint.currentAlgorithm")}</dt>
            <dd>{pendingRequest.conflict.current_fingerprint.algorithm}</dd>
          </div>
          <div>
            <dt>{t("fingerprint.currentFingerprint")}</dt>
            <dd className="mono-wrap">{pendingRequest.conflict.current_fingerprint.fingerprint}</dd>
          </div>
          <div>
            <dt>{t("fingerprint.currentStatus")}</dt>
            <dd>{pendingRequest.conflict.current_fingerprint.status}</dd>
          </div>
          <div>
            <dt>{t("fingerprint.firstSeen")}</dt>
            <dd>{formatDateTime(pendingRequest.conflict.current_fingerprint.first_seen_at, language, t("common.notRecorded"))}</dd>
          </div>
          <div>
            <dt>{t("fingerprint.lastVerified")}</dt>
            <dd>{formatDateTime(pendingRequest.conflict.current_fingerprint.last_verified_at, language, t("common.notRecorded"))}</dd>
          </div>
          <div>
            <dt>{t("fingerprint.previousFingerprint")}</dt>
            <dd className="mono-wrap">
              {pendingRequest.conflict.previous_fingerprint
                ? `${pendingRequest.conflict.previous_fingerprint.algorithm} / ${pendingRequest.conflict.previous_fingerprint.fingerprint}`
                : t("common.none")}
            </dd>
          </div>
        </dl>
      </div>
    </Dialog>
  );
}
