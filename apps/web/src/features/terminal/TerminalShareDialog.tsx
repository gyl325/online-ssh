import type { FormEvent } from "react";
import { Clock3, Copy, RotateCw, Share2, ShieldCheck, Users } from "lucide-react";

import { Badge, Button, Card, Dialog, FormField, IconButton, InlineNote, PasswordInput, TextareaInput, TextInput } from "../../shared/ui";
import type { TerminalShare, TerminalShareAccessLog } from "./types";

export type TerminalShareForm = {
  expiresInMinutes: string;
  maxAccesses: string;
  password: string;
  sensitivePrompt: string;
};

export type TerminalShareFormErrors = Partial<Record<keyof TerminalShareForm, string>>;

export const minTerminalShareDurationMinutes = 2;
export const maxTerminalShareDurationMinutes = 1440;
export const maxTerminalShareAccesses = 1000;
export const maxTerminalSharePasswordLength = 128;
export const maxTerminalShareSensitivePromptLength = 500;

export const defaultTerminalShareForm: TerminalShareForm = {
  expiresInMinutes: "10",
  maxAccesses: "5",
  password: "",
  sensitivePrompt: ""
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

type TerminalShareDialogProps = {
  accessLogs: TerminalShareAccessLog[];
  description?: string;
  fieldErrors: TerminalShareFormErrors;
  finalMinute: boolean;
  form: TerminalShareForm;
  formatDateTime: (value: string) => string;
  logsLoading: boolean;
  onClose: () => void;
  onCopyLink: (url: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onExtend: (share: TerminalShare, expiresInMinutes: number) => void;
  onFormFieldChange: (field: keyof TerminalShareForm, value: string) => void;
  onRefresh: () => void;
  onRevoke: (share: TerminalShare) => void;
  open: boolean;
  remainingText: string;
  share: TerminalShare | null;
  submitting: boolean;
  t: Translate;
};

function numericShareFieldValue(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function clampedNumericShareFieldValue(value: string, min: number, max: number, maxLength: number, allowEmpty = true) {
  const digits = numericShareFieldValue(value, maxLength);
  if (!digits) {
    return allowEmpty ? "" : String(min);
  }
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed)) {
    return String(max);
  }
  return String(Math.max(min, Math.min(max, parsed)));
}

function shareAccessResultLabel(log: TerminalShareAccessLog, t: Translate) {
  if (log.result === "success") {
    return t("terminal.share.accessSuccess");
  }
  switch (log.failure_reason) {
    case "invalid_password":
      return t("terminal.share.accessInvalidPassword");
    case "access_limit":
      return t("terminal.share.accessLimitReached");
    case "unavailable":
      return t("terminal.share.accessUnavailable");
    default:
      return t("terminal.share.accessFailed");
  }
}

export function TerminalShareDialog({
  accessLogs,
  description,
  fieldErrors,
  finalMinute,
  form,
  formatDateTime,
  logsLoading,
  onClose,
  onCopyLink,
  onCreate,
  onExtend,
  onFormFieldChange,
  onRefresh,
  onRevoke,
  open,
  remainingText,
  share,
  submitting,
  t
}: TerminalShareDialogProps) {
  return (
    <Dialog
      closeLabel={t("common.close")}
      description={description}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
      size="md"
      title={t("terminal.share.title")}
    >
      <div className="terminal-share-dialog">
        {share ? (
          <>
            <div className="terminal-share-dialog-toolbar">
              <div className="terminal-share-dialog-status-group">
                <Badge
                  aria-label={t("terminal.share.menuManage")}
                  tone="info"
                >
                  <Share2 aria-hidden="true" />
                  <span>{t("terminal.share.menuManage")}</span>
                </Badge>
                <Badge tone={share.password_required ? "warning" : "neutral"}>
                  <ShieldCheck aria-hidden="true" />
                  <span>
                    {share.password_required
                      ? t("terminal.share.passwordProtected")
                      : t("terminal.share.noPassword")}
                  </span>
                </Badge>
                <Badge tone={finalMinute ? "danger" : "info"}>
                  <Clock3 aria-hidden="true" />
                  <span>{remainingText}</span>
                </Badge>
              </div>
              <IconButton
                className="ui-inline-icon-button"
                label={t("terminal.share.refreshStatus")}
                onClick={() => onRefresh()}
                variant="ghost"
              >
                <RotateCw aria-hidden="true" />
              </IconButton>
            </div>
            <div className="terminal-share-summary">
              <Card className="terminal-share-metric-card" density="sm">
                <Users aria-hidden="true" />
                <span>{t("terminal.share.viewers", { count: share.viewer_count })}</span>
              </Card>
              <Card className="terminal-share-metric-card" density="sm">
                <Clock3 aria-hidden="true" />
                <span>{formatDateTime(share.expires_at)}</span>
              </Card>
              <Card className="terminal-share-metric-card" density="sm">
                <Share2 aria-hidden="true" />
                <span>
                  {share.max_accesses
                    ? t("terminal.share.accessUsage", {
                      count: share.access_count,
                      limit: share.max_accesses
                    })
                    : t("terminal.share.accessUnlimited", { count: share.access_count })}
                </span>
              </Card>
            </div>

            {share.url ? (
              <div className="terminal-share-link-row">
                <code>{share.url}</code>
                <Button
                  leadingIcon={<Copy aria-hidden="true" />}
                  onClick={() => onCopyLink(share.url || "")}
                  size="sm"
                  variant="secondary"
                >
                  {t("terminal.share.copyLink")}
                </Button>
              </div>
            ) : (
              <p className="terminal-share-muted">{t("terminal.share.linkUnavailable")}</p>
            )}

            {share.sensitive_prompt ? (
              <InlineNote tone="warning">{share.sensitive_prompt}</InlineNote>
            ) : null}

            <div className="terminal-share-actions">
              <Button
                disabled={submitting}
                leadingIcon={<Clock3 aria-hidden="true" />}
                onClick={() => onExtend(share, 10)}
                size="sm"
                variant="secondary"
              >
                {t("terminal.share.extend")}
              </Button>
              <Button
                disabled={submitting}
                onClick={() => onRevoke(share)}
                size="sm"
                variant="danger"
              >
                {t("terminal.share.revoke")}
              </Button>
            </div>

            <section className="terminal-share-access-log" aria-label={t("terminal.share.accessLogs")}>
              <div className="terminal-share-access-log-header">
                <strong>{t("terminal.share.accessLogs")}</strong>
                {logsLoading ? <span>{t("common.loading")}</span> : null}
              </div>
              {accessLogs.length > 0 ? (
                <ol>
                  {accessLogs.map((log) => (
                    <li key={log.id}>
                      <span>{shareAccessResultLabel(log, t)}</span>
                      <time dateTime={log.accessed_at}>{formatDateTime(log.accessed_at)}</time>
                    </li>
                  ))}
                </ol>
              ) : !logsLoading ? (
                <p>{t("terminal.share.noAccessLogs")}</p>
              ) : null}
            </section>
          </>
        ) : (
          <form className="terminal-share-form" noValidate onSubmit={onCreate}>
            <InlineNote tone="warning">
              {t("terminal.share.createWarning")}
            </InlineNote>
            <div className="terminal-share-form-row">
              <FormField label={t("terminal.share.expiresInMinutes")}>
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    min={minTerminalShareDurationMinutes}
                    max={maxTerminalShareDurationMinutes}
                    maxLength={4}
                    onChange={(event) => onFormFieldChange(
                      "expiresInMinutes",
                      clampedNumericShareFieldValue(
                        event.target.value,
                        minTerminalShareDurationMinutes,
                        maxTerminalShareDurationMinutes,
                        4
                      )
                    )}
                    required
                    step={1}
                    type="text"
                    value={form.expiresInMinutes}
                  />
                )}
              </FormField>
              <FormField label={t("terminal.share.accessLimit")}>
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    min={1}
                    max={maxTerminalShareAccesses}
                    maxLength={4}
                    onChange={(event) => onFormFieldChange(
                      "maxAccesses",
                      clampedNumericShareFieldValue(event.target.value, 1, maxTerminalShareAccesses, 4)
                    )}
                    step={1}
                    type="text"
                    value={form.maxAccesses}
                  />
                )}
              </FormField>
            </div>
            <FormField error={fieldErrors.password} label={t("terminal.share.password")}>
              {(id) => (
                <PasswordInput
                  aria-invalid={Boolean(fieldErrors.password)}
                  hideLabel={t("auth.hidePassword")}
                  id={id}
                  label={t("terminal.share.password")}
                  maxLength={maxTerminalSharePasswordLength}
                  onChange={(event) => onFormFieldChange("password", event.target.value)}
                  showLabel={t("auth.showPassword")}
                  value={form.password}
                />
              )}
            </FormField>
            <FormField error={fieldErrors.sensitivePrompt} label={t("terminal.share.sensitivePrompt")}>
              {(id) => (
                <TextareaInput
                  aria-invalid={Boolean(fieldErrors.sensitivePrompt)}
                  id={id}
                  maxLength={maxTerminalShareSensitivePromptLength}
                  onChange={(event) => onFormFieldChange("sensitivePrompt", event.target.value)}
                  rows={2}
                  value={form.sensitivePrompt}
                />
              )}
            </FormField>
            <div className="terminal-share-actions">
              <Button onClick={onClose} size="sm" type="button" variant="secondary">
                {t("common.cancel")}
              </Button>
              <Button disabled={submitting} size="sm" type="submit" variant="primary">
                {submitting ? t("common.saving") : t("terminal.share.create")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
