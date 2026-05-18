import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TerminalWorkspaceHeader } from "./TerminalWorkspaceHeader";

describe("TerminalWorkspaceHeader", () => {
  it("renders the workspace actions and delegates clicks without owning route state", async () => {
    const user = userEvent.setup();
    const onOpenAiCommand = vi.fn();
    const onOpenHistory = vi.fn();
    const onOpenSavedCommands = vi.fn();

    render(
      <TerminalWorkspaceHeader
        aiCommandLabel="AI command"
        historyLabel="Terminal history"
        onOpenAiCommand={onOpenAiCommand}
        onOpenHistory={onOpenHistory}
        onOpenSavedCommands={onOpenSavedCommands}
        savedCommandsCount={3}
        savedCommandsLabel="Saved commands"
        title="Terminal"
      />
    );

    expect(screen.getByRole("heading", { name: "Terminal" })).toBeInTheDocument();
    const actions = screen.getByRole("group", { name: "Terminal actions" });
    expect(within(actions).getByRole("button", { name: "AI command" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: /Saved commands/ })).toHaveTextContent("3");
    expect(within(actions).getByRole("button", { name: "Terminal history" })).toBeInTheDocument();

    await user.click(within(actions).getByRole("button", { name: "AI command" }));
    await user.click(within(actions).getByRole("button", { name: /Saved commands/ }));
    await user.click(within(actions).getByRole("button", { name: "Terminal history" }));

    expect(onOpenAiCommand).toHaveBeenCalledTimes(1);
    expect(onOpenSavedCommands).toHaveBeenCalledTimes(1);
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("hides the saved command count when there are no saved commands", () => {
    render(
      <TerminalWorkspaceHeader
        aiCommandLabel="AI command"
        historyLabel="Terminal history"
        onOpenAiCommand={vi.fn()}
        onOpenHistory={vi.fn()}
        onOpenSavedCommands={vi.fn()}
        savedCommandsCount={0}
        savedCommandsLabel="Saved commands"
        title="Terminal"
      />
    );

    const savedCommandsButton = screen.getByRole("button", { name: "Saved commands" });
    expect(savedCommandsButton.querySelector(".terminal-command-badge")).toBeNull();
  });
});
