import type { Dispatch, DragEvent, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessage } from "../auth/api";
import { createSavedCommand, deleteSavedCommand, listSavedCommands, updateSavedCommand } from "../savedCommands/api";
import type { SavedCommand } from "../savedCommands/types";
import { emptySavedCommandForm, type SavedCommandDialogMode, type SavedCommandForm } from "./TerminalSavedCommandsDialog";

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

type UseSavedCommandsArgs = {
  confirmDialog: ConfirmDialogLike;
  language: string;
  t: Translate;
  toast: ToastLike;
};

type UpsertSavedCommandInput = {
  command: SavedCommand;
};

function sortSavedCommands(items: SavedCommand[]) {
  return [...items].sort((left, right) =>
    left.sort_order === right.sort_order
      ? right.updated_at.localeCompare(left.updated_at)
      : left.sort_order - right.sort_order
  );
}

function reorderSavedCommands(items: SavedCommand[], draggingId: string, targetId: string) {
  const next = [...items];
  const from = next.findIndex((item) => item.id === draggingId);
  const to = next.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) {
    return null;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, index) => ({ ...item, sort_order: index }));
}

export type UseSavedCommandsResult = {
  beginCreateSavedCommand: () => void;
  cancelSavedCommandForm: () => void;
  copiedCommandId: string | null;
  handleDragEnd: () => void;
  handleDragOver: (event: DragEvent<HTMLElement>, commandId: string) => void;
  handleDragStart: (event: DragEvent<HTMLElement>, commandId: string) => void;
  handleDrop: (event: DragEvent<HTMLElement>, targetId: string) => Promise<void>;
  editSavedCommand: (command: SavedCommand) => void;
  handleSavedCommandsOpenChange: (open: boolean) => void;
  openSavedCommandsDialog: () => void;
  removeSavedCommand: (command: SavedCommand) => Promise<void>;
  savedCommandCategories: string[];
  savedCommandCategoryFilter: string;
  savedCommandDialogMode: SavedCommandDialogMode;
  savedCommandDraggingId: string | null;
  savedCommandDropTargetId: string | null;
  savedCommandError: string | null;
  savedCommandForm: SavedCommandForm | null;
  savedCommandMessage: string | null;
  savedCommandReordering: boolean;
  savedCommandSubmitting: boolean;
  savedCommands: SavedCommand[];
  savedCommandsDialogOpen: boolean;
  savedCommandsLoading: boolean;
  setCopiedCommandId: Dispatch<SetStateAction<string | null>>;
  setSavedCommandCategoryFilter: Dispatch<SetStateAction<string>>;
  setSavedCommandError: Dispatch<SetStateAction<string | null>>;
  setSavedCommandForm: Dispatch<SetStateAction<SavedCommandForm | null>>;
  setSavedCommandMessage: Dispatch<SetStateAction<string | null>>;
  setSavedCommandsDialogOpen: Dispatch<SetStateAction<boolean>>;
  submitSavedCommand: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  upsertSavedCommand: ({ command }: UpsertSavedCommandInput) => void;
  visibleSavedCommands: SavedCommand[];
};

export function useSavedCommands({
  confirmDialog,
  language,
  t,
  toast
}: UseSavedCommandsArgs): UseSavedCommandsResult {
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [savedCommandsLoading, setSavedCommandsLoading] = useState(true);
  const [savedCommandSubmitting, setSavedCommandSubmitting] = useState(false);
  const [savedCommandForm, setSavedCommandForm] = useState<SavedCommandForm | null>(null);
  const [savedCommandError, setSavedCommandError] = useState<string | null>(null);
  const [savedCommandMessage, setSavedCommandMessage] = useState<string | null>(null);
  const [savedCommandsDialogOpen, setSavedCommandsDialogOpen] = useState(false);
  const [savedCommandDialogMode, setSavedCommandDialogMode] = useState<SavedCommandDialogMode>("list");
  const [savedCommandCategoryFilter, setSavedCommandCategoryFilter] = useState("");
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const [savedCommandDraggingId, setSavedCommandDraggingId] = useState<string | null>(null);
  const [savedCommandDropTargetId, setSavedCommandDropTargetId] = useState<string | null>(null);
  const [savedCommandReordering, setSavedCommandReordering] = useState(false);

  const loadSavedCommands = useCallback(async () => {
    setSavedCommandsLoading(true);
    setSavedCommandError(null);
    try {
      const response = await listSavedCommands();
      setSavedCommands(sortSavedCommands(response.items));
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.savedCommandsLoadFailed"), t);
      setSavedCommandError(message);
      toast.error(message);
    } finally {
      setSavedCommandsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadSavedCommands();
  }, [loadSavedCommands]);

  const savedCommandCategories = useMemo(() => {
    const categories = new Set<string>();
    for (const command of savedCommands) {
      const category = command.category?.trim();
      if (category) {
        categories.add(category);
      }
    }
    return Array.from(categories).sort((left, right) => left.localeCompare(right, language));
  }, [language, savedCommands]);

  const visibleSavedCommands = useMemo(() => {
    if (!savedCommandCategoryFilter) {
      return savedCommands;
    }
    return savedCommands.filter((command) => command.category?.trim() === savedCommandCategoryFilter);
  }, [savedCommandCategoryFilter, savedCommands]);

  useEffect(() => {
    if (savedCommandCategoryFilter && !savedCommandCategories.includes(savedCommandCategoryFilter)) {
      setSavedCommandCategoryFilter("");
    }
  }, [savedCommandCategories, savedCommandCategoryFilter]);

  const openSavedCommandsDialog = useCallback(() => {
    setSavedCommandMessage(null);
    setSavedCommandError(null);
    setSavedCommandForm(null);
    setSavedCommandDialogMode("list");
    setSavedCommandsDialogOpen(true);
  }, []);

  const beginCreateSavedCommand = useCallback(() => {
    setSavedCommandMessage(null);
    setSavedCommandError(null);
    setSavedCommandForm({ ...emptySavedCommandForm });
    setSavedCommandDialogMode("create");
  }, []);

  const cancelSavedCommandForm = useCallback(() => {
    setSavedCommandForm(null);
    setSavedCommandDialogMode("list");
    setSavedCommandError(null);
  }, []);

  const handleSavedCommandsOpenChange = useCallback((open: boolean) => {
    setSavedCommandsDialogOpen(open);
    if (!open) {
      setSavedCommandForm(null);
      setSavedCommandDialogMode("list");
      setSavedCommandError(null);
    }
  }, []);

  const upsertSavedCommand = useCallback(({ command }: UpsertSavedCommandInput) => {
    setSavedCommands((current) => {
      const without = current.filter((item) => item.id !== command.id);
      return sortSavedCommands([...without, command]);
    });
  }, []);

  const editSavedCommand = useCallback((command: SavedCommand) => {
    setSavedCommandMessage(null);
    setSavedCommandError(null);
    setSavedCommandForm({
      id: command.id,
      name: command.name,
      command_text: command.command_text,
      category: command.category || "",
      description: command.description || ""
    });
    setSavedCommandDialogMode("edit");
  }, []);

  const submitSavedCommand = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!savedCommandForm) {
      return;
    }
    setSavedCommandSubmitting(true);
    setSavedCommandError(null);
    setSavedCommandMessage(null);

    try {
      const input = {
        name: savedCommandForm.name,
        command_text: savedCommandForm.command_text,
        category: savedCommandForm.category || null,
        description: savedCommandForm.description || null,
        sort_order: savedCommandForm.id
          ? savedCommands.find((c) => c.id === savedCommandForm.id)?.sort_order ?? 0
          : savedCommands.length
      };
      const response = savedCommandForm.id
        ? await updateSavedCommand(savedCommandForm.id, input)
        : await createSavedCommand(input);
      upsertSavedCommand({ command: response.command });
      setSavedCommandForm(null);
      setSavedCommandDialogMode("list");
      const message = savedCommandForm.id ? t("terminal.savedCommandUpdated") : t("terminal.savedCommandCreated");
      setSavedCommandMessage(message);
      toast.success(message);
      void loadSavedCommands();
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.savedCommandSaveFailed"), t);
      setSavedCommandError(message);
      toast.error(message);
    } finally {
      setSavedCommandSubmitting(false);
    }
  }, [loadSavedCommands, savedCommandForm, savedCommands, t, toast, upsertSavedCommand]);

  const removeSavedCommand = useCallback(async (command: SavedCommand) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("terminal.savedCommandDeleteTitle"),
      message: t("terminal.savedCommandDeleteMessage", { name: command.name }),
      confirmLabel: t("terminal.savedCommandDeleteConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setSavedCommandError(null);
    setSavedCommandMessage(null);
    try {
      await deleteSavedCommand(command.id);
      setSavedCommands((current) => current.filter((item) => item.id !== command.id));
      const message = t("terminal.savedCommandDeleted");
      setSavedCommandMessage(message);
      toast.success(message);
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.savedCommandDeleteFailed"), t);
      setSavedCommandError(message);
      toast.error(message);
    }
  }, [confirmDialog, t, toast]);

  const handleDragStart = useCallback((event: DragEvent<HTMLElement>, commandId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", commandId);
    setSavedCommandDraggingId(commandId);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>, commandId: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSavedCommandDropTargetId(commandId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setSavedCommandDraggingId(null);
    setSavedCommandDropTargetId(null);
  }, []);

  const handleDrop = useCallback(async (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (savedCommandCategoryFilter) {
      return;
    }
    const draggingId = event.dataTransfer.getData("text/plain");
    setSavedCommandDraggingId(null);
    setSavedCommandDropTargetId(null);
    if (!draggingId || draggingId === targetId) {
      return;
    }
    const reordered = reorderSavedCommands(savedCommands, draggingId, targetId);
    if (!reordered) {
      return;
    }
    setSavedCommands(reordered);
    setSavedCommandReordering(true);
    try {
      await Promise.all(
        reordered
          .filter((item, index) => item.sort_order !== savedCommands.find((c) => c.id === item.id)?.sort_order || index !== savedCommands.findIndex((c) => c.id === item.id))
          .map((item) =>
            updateSavedCommand(item.id, {
              name: item.name,
              command_text: item.command_text,
              category: item.category || null,
              description: item.description,
              sort_order: item.sort_order
            })
          )
      );
    } catch (error) {
      const message = getApiErrorMessage(error, t("terminal.savedCommandSaveFailed"), t);
      setSavedCommandError(message);
      toast.error(message);
      void loadSavedCommands();
    } finally {
      setSavedCommandReordering(false);
    }
  }, [loadSavedCommands, savedCommandCategoryFilter, savedCommands, t, toast]);

  return {
    beginCreateSavedCommand,
    cancelSavedCommandForm,
    copiedCommandId,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
    editSavedCommand,
    handleSavedCommandsOpenChange,
    openSavedCommandsDialog,
    removeSavedCommand,
    savedCommandCategories,
    savedCommandCategoryFilter,
    savedCommandDialogMode,
    savedCommandDraggingId,
    savedCommandDropTargetId,
    savedCommandError,
    savedCommandForm,
    savedCommandMessage,
    savedCommandReordering,
    savedCommandSubmitting,
    savedCommands,
    savedCommandsDialogOpen,
    savedCommandsLoading,
    setCopiedCommandId,
    setSavedCommandCategoryFilter,
    setSavedCommandError,
    setSavedCommandForm,
    setSavedCommandMessage,
    setSavedCommandsDialogOpen,
    submitSavedCommand,
    upsertSavedCommand,
    visibleSavedCommands
  };
}
