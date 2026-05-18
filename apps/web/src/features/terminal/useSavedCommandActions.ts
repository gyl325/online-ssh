import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type { SavedCommand } from "../savedCommands/types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

type ToastLike = {
  error: (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
};

type ConfirmDialogLike = {
  requestConfirmation: (options: {
    confirmLabel: string;
    message: string;
    title: string;
    tone?: "default" | "danger";
  }) => Promise<boolean>;
};

type TerminalTabLike = {
  id: string;
  hostLabel: string;
  status: string;
};

type TerminalPaneHandleLike = {
  sendInput: (text: string) => boolean;
};

type MutableRef<T> = {
  current: T;
};

type UseSavedCommandActionsArgs<TTab extends TerminalTabLike, TPaneHandle extends TerminalPaneHandleLike> = {
  activeTabId: string | null;
  broadcastInputToWorkspacePeers: (sourceTabId: string, data: string) => void;
  confirmDialog: ConfirmDialogLike;
  copyTextToClipboard: (text: string) => Promise<boolean>;
  isHighRiskCommand: (text: string) => boolean;
  paneRefs: MutableRef<Map<string, TPaneHandle | null>>;
  setCopiedCommandId: Dispatch<SetStateAction<string | null>>;
  setSavedCommandError: Dispatch<SetStateAction<string | null>>;
  setSavedCommandMessage: Dispatch<SetStateAction<string | null>>;
  setSavedCommandsDialogOpen: Dispatch<SetStateAction<boolean>>;
  tabsRef: MutableRef<TTab[]>;
  t: Translate;
  toast: ToastLike;
};

export function useSavedCommandActions<TTab extends TerminalTabLike, TPaneHandle extends TerminalPaneHandleLike>({
  activeTabId,
  broadcastInputToWorkspacePeers,
  confirmDialog,
  copyTextToClipboard,
  isHighRiskCommand,
  paneRefs,
  setCopiedCommandId,
  setSavedCommandError,
  setSavedCommandMessage,
  setSavedCommandsDialogOpen,
  tabsRef,
  t,
  toast
}: UseSavedCommandActionsArgs<TTab, TPaneHandle>) {
  const copiedTimerRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);

  const sendSavedCommandToTerminal = useCallback(async (command: SavedCommand) => {
    setSavedCommandError(null);
    setSavedCommandMessage(null);
    if (!activeTabId) {
      const message = t("terminal.savedCommandSendNoTerminal");
      setSavedCommandError(message);
      toast.warning(message);
      return;
    }
    const activeTab = tabsRef.current.find((tab) => tab.id === activeTabId);
    if (!activeTab || activeTab.status !== "connected") {
      const message = t("terminal.savedCommandSendNotReady");
      setSavedCommandError(message);
      toast.warning(message);
      return;
    }
    const handle = paneRefs.current.get(activeTabId);
    if (!handle) {
      const message = t("terminal.savedCommandSendNotReady");
      setSavedCommandError(message);
      toast.warning(message);
      return;
    }
    const highRisk = isHighRiskCommand(command.command_text);
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("terminal.savedCommandSendTitle"),
      message: highRisk
        ? t("terminal.savedCommandSendHighRiskMessage", {
          host: activeTab.hostLabel,
          command: command.command_text
        })
        : t("terminal.savedCommandSendMessage", {
          host: activeTab.hostLabel,
          command: command.command_text
        }),
      confirmLabel: t("terminal.savedCommandSendConfirm"),
      tone: highRisk ? "danger" : "default"
    });
    if (!confirmed) {
      return;
    }
    const ok = handle.sendInput(command.command_text);
    if (ok) {
      broadcastInputToWorkspacePeers(activeTab.id, command.command_text);
      const message = t("terminal.savedCommandSent", { host: activeTab.hostLabel });
      setSavedCommandMessage(message);
      toast.success(message);
      setSavedCommandsDialogOpen(false);
    } else {
      const message = t("terminal.savedCommandSendNotReady");
      setSavedCommandError(message);
      toast.warning(message);
    }
  }, [
    activeTabId,
    broadcastInputToWorkspacePeers,
    confirmDialog,
    isHighRiskCommand,
    paneRefs,
    setSavedCommandError,
    setSavedCommandMessage,
    setSavedCommandsDialogOpen,
    t,
    tabsRef,
    toast
  ]);

  const copySavedCommand = useCallback(async (command: SavedCommand) => {
    setSavedCommandError(null);
    setSavedCommandMessage(null);
    const ok = await copyTextToClipboard(command.command_text);
    if (ok) {
      const message = t("terminal.savedCommandCopied");
      window.clearTimeout(copiedTimerRef.current);
      setSavedCommandMessage(message);
      toast.success(message);
      setCopiedCommandId(command.id);
      copiedTimerRef.current = window.setTimeout(() => setCopiedCommandId(null), 1200);
    } else {
      const message = t("terminal.savedCommandCopyFailed");
      setSavedCommandError(message);
      toast.error(message);
    }
  }, [
    copyTextToClipboard,
    setCopiedCommandId,
    setSavedCommandError,
    setSavedCommandMessage,
    t,
    toast
  ]);

  return {
    copySavedCommand,
    sendSavedCommandToTerminal
  };
}
