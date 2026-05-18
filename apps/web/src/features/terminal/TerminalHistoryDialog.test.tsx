import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPageProviders } from "../../test/renderWithProviders";
import { selectInputOption } from "../../test/selectInput";
import { saveBlobAsFile } from "../../shared/lib/download";
import { TerminalHistoryDialog } from "./TerminalHistoryDialog";
import {
  deleteTerminalRecording,
  getTerminalRecordingSettings,
  listTerminalRecordingChunks,
  listTerminalRecordings,
  updateTerminalRecordingBookmark,
  updateTerminalRecordingSettings
} from "./api";
import type { TerminalRecording } from "./types";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

vi.mock("../../shared/lib/download", () => ({
  saveBlobAsFile: vi.fn()
}));

vi.mock("./TerminalHistoryReplay", () => ({
  TerminalHistoryReplay: ({ ariaLabel }: { ariaLabel: string }) => (
    <div aria-label={ariaLabel} role="region">
      Replay surface
    </div>
  )
}));

vi.mock("./api", () => ({
  deleteTerminalRecording: vi.fn(),
  getTerminalRecordingSettings: vi.fn(),
  listTerminalRecordingChunks: vi.fn(),
  listTerminalRecordings: vi.fn(),
  updateTerminalRecordingBookmark: vi.fn(),
  updateTerminalRecordingSettings: vi.fn()
}));

const getTerminalRecordingSettingsMock = vi.mocked(getTerminalRecordingSettings);
const listTerminalRecordingsMock = vi.mocked(listTerminalRecordings);
const listTerminalRecordingChunksMock = vi.mocked(listTerminalRecordingChunks);
const updateTerminalRecordingSettingsMock = vi.mocked(updateTerminalRecordingSettings);
const updateTerminalRecordingBookmarkMock = vi.mocked(updateTerminalRecordingBookmark);
const deleteTerminalRecordingMock = vi.mocked(deleteTerminalRecording);
const saveBlobAsFileMock = vi.mocked(saveBlobAsFile);

const recording: TerminalRecording = {
  id: "recording-1",
  terminal_session_id: "session-1",
  host_id: "host-1",
  status: "completed",
  started_at: "2026-04-30T12:00:00Z",
  ended_at: "2026-04-30T12:05:00Z",
  expires_at: "2026-05-07T12:00:00Z",
  is_bookmarked: false,
  input_bytes: 7,
  output_bytes: 12,
  dropped_bytes: 0,
  created_at: "2026-04-30T12:00:00Z"
};

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

function renderDialog() {
  return renderWithPageProviders(
    <TerminalHistoryDialog onOpenChange={vi.fn()} open />
  );
}

function setupSuccessfulList(items: TerminalRecording[] = [recording], total = items.length) {
  getTerminalRecordingSettingsMock.mockResolvedValue({
    settings: { enabled: false, retention_days: 7, updated_at: null }
  });
  listTerminalRecordingsMock.mockResolvedValue({
    items,
    page: 1,
    page_size: 20,
    total
  });
}

describe("TerminalHistoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("online-ssh-language", "en-US");
    setupSuccessfulList();
    listTerminalRecordingChunksMock.mockResolvedValue({
      items: [
        {
          sequence: 1,
          direction: "input",
          occurred_at: "2026-04-30T12:01:00Z",
          data: "whoami\n",
          byte_count: 7
        }
      ],
      next_cursor: 1,
      has_more: false
    });
    updateTerminalRecordingSettingsMock.mockResolvedValue({
      settings: { enabled: true, retention_days: 3, updated_at: "2026-04-30T12:10:00Z" }
    });
    const bookmarkedRecording = { ...recording, is_bookmarked: true };
    updateTerminalRecordingBookmarkMock.mockImplementation(async () => {
      listTerminalRecordingsMock.mockResolvedValue({
        items: [bookmarkedRecording],
        page: 1,
        page_size: 20,
        total: 1
      });
      return { recording: bookmarkedRecording };
    });
    deleteTerminalRecordingMock.mockResolvedValue({ ok: true } as never);
  });

  it("uses shared loading and empty states while preserving the recording settings controls", async () => {
    const settingsDeferred = createDeferred<{ settings: { enabled: boolean; retention_days: number; updated_at: string | null } }>();
    const recordingsDeferred = createDeferred<{ items: TerminalRecording[]; page: number; page_size: number; total: number }>();
    getTerminalRecordingSettingsMock.mockReturnValue(settingsDeferred.promise);
    listTerminalRecordingsMock.mockReturnValue(recordingsDeferred.promise);

    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Terminal history" });

    expect(within(dialog).getByRole("status", { name: "Loading terminal history..." })).toHaveClass("ui-loading-state");
    expect(within(dialog).queryByText("Loading terminal history...")?.closest(".terminal-command-empty")).toBeNull();

    settingsDeferred.resolve({ settings: { enabled: false, retention_days: 7, updated_at: null } });
    recordingsDeferred.resolve({ items: [], page: 1, page_size: 20, total: 0 });

    await waitFor(() => expect(within(dialog).queryByRole("status", { name: "Loading terminal history..." })).not.toBeInTheDocument());
    expect(within(dialog).getByText("No terminal history yet.").closest(".ui-empty-state")).toBeInTheDocument();
    expect(within(dialog).queryByText("No terminal history yet.")?.closest(".terminal-command-empty")).toBeNull();
    expect(within(dialog).getByLabelText("Save input and output for new terminal sessions")).toBeInTheDocument();
  });

  it("uses shared warning notes, retention badges, and icon buttons for the recording list", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Terminal history" });
    await waitFor(() => expect(listTerminalRecordingsMock).toHaveBeenCalledWith({ page: 1, page_size: 20 }));

    const warning = within(dialog).getByText(/Terminal input and output may contain passwords/).closest(".ui-inline-note");
    expect(warning).toHaveClass("ui-inline-note-warning");
    expect(warning).not.toHaveClass("terminal-history-warning");

    const retention = within(dialog).getByText(/Retained until/).closest(".ui-badge");
    expect(retention).toHaveClass("ui-badge", "ui-badge-neutral");
    expect(retention).not.toHaveClass("terminal-history-retention-badge");

    const actions = within(dialog).getByRole("button", { name: "Show details" }).closest(".terminal-history-actions");
    expect(actions).toBeInTheDocument();
    expect(within(actions as HTMLElement).getAllByRole("button").every((button) => button.classList.contains("ui-icon-button-sm"))).toBe(true);
    expect(within(actions as HTMLElement).getAllByRole("button").some((button) => button.classList.contains("terminal-history-action-button"))).toBe(false);
  });

  it("saves settings, toggles bookmarks, downloads chunks, and deletes recordings", async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Terminal history" });
    await waitFor(() => expect(listTerminalRecordingsMock).toHaveBeenCalledWith({ page: 1, page_size: 20 }));

    await user.click(within(dialog).getByLabelText("Save input and output for new terminal sessions"));
    await selectInputOption(user, within(dialog).getByLabelText("Retention"), "3");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTerminalRecordingSettingsMock).toHaveBeenCalledWith({
        enabled: true,
        retention_days: 3
      })
    );

    await user.click(within(dialog).getByRole("button", { name: "Add bookmark" }));
    await waitFor(() => expect(updateTerminalRecordingBookmarkMock).toHaveBeenCalledWith("recording-1", true));

    await user.click(within(dialog).getByRole("button", { name: "Show details" }));
    await waitFor(() => expect(listTerminalRecordingChunksMock).toHaveBeenCalledWith("recording-1", { cursor: 0, limit: 200 }));
    const toolbar = dialog.querySelector(".terminal-history-replay-toolbar") as HTMLElement;
    expect(within(toolbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Back to list",
      "Download history",
      "Remove bookmark",
      "Delete history"
    ]);

    await user.click(within(dialog).getByRole("button", { name: "Download history" }));
    await waitFor(() => expect(saveBlobAsFileMock).toHaveBeenCalledTimes(1));
    const [blob, fileName] = saveBlobAsFileMock.mock.calls[0];
    await expect(blob.text()).resolves.toContain("whoami");
    expect(fileName).toMatch(/^terminal-history-20260430-120000-recording-1\.log$/);

    await user.click(within(dialog).getByRole("button", { name: "Delete history" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Delete terminal history" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete history" }));
    await waitFor(() => expect(deleteTerminalRecordingMock).toHaveBeenCalledWith("recording-1"));
  });
});
