import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  emptySavedCommandForm,
  TerminalSavedCommandsDialog,
  type SavedCommandDialogMode,
  type SavedCommandForm
} from "./TerminalSavedCommandsDialog";
import type { SavedCommand } from "../savedCommands/types";

const labels: Record<string, string> = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "terminal.savedCommandAdd": "Add command",
  "terminal.savedCommandCategory": "Category",
  "terminal.savedCommandCategoryAll": "All categories",
  "terminal.savedCommandCategoryFilter": "Category filter",
  "terminal.savedCommandCopy": "Copy",
  "terminal.savedCommandCreate": "Create command",
  "terminal.savedCommandCreateTitle": "Add command",
  "terminal.savedCommandDescription": "Description",
  "terminal.savedCommandEditTitle": "Edit command",
  "terminal.savedCommandHighRiskBadge": "High risk",
  "terminal.savedCommandHighRiskHint": "Contains a command that could affect the remote system",
  "terminal.savedCommandName": "Name",
  "terminal.savedCommandSaveChanges": "Save changes",
  "terminal.savedCommandSend": "Send to active terminal",
  "terminal.savedCommandSendNoTerminal": "Open a connected terminal first",
  "terminal.savedCommandText": "Command",
  "terminal.savedCommandsEmpty": "No saved commands yet.",
  "terminal.savedCommandsFilterEmpty": "No saved commands in this category.",
  "terminal.savedCommandsLoading": "Loading saved commands...",
  "terminal.savedCommandsTitle": "Saved commands"
};

function t(key: string) {
  return labels[key] || key;
}

const commands: SavedCommand[] = [
  {
    id: "command-1",
    user_id: "user-1",
    name: "Check disk",
    command_text: "df -h",
    category: "Filesystem",
    description: "Disk usage",
    sort_order: 0,
    created_at: "2026-05-11T10:00:00Z",
    updated_at: "2026-05-11T10:00:00Z"
  },
  {
    id: "command-2",
    user_id: "user-1",
    name: "Remove temp",
    command_text: "rm -rf /tmp/demo",
    category: "Danger",
    description: "Cleanup",
    sort_order: 1,
    created_at: "2026-05-11T10:00:00Z",
    updated_at: "2026-05-11T10:00:00Z"
  }
];

function ListHarness({
  canSendToActiveTerminal = false,
  commandsList = commands,
  loading = false,
  onCopy = vi.fn(),
  onDelete = vi.fn(),
  onEdit = vi.fn(),
  onSend = vi.fn()
}: {
  canSendToActiveTerminal?: boolean;
  commandsList?: SavedCommand[];
  loading?: boolean;
  onCopy?: (command: SavedCommand) => void;
  onDelete?: (command: SavedCommand) => void;
  onEdit?: (command: SavedCommand) => void;
  onSend?: (command: SavedCommand) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState("");
  const categories = ["Danger", "Filesystem"];
  const visibleCommands = categoryFilter
    ? commandsList.filter((command) => command.category === categoryFilter)
    : commandsList;

  return (
    <TerminalSavedCommandsDialog
      canSendToActiveTerminal={canSendToActiveTerminal}
      categories={categories}
      categoryFilter={categoryFilter}
      commands={commandsList}
      copiedCommandId="command-1"
      draggingId={null}
      dropTargetId={null}
      form={null}
      isHighRiskCommand={(value) => value.includes("rm -rf")}
      loading={loading}
      mode="list"
      onBeginCreate={vi.fn()}
      onCancelForm={vi.fn()}
      onCategoryFilterChange={setCategoryFilter}
      onCopy={onCopy}
      onDelete={onDelete}
      onDragEnd={vi.fn()}
      onDragOver={vi.fn()}
      onDragStart={vi.fn()}
      onDrop={vi.fn()}
      onEdit={onEdit}
      onFormChange={vi.fn()}
      onOpenChange={vi.fn()}
      onSend={onSend}
      onSubmit={vi.fn()}
      open
      reordering={false}
      submitting={false}
      t={t}
      visibleCommands={visibleCommands}
    />
  );
}

function FormHarness({
  mode = "create",
  onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault())
}: {
  mode?: SavedCommandDialogMode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [form, setForm] = useState<SavedCommandForm | null>({ ...emptySavedCommandForm });

  return (
    <TerminalSavedCommandsDialog
      canSendToActiveTerminal
      categories={["Filesystem"]}
      categoryFilter=""
      commands={[]}
      copiedCommandId={null}
      draggingId={null}
      dropTargetId={null}
      form={form}
      isHighRiskCommand={() => false}
      loading={false}
      mode={mode}
      onBeginCreate={vi.fn()}
      onCancelForm={vi.fn()}
      onCategoryFilterChange={vi.fn()}
      onCopy={vi.fn()}
      onDelete={vi.fn()}
      onDragEnd={vi.fn()}
      onDragOver={vi.fn()}
      onDragStart={vi.fn()}
      onDrop={vi.fn()}
      onEdit={vi.fn()}
      onFormChange={setForm}
      onOpenChange={vi.fn()}
      onSend={vi.fn()}
      onSubmit={onSubmit}
      open
      reordering={false}
      submitting={false}
      t={t}
      visibleCommands={[]}
    />
  );
}

describe("TerminalSavedCommandsDialog", () => {
  it("renders saved commands, filters categories, and delegates row actions", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    const onSend = vi.fn();

    render(
      <ListHarness
        onCopy={onCopy}
        onDelete={onDelete}
        onEdit={onEdit}
        onSend={onSend}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Saved commands" });
    expect(within(dialog).getByText("Check disk")).toBeInTheDocument();
    expect(within(dialog).getByText("Remove temp")).toBeInTheDocument();
    expect(within(dialog).getByText("High risk").closest(".ui-badge")).toBeInTheDocument();
    expect(within(dialog).queryByText("High risk")?.closest(".terminal-command-risk-badge")).toBeNull();

    const diskItem = within(dialog).getByText("Check disk").closest(".terminal-command-item") as HTMLElement;
    await user.click(within(diskItem).getByRole("button", { name: "Copy" }));
    await user.click(within(diskItem).getByRole("button", { name: "Edit" }));
    await user.click(within(diskItem).getByRole("button", { name: "Delete" }));
    await user.click(within(diskItem).getByRole("button", { name: "Send to active terminal" }));

    expect(onCopy).toHaveBeenCalledWith(commands[0]);
    expect(onEdit).toHaveBeenCalledWith(commands[0]);
    expect(onDelete).toHaveBeenCalledWith(commands[0]);
    expect(onSend).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Filesystem" }));
    expect(within(dialog).getByText("Check disk")).toBeInTheDocument();
    expect(within(dialog).queryByText("Remove temp")).not.toBeInTheDocument();
  });

  it("renders an editable create form and delegates submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(<FormHarness onSubmit={onSubmit} />);

    const dialog = screen.getByRole("dialog", { name: "Add command" });
    expect(within(dialog).getByLabelText("Name").closest(".ui-card")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name").closest(".terminal-command-form-card")).toBeNull();
    await user.type(within(dialog).getByLabelText("Name"), "Show processes");
    await user.type(within(dialog).getByLabelText("Category"), "System");
    await user.type(within(dialog).getByLabelText("Command"), "ps aux");
    await user.type(within(dialog).getByLabelText("Description"), "Process list");

    expect(within(dialog).getByDisplayValue("Show processes")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("ps aux")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create command" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("uses shared loading and empty states for the list", () => {
    const { rerender } = render(<ListHarness commandsList={[]} loading />);
    let dialog = screen.getByRole("dialog", { name: "Saved commands" });

    expect(within(dialog).getByRole("status", { name: "Loading saved commands..." })).toHaveClass("ui-loading-state");

    rerender(<ListHarness commandsList={[]} />);
    dialog = screen.getByRole("dialog", { name: "Saved commands" });

    expect(within(dialog).getByText("No saved commands yet.").closest(".ui-empty-state")).toBeInTheDocument();
    expect(within(dialog).queryByText("No saved commands yet.")?.closest(".terminal-command-empty")).toBeNull();
  });
});
