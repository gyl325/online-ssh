import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Send, Sparkles } from "lucide-react";

import { Badge, Button, Card, Dialog, FormField, TextareaInput, TextInput } from "../../shared/ui";
import type { TerminalCommandAssistantResult } from "./types";

export type TerminalAiCommandDraft = {
  name: string;
  command_text: string;
  category: string;
  description: string;
  risk_level: TerminalCommandAssistantResult["risk_level"];
  notes: string[];
};

export type TerminalAiCommandUnsupported = {
  message: string;
  suggestedPrompt: string;
};

type TerminalAiCommandDialogProps = {
  canSendToActiveTerminal: boolean;
  description?: string;
  draft: TerminalAiCommandDraft | null;
  error: string | null;
  generating: boolean;
  importing: boolean;
  includeSystemInfo: boolean;
  message: string | null;
  onDraftChange: Dispatch<SetStateAction<TerminalAiCommandDraft | null>>;
  onImport: () => void;
  onIncludeSystemInfoChange: (checked: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onWriteToTerminal: () => void;
  open: boolean;
  prompt: string;
  rawResponse: string | null;
  systemInfoAvailable: boolean;
  t: (key: string) => string;
  unsupported: TerminalAiCommandUnsupported | null;
};

function riskBadgeTone(riskLevel: TerminalCommandAssistantResult["risk_level"]) {
  if (riskLevel === "low") {
    return "success";
  }
  if (riskLevel === "medium") {
    return "warning";
  }
  return "danger";
}

export function TerminalAiCommandDialog({
  canSendToActiveTerminal,
  description,
  draft,
  error,
  generating,
  importing,
  includeSystemInfo,
  message,
  onDraftChange,
  onImport,
  onIncludeSystemInfoChange,
  onOpenChange,
  onPromptChange,
  onSubmit,
  onWriteToTerminal,
  open,
  prompt,
  rawResponse,
  systemInfoAvailable,
  t,
  unsupported
}: TerminalAiCommandDialogProps) {
  return (
    <Dialog
      closeLabel={t("common.close")}
      description={description}
      onOpenChange={onOpenChange}
      open={open}
      size="md"
      title={t("terminal.ai.title")}
    >
      <div className="terminal-ai-dialog-body">
        <Card density="sm">
          <form className="terminal-ai-prompt-form" onSubmit={onSubmit}>
            <FormField label={t("terminal.ai.promptLabel")}>
              {(id) => (
                <TextareaInput
                  id={id}
                  maxLength={1000}
                  onChange={(event) => onPromptChange(event.target.value)}
                  placeholder={t("terminal.ai.promptPlaceholder")}
                  required
                  rows={3}
                  value={prompt}
                />
              )}
            </FormField>
            <div className="terminal-ai-prompt-actions">
              <label
                className="terminal-ai-system-toggle"
                title={systemInfoAvailable ? t("terminal.ai.systemInfoHint") : t("terminal.ai.systemInfoUnavailable")}
              >
                <input
                  checked={includeSystemInfo}
                  disabled={!systemInfoAvailable || generating}
                  onChange={(event) => onIncludeSystemInfoChange(event.target.checked)}
                  type="checkbox"
                />
                <span>{t("terminal.ai.systemInfoToggle")}</span>
              </label>
              <Button disabled={generating} leadingIcon={<Sparkles aria-hidden="true" />} size="sm" type="submit" variant="primary">
                {generating ? t("terminal.ai.generating") : t("terminal.ai.generate")}
              </Button>
            </div>
          </form>
        </Card>

        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        {message ? <p className="inline-success">{message}</p> : null}

        {rawResponse ? (
          <Card className="terminal-ai-raw" density="sm" description={t("terminal.ai.rawHint")} title={t("terminal.ai.rawTitle")}>
            <pre>{rawResponse}</pre>
          </Card>
        ) : null}

        {unsupported ? (
          <Card className="terminal-ai-refusal" density="sm" title={t("terminal.ai.unsupportedTitle")}>
            <p>{unsupported.message}</p>
            {unsupported.suggestedPrompt ? <span>{unsupported.suggestedPrompt}</span> : null}
          </Card>
        ) : null}

        {draft ? (
          <Card
            actions={
              <Badge tone={riskBadgeTone(draft.risk_level)}>
                {t(`terminal.ai.risk.${draft.risk_level}`)}
              </Badge>
            }
            density="sm"
          >
            <div className="terminal-ai-result-form">
              <FormField label={t("terminal.savedCommandName")}>
                {(id) => (
                  <TextInput
                    id={id}
                    maxLength={120}
                    onChange={(event) => onDraftChange((current) => current ? { ...current, name: event.target.value } : current)}
                    required
                    value={draft.name}
                  />
                )}
              </FormField>
              <FormField label={t("terminal.savedCommandCategory")}>
                {(id) => (
                  <TextInput
                    id={id}
                    list="saved-command-categories"
                    maxLength={80}
                    onChange={(event) => onDraftChange((current) => current ? { ...current, category: event.target.value } : current)}
                    value={draft.category}
                  />
                )}
              </FormField>
              <FormField className="terminal-command-form-command" label={t("terminal.savedCommandText")}>
                {(id) => (
                  <TextareaInput
                    id={id}
                    onChange={(event) => onDraftChange((current) => current ? { ...current, command_text: event.target.value } : current)}
                    required
                    rows={2}
                    value={draft.command_text}
                  />
                )}
              </FormField>
              <FormField label={t("terminal.savedCommandDescription")}>
                {(id) => (
                  <TextInput
                    id={id}
                    maxLength={500}
                    onChange={(event) => onDraftChange((current) => current ? { ...current, description: event.target.value } : current)}
                    value={draft.description}
                  />
                )}
              </FormField>
            </div>
            {draft.notes.length > 0 ? (
              <ul className="terminal-ai-note-list">
                {draft.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
            <div className="terminal-ai-result-actions">
              <Button
                disabled={importing || !draft.name.trim() || !draft.command_text.trim()}
                onClick={() => void onImport()}
                size="sm"
                variant="secondary"
              >
                {importing ? t("terminal.ai.importing") : t("terminal.ai.import")}
              </Button>
              <Button
                disabled={!canSendToActiveTerminal || !draft.command_text.trim()}
                leadingIcon={<Send aria-hidden="true" />}
                onClick={() => void onWriteToTerminal()}
                size="sm"
                variant="primary"
              >
                {t("terminal.ai.writeToTerminal")}
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </Dialog>
  );
}
