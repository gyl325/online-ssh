import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  TerminalAiCommandDialog,
  type TerminalAiCommandDraft,
  type TerminalAiCommandUnsupported
} from "./TerminalAiCommandDialog";

const labels: Record<string, string> = {
  "common.close": "Close",
  "terminal.ai.title": "AI command assistant",
  "terminal.ai.promptLabel": "What do you want to do?",
  "terminal.ai.promptPlaceholder": "Describe the command",
  "terminal.ai.systemInfoHint": "Send host system details",
  "terminal.ai.systemInfoUnavailable": "Open a terminal first",
  "terminal.ai.systemInfoToggle": "Send system info",
  "terminal.ai.generating": "Generating...",
  "terminal.ai.generate": "Generate command",
  "terminal.ai.rawTitle": "Model raw output",
  "terminal.ai.rawHint": "The response could not be parsed.",
  "terminal.ai.unsupportedTitle": "Unable to generate a terminal command",
  "terminal.ai.risk.low": "Low risk",
  "terminal.ai.risk.medium": "Medium risk",
  "terminal.ai.risk.high": "High risk",
  "terminal.savedCommandName": "Name",
  "terminal.savedCommandCategory": "Category",
  "terminal.savedCommandText": "Command",
  "terminal.savedCommandDescription": "Description",
  "terminal.ai.importing": "Importing...",
  "terminal.ai.import": "Import to saved commands",
  "terminal.ai.writeToTerminal": "Write to terminal"
};

function t(key: string) {
  return labels[key] || key;
}

function DialogHarness({
  draft,
  rawResponse = null,
  unsupported = null,
  canSendToActiveTerminal = true,
  systemInfoAvailable = true,
  onImport = vi.fn(),
  onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault()),
  onWrite = vi.fn()
}: {
  draft: TerminalAiCommandDraft | null;
  rawResponse?: string | null;
  unsupported?: TerminalAiCommandUnsupported | null;
  canSendToActiveTerminal?: boolean;
  systemInfoAvailable?: boolean;
  onImport?: () => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onWrite?: () => void;
}) {
  const [prompt, setPrompt] = useState("show logs");
  const [includeSystemInfo, setIncludeSystemInfo] = useState(false);
  const [currentDraft, setCurrentDraft] = useState(draft);

  return (
    <TerminalAiCommandDialog
      canSendToActiveTerminal={canSendToActiveTerminal}
      description="Prod SSH"
      draft={currentDraft}
      error={null}
      generating={false}
      importing={false}
      includeSystemInfo={includeSystemInfo}
      message={null}
      onDraftChange={setCurrentDraft}
      onImport={onImport}
      onIncludeSystemInfoChange={setIncludeSystemInfo}
      onOpenChange={vi.fn()}
      onPromptChange={setPrompt}
      onSubmit={onSubmit}
      onWriteToTerminal={onWrite}
      open
      prompt={prompt}
      rawResponse={rawResponse}
      systemInfoAvailable={systemInfoAvailable}
      t={t}
      unsupported={unsupported}
    />
  );
}

describe("TerminalAiCommandDialog", () => {
  it("renders editable generated command results and delegates actions", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const onWrite = vi.fn();
    render(
      <DialogHarness
        draft={{
          name: "List logs",
          command_text: "find /var/log -type f",
          category: "Logs",
          description: "Find log files",
          risk_level: "medium",
          notes: ["Review the path before running."]
        }}
        onImport={onImport}
        onWrite={onWrite}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "AI command assistant" });
    expect(within(dialog).getByText("Medium risk")).toBeInTheDocument();
    expect(within(dialog).getByText("Review the path before running.")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Command"));
    await user.type(within(dialog).getByLabelText("Command"), "tail -n 100 /var/log/syslog");

    expect(within(dialog).getByDisplayValue("tail -n 100 /var/log/syslog")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Import to saved commands" }));
    await user.click(within(dialog).getByRole("button", { name: "Write to terminal" }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("uses shared surfaces and badges for generated command results", () => {
    render(
      <DialogHarness
        draft={{
          name: "List logs",
          command_text: "find /var/log -type f",
          category: "Logs",
          description: "Find log files",
          risk_level: "medium",
          notes: ["Review the path before running.", "Use a narrower directory when possible."]
        }}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "AI command assistant" });
    const promptSurface = within(dialog).getByLabelText("What do you want to do?").closest(".ui-card");
    const resultSurface = within(dialog).getByLabelText("Command").closest(".ui-card");
    const riskBadge = within(dialog).getByText("Medium risk");
    const note = within(dialog).getByText("Review the path before running.");
    const notesList = note.closest(".terminal-ai-note-list");

    expect(promptSurface).not.toBeNull();
    expect(resultSurface).not.toBeNull();
    expect(riskBadge).toHaveClass("ui-badge", "ui-badge-warning");
    expect(notesList?.tagName).toBe("UL");
    expect(within(notesList as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
    expect(note.closest(".ui-inline-note")).toBeNull();

    expect(within(dialog).getByLabelText("What do you want to do?").closest(".terminal-ai-prompt-card")).toBeNull();
    expect(within(dialog).getByLabelText("Command").closest(".terminal-ai-result-card")).toBeNull();
    expect(riskBadge).not.toHaveClass("terminal-ai-risk");
    expect(note.closest(".terminal-ai-notes")).toBeNull();
  });

  it("keeps unsupported or raw responses read-only without command actions", () => {
    render(
      <DialogHarness
        draft={null}
        rawResponse="You can inspect memory with ps aux."
        unsupported={{
          message: "This request is not about generating a terminal command.",
          suggestedPrompt: "Describe the operation you want to perform in a terminal."
        }}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "AI command assistant" });

    expect(within(dialog).getByText("Model raw output")).toBeInTheDocument();
    expect(within(dialog).getByText(/ps aux/)).toBeInTheDocument();
    expect(within(dialog).getByText("Unable to generate a terminal command")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Command")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Import to saved commands" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Write to terminal" })).not.toBeInTheDocument();

    expect(within(dialog).getByText("Model raw output").closest(".ui-card")).not.toBeNull();
    expect(within(dialog).getByText("Unable to generate a terminal command").closest(".ui-card")).not.toBeNull();
    expect(within(dialog).getByText("Model raw output").closest(".terminal-ai-raw-card")).toBeNull();
    expect(within(dialog).getByText("Unable to generate a terminal command").closest(".terminal-ai-refusal-card")).toBeNull();
  });

  it("disables system-info opt-in when there is no active host context", () => {
    render(<DialogHarness draft={null} systemInfoAvailable={false} />);

    expect(screen.getByRole("checkbox", { name: "Send system info" })).toBeDisabled();
  });
});
