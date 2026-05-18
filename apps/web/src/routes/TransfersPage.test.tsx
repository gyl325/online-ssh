import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPreferences } from "../test/renderWithProviders";
import { selectInputOption } from "../test/selectInput";
import { TransfersPage } from "./TransfersPage";
import type { HostListResponse } from "../features/hosts/types";
import type { TransferTask, TransferTaskListResponse, TransferTaskResponse } from "../features/transfers/types";
import * as hostApi from "../features/hosts/api";
import * as transferApi from "../features/transfers/api";

vi.mock("../features/hosts/api", () => ({
  listHosts: vi.fn()
}));

vi.mock("../features/transfers/api", () => ({
  cancelTransferTask: vi.fn(),
  listTransferTasks: vi.fn(),
  pauseTransferTask: vi.fn(),
  resumeTransferTask: vi.fn(),
  retryTransferTask: vi.fn()
}));

const listHostsMock = vi.mocked(hostApi.listHosts);
const listTransferTasksMock = vi.mocked(transferApi.listTransferTasks);
const resumeTransferTaskMock = vi.mocked(transferApi.resumeTransferTask);
const retryTransferTaskMock = vi.mocked(transferApi.retryTransferTask);

const hostList: HostListResponse = {
  items: [
    {
      id: "host-1",
      credential_id: "cred-1",
      group_id: null,
      name: "Primary host",
      host: "127.0.0.1",
      port: 22,
      username: "root",
      auth_type: "password",
      remark: null,
      is_favorite: false,
      status: "online",
      last_connected_at: null,
      created_at: "2026-04-18T00:00:00Z",
      updated_at: "2026-04-18T00:00:00Z"
    }
  ],
  page: 1,
  page_size: 100,
  total: 1
};

function buildTask(overrides?: Partial<TransferTask>): TransferTask {
  return {
    id: "task-1",
    task_type: "download",
    source_host_id: "host-1",
    target_host_id: "host-1",
    source_path: "/remote/file.txt",
    target_path: "/local/file.txt",
    file_name: "file.txt",
    total_bytes: 1024,
    transferred_bytes: 256,
    status: "pending",
    resumable: true,
    retry_count: 0,
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:00Z",
    ...overrides
  };
}

function buildListResponse(input?: { page?: number; page_size?: number }, items?: TransferTask[]): TransferTaskListResponse {
  return {
    items: items ?? [buildTask()],
    page: input?.page ?? 1,
    page_size: input?.page_size ?? 5,
    total: 12
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function taskResponse(task: TransferTask): TransferTaskResponse {
  return { task };
}

describe("TransfersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listHostsMock.mockResolvedValue(hostList);
  });

  it("exposes the transfer list loading state as a status", () => {
    listTransferTasksMock.mockReturnValue(new Promise(() => {}) as Promise<TransferTaskListResponse>);

    renderWithPreferences(<TransfersPage />);

    expect(screen.getByRole("status", { name: "Loading tasks..." })).toBeInTheDocument();
  });

  it("uses a provided host catalog without refetching hosts", async () => {
    listTransferTasksMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [buildTask({ file_name: "catalog-file.txt" })])
    );

    renderWithPreferences(<TransfersPage hostCatalog={{ hosts: hostList.items }} />);

    const row = (await screen.findByText("catalog-file.txt")).closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Primary host")).toBeInTheDocument();
    expect(listHostsMock).not.toHaveBeenCalled();
  });

  it("pauses automatic task loading while hidden and reloads when visible", async () => {
    listTransferTasksMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [buildTask({ file_name: "visible-transfer.txt" })])
    );

    const { rerender } = renderWithPreferences(<TransfersPage visible={false} />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listTransferTasksMock).not.toHaveBeenCalled();

    rerender(<TransfersPage visible />);

    await waitFor(() =>
      expect(listTransferTasksMock).toHaveBeenCalledWith({ page: 1, page_size: 5, status: "", task_type: "" })
    );
    expect(await screen.findByText("visible-transfer.txt")).toBeInTheDocument();
  });

  it("resets to the first page and refetches when the task type filter changes", async () => {
    listTransferTasksMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledWith({ page: 1, page_size: 5, status: "", task_type: "" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listTransferTasksMock).toHaveBeenLastCalledWith({ page: 2, page_size: 5, status: "", task_type: "" }));

    await selectInputOption(user, screen.getByLabelText("Direction"), "upload");

    await waitFor(() =>
      expect(listTransferTasksMock).toHaveBeenLastCalledWith({ page: 1, page_size: 5, status: "", task_type: "upload" })
    );
    expect(screen.getByText("Page 1 / 3, 12 items total.")).toBeInTheDocument();
  });

  it("shows localized status options without duplicating the direction filter", async () => {
    listTransferTasksMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledWith({ page: 1, page_size: 5, status: "", task_type: "" }));

    await user.click(screen.getByLabelText("Status"));
    expect(await screen.findByRole("option", { name: "Transferring" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "transferring" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Direction presets")).not.toBeInTheDocument();
  });

  it("passes created time range filters to the transfer list request", async () => {
    listTransferTasksMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 0, 0);
    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledWith({ page: 1, page_size: 5, status: "", task_type: "" }));

    await user.click(screen.getByRole("button", { name: /Time range/ }));
    await user.click(await screen.findByRole("button", { name: "Today" }));

    await waitFor(() =>
      expect(listTransferTasksMock).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 5,
        status: "",
        task_type: "",
        created_from: todayStart.toISOString(),
        created_to: todayEnd.toISOString()
      })
    );
  });

  it("ignores stale responses when a newer filter request finishes first", async () => {
    const firstRequest = createDeferred<TransferTaskListResponse>();
    const secondRequest = createDeferred<TransferTaskListResponse>();

    listTransferTasksMock.mockImplementation((input) => {
      if (input?.status === "failed") {
        return secondRequest.promise;
      }
      return firstRequest.promise;
    });

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledTimes(1));

    await selectInputOption(user, screen.getByLabelText("Status"), "failed");
    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledTimes(2));

    secondRequest.resolve(
      buildListResponse({ page: 1, page_size: 5 }, [buildTask({ id: "task-new", file_name: "new-file.txt", status: "failed" })])
    );

    await waitFor(() => expect(screen.getByText("new-file.txt")).toBeInTheDocument());

    firstRequest.resolve(
      buildListResponse({ page: 1, page_size: 5 }, [buildTask({ id: "task-old", file_name: "old-file.txt" })])
    );

    await waitFor(() => expect(screen.queryByText("old-file.txt")).not.toBeInTheDocument());
    expect(screen.getByText("new-file.txt")).toBeInTheDocument();
  });

  it("summarizes failed transfer reasons and provides a failed-only shortcut", async () => {
    const failedTask = buildTask({
      id: "task-failed",
      file_name: "failed.txt",
      status: "failed",
      error_code: "SFTP_WRITE_FAILED",
      error_message: "Permission denied"
    });
    listTransferTasksMock.mockImplementation(async (input) =>
      buildListResponse(input, [
        failedTask,
        buildTask({ id: "task-complete", file_name: "complete.txt", status: "completed" })
      ])
    );

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    const failedRow = (await screen.findByText("failed.txt")).closest("article");
    expect(failedRow).not.toBeNull();
    expect(screen.getByText("Failure summary")).toBeInTheDocument();
    expect(screen.getByText("1 failed task(s) on this page.")).toBeInTheDocument();
    expect(screen.getAllByText("SFTP_WRITE_FAILED: Permission denied")).toHaveLength(1);
    expect(within(failedRow as HTMLElement).queryByText("Error")).not.toBeInTheDocument();
    const failedFileName = within(failedRow as HTMLElement).getByText("failed.txt");
    expect(failedFileName).toHaveClass("transfer-file-name-has-error");
    expect(failedFileName).toHaveAttribute("title", "SFTP_WRITE_FAILED: Permission denied");

    await user.click(screen.getByRole("button", { name: "View failed only" }));

    await waitFor(() =>
      expect(listTransferTasksMock).toHaveBeenLastCalledWith({ page: 1, page_size: 5, status: "failed", task_type: "" })
    );
  });

  it("shows a current-page transfer history summary", async () => {
    listTransferTasksMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [
        buildTask({
          id: "task-upload-active",
          file_name: "upload.bin",
          task_type: "upload",
          status: "transferring",
          total_bytes: 2048,
          transferred_bytes: 1024
        }),
        buildTask({
          id: "task-download-completed",
          file_name: "download.log",
          task_type: "download",
          status: "completed",
          total_bytes: 1024,
          transferred_bytes: 1024
        }),
        buildTask({
          id: "task-download-failed",
          file_name: "failed.log",
          task_type: "download",
          status: "failed",
          total_bytes: 512,
          transferred_bytes: 128
        })
      ])
    );

    renderWithPreferences(<TransfersPage />);

    const summary = await screen.findByLabelText("Transfer history summary");
    expect(within(summary).getByText("Matching tasks")).toBeInTheDocument();
    expect(within(summary).getByText("12")).toBeInTheDocument();
    expect(within(summary).getByText("3 task(s) on this page")).toBeInTheDocument();
    expect(within(summary).getByText("Active / Failed")).toBeInTheDocument();
    expect(within(summary).getByText("1 failed on this page")).toBeInTheDocument();
    expect(within(summary).getByText("1 uploads · 2 downloads")).toBeInTheDocument();
    expect(within(summary).getByText("2.1 KB")).toBeInTheDocument();
    expect(within(summary).getByText("3.5 KB total on this page")).toBeInTheDocument();
  });

  it("uses aligned compact columns for transfer rows", async () => {
    listTransferTasksMock.mockImplementation(async (input) => buildListResponse(input));

    const { container } = renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledWith({ page: 1, page_size: 5, status: "", task_type: "" }));

    const rows = container.querySelectorAll<HTMLElement>(".transfer-data-table .ui-data-table-row");
    expect(rows[0]).toHaveStyle({
      gridTemplateColumns: "minmax(168px, 0.9fr) 124px minmax(128px, 0.78fr) minmax(96px, 0.48fr) minmax(226px, 1.22fr) 104px 74px 104px 64px"
    });
    expect(rows[1]).toHaveStyle({
      gridTemplateColumns: "minmax(168px, 0.9fr) 124px minmax(128px, 0.78fr) minmax(96px, 0.48fr) minmax(226px, 1.22fr) 104px 74px 104px 64px"
    });
  });

  it("shows only the transfer controls allowed by each task state", async () => {
    listTransferTasksMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [
        buildTask({ id: "task-active", file_name: "active.txt", status: "transferring" }),
        buildTask({ id: "task-paused", file_name: "paused.txt", status: "paused" }),
        buildTask({ id: "task-failed", file_name: "failed.txt", status: "failed" }),
        buildTask({ id: "task-complete", file_name: "complete.txt", status: "completed" })
      ])
    );

    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(screen.getByText("active.txt")).toBeInTheDocument());

    const activeRow = screen.getByText("active.txt").closest("article");
    const pausedRow = screen.getByText("paused.txt").closest("article");
    const failedRow = screen.getByText("failed.txt").closest("article");
    const completedRow = screen.getByText("complete.txt").closest("article");

    expect(activeRow).not.toBeNull();
    expect(pausedRow).not.toBeNull();
    expect(failedRow).not.toBeNull();
    expect(completedRow).not.toBeNull();

    expect(within(activeRow as HTMLElement).getByRole("button", { name: "Pause transfer" })).toBeInTheDocument();
    expect(within(activeRow as HTMLElement).getByRole("button", { name: "Cancel transfer" })).toBeInTheDocument();
    expect(within(pausedRow as HTMLElement).getByRole("button", { name: "Resume transfer" })).toBeInTheDocument();
    expect(within(pausedRow as HTMLElement).getByRole("button", { name: "Cancel transfer" })).toBeInTheDocument();
    expect(within(failedRow as HTMLElement).getByRole("button", { name: "Retry transfer" })).toBeInTheDocument();
    expect(within(completedRow as HTMLElement).queryByRole("button", { name: "Pause transfer" })).not.toBeInTheDocument();
    expect(within(completedRow as HTMLElement).queryByRole("button", { name: "Cancel transfer" })).not.toBeInTheDocument();
  });

  it("displays average speed and duration in the list and detail dialog", async () => {
    const completedTask = buildTask({
      id: "task-completed",
      file_name: "archive.tar",
      status: "completed",
      transferred_bytes: 2048,
      total_bytes: 4096,
      started_at: "2026-04-18T00:00:00Z",
      finished_at: "2026-04-18T00:00:04Z",
      updated_at: "2026-04-18T00:00:04Z"
    });
    const fractionalSpeedTask = buildTask({
      id: "task-fractional-speed",
      file_name: "tiny.log",
      status: "completed",
      transferred_bytes: 41,
      total_bytes: 41,
      started_at: "2026-04-18T00:00:00Z",
      finished_at: "2026-04-18T00:00:03Z",
      updated_at: "2026-04-18T00:00:03Z"
    });
    listTransferTasksMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [completedTask, fractionalSpeedTask])
    );

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    const row = (await screen.findByText("archive.tar")).closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("512 B/s")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("4s")).toBeInTheDocument();

    const fractionalRow = screen.getByText("tiny.log").closest("article");
    expect(fractionalRow).not.toBeNull();
    expect(within(fractionalRow as HTMLElement).getByText("13.7 B/s")).toBeInTheDocument();
    expect(within(fractionalRow as HTMLElement).queryByText("13.666666666666666 B/s")).not.toBeInTheDocument();

    await user.click(within(row as HTMLElement).getByRole("button", { name: "View details" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Speed")).toBeInTheDocument();
    expect(within(dialog).getByText("512 B/s")).toBeInTheDocument();
    expect(within(dialog).getByText("Duration")).toBeInTheDocument();
    expect(within(dialog).getByText("4s")).toBeInTheDocument();
  });

  it("runs a control action, updates the task, and refreshes the current list", async () => {
    const pausedTask = buildTask({ id: "task-paused", file_name: "paused.txt", status: "paused" });
    const resumedTask = buildTask({ id: "task-paused", file_name: "paused.txt", status: "pending", transferred_bytes: 0 });

    listTransferTasksMock
      .mockResolvedValueOnce(buildListResponse({ page: 1, page_size: 5 }, [pausedTask]))
      .mockResolvedValueOnce(buildListResponse({ page: 1, page_size: 5 }, [resumedTask]));
    resumeTransferTaskMock.mockResolvedValue(taskResponse(resumedTask));

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(screen.getByText("paused.txt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Resume transfer" }));

    await waitFor(() => expect(resumeTransferTaskMock).toHaveBeenCalledWith("task-paused"));
    await waitFor(() => expect(listTransferTasksMock).toHaveBeenCalledTimes(2));
    const resumedRow = screen.getByText("paused.txt").closest("article");
    expect(resumedRow).not.toBeNull();
    expect(within(resumedRow as HTMLElement).getByText("Pending")).toBeInTheDocument();
  });

  it("shows the backend error when a transfer control action fails", async () => {
    listTransferTasksMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [buildTask({ id: "task-failed", file_name: "failed.txt", status: "failed" })])
    );
    retryTransferTaskMock.mockRejectedValue(new Error("retry not allowed"));

    const user = userEvent.setup();
    renderWithPreferences(<TransfersPage />);

    await waitFor(() => expect(screen.getByText("failed.txt")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Retry transfer" }));

    await waitFor(() => expect(retryTransferTaskMock).toHaveBeenCalledWith("task-failed"));
    expect(await screen.findByText("retry not allowed")).toBeInTheDocument();
    expect(listTransferTasksMock).toHaveBeenCalledTimes(1);
  });
});
