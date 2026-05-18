import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedCommand } from "../savedCommands/types";
import { useSavedCommandActions } from "./useSavedCommandActions";

type TerminalTabLike = {
  id: string;
  hostLabel: string;
  status: "connected" | "connecting" | "disconnected" | "failed" | "reconnecting";
};

type TerminalPaneHandleLike = {
  sendInput: (text: string) => boolean;
};

const t = (key: string) => key;

describe("useSavedCommandActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies a saved command and clears the copied state after the timeout", async () => {
    const copyTextToClipboard = vi.fn().mockResolvedValue(true);
    const setCopiedCommandId = vi.fn();
    const setSavedCommandError = vi.fn();
    const setSavedCommandMessage = vi.fn();
    const setSavedCommandsDialogOpen = vi.fn();
    const toast = {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    };

    const { result } = renderHook(() =>
      useSavedCommandActions({
        activeTabId: null,
        broadcastInputToWorkspacePeers: vi.fn(),
        confirmDialog: {
          requestConfirmation: vi.fn()
        },
        copyTextToClipboard,
        isHighRiskCommand: vi.fn(),
        paneRefs: { current: new Map<string, TerminalPaneHandleLike | null>() },
        setCopiedCommandId,
        setSavedCommandError,
        setSavedCommandMessage,
        setSavedCommandsDialogOpen,
        tabsRef: { current: [] as TerminalTabLike[] },
        t,
        toast
      })
    );

    const command: SavedCommand = {
      id: "command-1",
      user_id: "user-1",
      name: "Check disk",
      command_text: "df -h",
      category: null,
      description: null,
      sort_order: 0,
      created_at: "2026-05-12T00:00:00Z",
      updated_at: "2026-05-12T00:00:00Z"
    };

    await act(async () => {
      await result.current.copySavedCommand(command);
    });

    expect(copyTextToClipboard).toHaveBeenCalledWith("df -h");
    expect(setSavedCommandError).toHaveBeenCalledWith(null);
    expect(setSavedCommandMessage).toHaveBeenCalledWith(null);
    expect(setCopiedCommandId).toHaveBeenCalledWith("command-1");
    expect(toast.success).toHaveBeenCalledWith("terminal.savedCommandCopied");

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(setCopiedCommandId).toHaveBeenCalledWith(null);
    expect(setSavedCommandsDialogOpen).not.toHaveBeenCalled();
  });

  it("sends a saved command to the active terminal and closes the dialog", async () => {
    const confirmDialog = {
      requestConfirmation: vi.fn().mockResolvedValue(true)
    };
    const sendInput = vi.fn().mockReturnValue(true);
    const broadcastInputToWorkspacePeers = vi.fn();
    const setCopiedCommandId = vi.fn();
    const setSavedCommandError = vi.fn();
    const setSavedCommandMessage = vi.fn();
    const setSavedCommandsDialogOpen = vi.fn();
    const toast = {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn()
    };
    const tabsRef = {
      current: [
        {
          id: "session-1",
          hostLabel: "Prod SSH",
          status: "connected"
        } satisfies TerminalTabLike
      ]
    };
    const paneRefs = {
      current: new Map<string, TerminalPaneHandleLike | null>([
        ["session-1", { sendInput }]
      ])
    };

    const { result } = renderHook(() =>
      useSavedCommandActions({
        activeTabId: "session-1",
        broadcastInputToWorkspacePeers,
        confirmDialog,
        copyTextToClipboard: vi.fn(),
        isHighRiskCommand: vi.fn().mockReturnValue(false),
        paneRefs,
        setCopiedCommandId,
        setSavedCommandError,
        setSavedCommandMessage,
        setSavedCommandsDialogOpen,
        tabsRef,
        t,
        toast
      })
    );

    const command: SavedCommand = {
      id: "command-1",
      user_id: "user-1",
      name: "Check disk",
      command_text: "df -h",
      category: null,
      description: null,
      sort_order: 0,
      created_at: "2026-05-12T00:00:00Z",
      updated_at: "2026-05-12T00:00:00Z"
    };

    await act(async () => {
      await result.current.sendSavedCommandToTerminal(command);
    });

    expect(confirmDialog.requestConfirmation).toHaveBeenCalledWith({
      confirmLabel: "terminal.savedCommandSendConfirm",
      message: "terminal.savedCommandSendMessage",
      title: "terminal.savedCommandSendTitle",
      tone: "default"
    });
    expect(sendInput).toHaveBeenCalledWith("df -h");
    expect(broadcastInputToWorkspacePeers).toHaveBeenCalledWith("session-1", "df -h");
    expect(setSavedCommandError).toHaveBeenCalledWith(null);
    expect(setSavedCommandMessage).toHaveBeenCalledWith("terminal.savedCommandSent");
    expect(toast.success).toHaveBeenCalledWith("terminal.savedCommandSent");
    expect(setSavedCommandsDialogOpen).toHaveBeenCalledWith(false);
  });
});
