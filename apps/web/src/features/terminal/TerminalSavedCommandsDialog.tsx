import type { Dispatch, DragEvent, FormEvent, SetStateAction } from "react";
import { Check, Copy, Edit3, Plus, Send, Trash2 } from "lucide-react";

import { Badge, Button, Card, Dialog, EmptyState, FilterChip, FormField, IconButton, LoadingState, TextareaInput, TextInput } from "../../shared/ui";
import type { SavedCommand } from "../savedCommands/types";

export type SavedCommandDialogMode = "list" | "create" | "edit";

export type SavedCommandForm = {
  id?: string;
  name: string;
  command_text: string;
  category: string;
  description: string;
};

export const emptySavedCommandForm: SavedCommandForm = {
  name: "",
  command_text: "",
  category: "",
  description: ""
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

type TerminalSavedCommandsDialogProps = {
  canSendToActiveTerminal: boolean;
  categories: string[];
  categoryFilter: string;
  commands: SavedCommand[];
  copiedCommandId: string | null;
  draggingId: string | null;
  dropTargetId: string | null;
  form: SavedCommandForm | null;
  isHighRiskCommand: (text: string) => boolean;
  loading: boolean;
  mode: SavedCommandDialogMode;
  onBeginCreate: () => void;
  onCancelForm: () => void;
  onCategoryFilterChange: (category: string) => void;
  onCopy: (command: SavedCommand) => void;
  onDelete: (command: SavedCommand) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, commandId: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, commandId: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, commandId: string) => void;
  onEdit: (command: SavedCommand) => void;
  onFormChange: Dispatch<SetStateAction<SavedCommandForm | null>>;
  onOpenChange: (open: boolean) => void;
  onSend: (command: SavedCommand) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  open: boolean;
  reordering: boolean;
  submitting: boolean;
  t: Translate;
  visibleCommands: SavedCommand[];
};

function dialogTitle(mode: SavedCommandDialogMode, t: Translate) {
  switch (mode) {
    case "create":
      return t("terminal.savedCommandCreateTitle");
    case "edit":
      return t("terminal.savedCommandEditTitle");
    default:
      return t("terminal.savedCommandsTitle");
  }
}

export function TerminalSavedCommandsDialog({
  canSendToActiveTerminal,
  categories,
  categoryFilter,
  commands,
  copiedCommandId,
  draggingId,
  dropTargetId,
  form,
  isHighRiskCommand,
  loading,
  mode,
  onBeginCreate,
  onCancelForm,
  onCategoryFilterChange,
  onCopy,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onEdit,
  onFormChange,
  onOpenChange,
  onSend,
  onSubmit,
  open,
  reordering,
  submitting,
  t,
  visibleCommands
}: TerminalSavedCommandsDialogProps) {
  const showingForm = form && (mode === "create" || mode === "edit");

  return (
    <Dialog
      closeLabel={t("common.close")}
      headerActions={
        mode === "list" ? (
          <IconButton
            className="saved-command-add-button"
            label={t("terminal.savedCommandAdd")}
            onClick={onBeginCreate}
            variant="ghost"
          >
            <Plus aria-hidden="true" />
          </IconButton>
        ) : null
      }
      onOpenChange={onOpenChange}
      open={open}
      size="md"
      title={dialogTitle(mode, t)}
    >
      <div className="saved-command-dialog-body">
        {showingForm ? (
          <Card density="sm">
            <form className="terminal-command-form" onSubmit={onSubmit}>
              <FormField label={t("terminal.savedCommandName")}>
                {(id) => (
                  <TextInput
                    id={id}
                    maxLength={120}
                    onChange={(event) => onFormChange((current) => current ? { ...current, name: event.target.value } : current)}
                    required
                    value={form.name}
                  />
                )}
              </FormField>
              <FormField label={t("terminal.savedCommandCategory")}>
                {(id) => (
                  <>
                    <TextInput
                      id={id}
                      list="saved-command-categories"
                      maxLength={80}
                      onChange={(event) => onFormChange((current) => current ? { ...current, category: event.target.value } : current)}
                      value={form.category}
                    />
                    <datalist id="saved-command-categories">
                      {categories.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                  </>
                )}
              </FormField>
              <FormField className="terminal-command-form-command" label={t("terminal.savedCommandText")}>
                {(id) => (
                  <TextareaInput
                    id={id}
                    onChange={(event) => onFormChange((current) => current ? { ...current, command_text: event.target.value } : current)}
                    required
                    rows={2}
                    value={form.command_text}
                  />
                )}
              </FormField>
              <FormField label={t("terminal.savedCommandDescription")}>
                {(id) => (
                  <TextInput
                    id={id}
                    maxLength={500}
                    onChange={(event) => onFormChange((current) => current ? { ...current, description: event.target.value } : current)}
                    value={form.description}
                  />
                )}
              </FormField>
              <div className="terminal-command-form-actions">
                <Button onClick={onCancelForm} size="sm" variant="secondary">
                  {t("common.cancel")}
                </Button>
                <Button disabled={submitting} size="sm" type="submit" variant="primary">
                  {mode === "edit" ? t("terminal.savedCommandSaveChanges") : t("terminal.savedCommandCreate")}
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        {mode === "list" ? (
          <>
            {loading ? <LoadingState label={t("terminal.savedCommandsLoading")} /> : null}
            {!loading && commands.length === 0 ? (
              <EmptyState title={t("terminal.savedCommandsEmpty")} />
            ) : null}
            {commands.length > 0 ? (
              <div className="terminal-command-filter-row" aria-label={t("terminal.savedCommandCategoryFilter")}>
                <span className="terminal-command-filter-label">{t("terminal.savedCommandCategoryFilter")}</span>
                <div className="terminal-command-category-chips">
                  <FilterChip
                    active={!categoryFilter}
                    onClick={() => onCategoryFilterChange("")}
                    size="sm"
                  >
                    {t("terminal.savedCommandCategoryAll")}
                  </FilterChip>
                  {categories.map((category) => (
                    <FilterChip
                      active={categoryFilter === category}
                      key={category}
                      onClick={() => onCategoryFilterChange(category)}
                      size="sm"
                    >
                      {category}
                    </FilterChip>
                  ))}
                </div>
              </div>
            ) : null}
            {!loading && commands.length > 0 && visibleCommands.length === 0 ? (
              <EmptyState title={t("terminal.savedCommandsFilterEmpty")} />
            ) : null}
            {visibleCommands.length > 0 ? (
              <div className={`terminal-command-list ${reordering ? "terminal-command-list-reordering" : ""}`}>
                {visibleCommands.map((command) => (
                  <article
                    className={[
                      "terminal-command-item",
                      draggingId === command.id ? "terminal-command-item-dragging" : "",
                      dropTargetId === command.id ? "terminal-command-item-drop-target" : ""
                    ].filter(Boolean).join(" ")}
                    draggable={!categoryFilter}
                    key={command.id}
                    onDragStart={(event) => onDragStart(event, command.id)}
                    onDragOver={(event) => onDragOver(event, command.id)}
                    onDragEnd={onDragEnd}
                    onDrop={(event) => onDrop(event, command.id)}
                  >
                    <span className="terminal-command-drag-handle" aria-hidden="true">⠿</span>
                    <div className="terminal-command-item-body">
                      <div className="terminal-command-item-top">
                        <strong>{command.name}</strong>
                        {command.category ? <span className="terminal-command-category">{command.category}</span> : null}
                        {isHighRiskCommand(command.command_text) ? (
                          <Badge appearance="outline" tone="danger" title={t("terminal.savedCommandHighRiskHint")}>
                            {t("terminal.savedCommandHighRiskBadge")}
                          </Badge>
                        ) : null}
                        {command.description ? <span className="terminal-command-desc">{command.description}</span> : null}
                      </div>
                      <code>{command.command_text}</code>
                    </div>
                    <div className="terminal-command-actions">
                      <IconButton
                        className="ui-inline-icon-button ui-inline-icon-button-send"
                        disabled={!canSendToActiveTerminal}
                        label={t("terminal.savedCommandSend")}
                        onClick={() => onSend(command)}
                        title={canSendToActiveTerminal ? t("terminal.savedCommandSend") : t("terminal.savedCommandSendNoTerminal")}
                        variant="ghost"
                      >
                        <Send aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        className={`ui-inline-icon-button ${copiedCommandId === command.id ? "ui-inline-icon-button-copied" : ""}`}
                        label={t("terminal.savedCommandCopy")}
                        onClick={() => onCopy(command)}
                        title={t("terminal.savedCommandCopy")}
                        variant="ghost"
                      >
                        {copiedCommandId === command.id ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                      </IconButton>
                      <IconButton className="ui-inline-icon-button" label={t("common.edit")} onClick={() => onEdit(command)} variant="ghost">
                        <Edit3 aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        className="ui-inline-icon-button ui-inline-icon-button-danger"
                        label={t("common.delete")}
                        onClick={() => onDelete(command)}
                        variant="danger"
                      >
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
