import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SavedCommandListResponse } from "../savedCommands/types";
import { useSavedCommands } from "./useSavedCommands";

const listSavedCommandsMock = vi.hoisted(() => vi.fn());

vi.mock("../savedCommands/api", () => ({
  createSavedCommand: vi.fn(),
  deleteSavedCommand: vi.fn(),
  listSavedCommands: listSavedCommandsMock,
  updateSavedCommand: vi.fn()
}));

const t = (key: string) => key;
const toast = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn()
};
const confirmDialog = {
  requestConfirmation: vi.fn()
};

describe("useSavedCommands", () => {
  it("loads saved commands on mount and derives sorted categories", async () => {
    const response: SavedCommandListResponse = {
      items: [
        {
          id: "cmd-1",
          user_id: "user-1",
          name: "Restart app",
          command_text: "systemctl restart app",
          category: "Ops",
          description: null,
          sort_order: 1,
          created_at: "2026-05-12T00:00:00Z",
          updated_at: "2026-05-12T00:00:00Z"
        },
        {
          id: "cmd-2",
          user_id: "user-1",
          name: "Tail logs",
          command_text: "journalctl -u app -f",
          category: "Logs",
          description: null,
          sort_order: 0,
          created_at: "2026-05-12T00:00:00Z",
          updated_at: "2026-05-12T00:00:00Z"
        }
      ]
    };
    listSavedCommandsMock.mockResolvedValueOnce(response);

    const { result } = renderHook(() => useSavedCommands({
      confirmDialog,
      language: "en",
      t,
      toast
    }));

    await waitFor(() => expect(result.current.savedCommandsLoading).toBe(false));

    expect(result.current.savedCommands).toHaveLength(2);
    expect(result.current.savedCommandCategories).toEqual(["Logs", "Ops"]);
    expect(result.current.visibleSavedCommands).toHaveLength(2);
  });

  it("opens and cancels the create form", async () => {
    listSavedCommandsMock.mockResolvedValueOnce({ items: [] });

    const { result } = renderHook(() => useSavedCommands({
      confirmDialog,
      language: "en",
      t,
      toast
    }));

    await waitFor(() => expect(result.current.savedCommandsLoading).toBe(false));

    act(() => {
      result.current.beginCreateSavedCommand();
    });
    expect(result.current.savedCommandDialogMode).toBe("create");
    expect(result.current.savedCommandForm).toEqual({
      name: "",
      command_text: "",
      category: "",
      description: ""
    });

    act(() => {
      result.current.cancelSavedCommandForm();
    });
    expect(result.current.savedCommandDialogMode).toBe("list");
    expect(result.current.savedCommandForm).toBeNull();
  });
});
