import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPageProviders } from "../test/renderWithProviders";
import { selectInputOption } from "../test/selectInput";
import { AuditPage } from "./AuditPage";
import type { AuditLog, AuditLogListResponse } from "../features/audit/types";
import type { AuditExportTask, AuditExportTaskListResponse } from "../features/auditExports/types";
import type { HostListResponse } from "../features/hosts/types";
import * as auditApi from "../features/audit/api";
import * as auditExportApi from "../features/auditExports/api";
import * as hostApi from "../features/hosts/api";
import * as downloadLib from "../shared/lib/download";

vi.mock("../features/hosts/api", () => ({
  listHosts: vi.fn()
}));

vi.mock("../features/audit/api", () => ({
  listAuditLogs: vi.fn(),
  getAuditLog: vi.fn()
}));

vi.mock("../features/auditExports/api", () => ({
  createAuditExport: vi.fn(),
  listAuditExports: vi.fn(),
  downloadAuditExport: vi.fn(),
  cancelAuditExport: vi.fn(),
  deleteAuditExport: vi.fn()
}));

vi.mock("../shared/lib/download", () => ({
  saveBlobAsFile: vi.fn()
}));

const listHostsMock = vi.mocked(hostApi.listHosts);
const listAuditLogsMock = vi.mocked(auditApi.listAuditLogs);
const getAuditLogMock = vi.mocked(auditApi.getAuditLog);
const createAuditExportMock = vi.mocked(auditExportApi.createAuditExport);
const listAuditExportsMock = vi.mocked(auditExportApi.listAuditExports);
const downloadAuditExportMock = vi.mocked(auditExportApi.downloadAuditExport);
const cancelAuditExportMock = vi.mocked(auditExportApi.cancelAuditExport);
const deleteAuditExportMock = vi.mocked(auditExportApi.deleteAuditExport);
const saveBlobAsFileMock = vi.mocked(downloadLib.saveBlobAsFile);

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

function buildLog(overrides?: Partial<AuditLog>): AuditLog {
  return {
    id: "log-1",
    event_type: "auth_login_success",
    result: "success",
    target_host_id: "host-1",
    occurred_at: "2026-04-18T00:00:00Z",
    message: "ok",
    metadata: null,
    ...overrides
  };
}

function buildListResponse(input?: {
  page?: number;
  page_size?: number;
  event_type?: string;
  target_host_id?: string;
  result?: "success" | "failure" | "";
}, items?: AuditLog[], total = 12): AuditLogListResponse {
  return {
    items: items ?? [buildLog()],
    page: input?.page ?? 1,
    page_size: input?.page_size ?? 5,
    total
  };
}

function buildExportTask(overrides?: Partial<AuditExportTask>): AuditExportTask {
  return {
    id: "export-1",
    user_id: "user-1",
    filter_event_type: "file_upload_start",
    filter_target_host_id: null,
    filter_result: "",
    filter_start_time: null,
    filter_end_time: null,
    status: "completed",
    total_rows: 1,
    exported_rows: 1,
    error_code: null,
    error_message: null,
    started_at: "2026-04-18T00:00:01Z",
    finished_at: "2026-04-18T00:00:02Z",
    expires_at: "2026-04-19T00:00:00Z",
    created_at: "2026-04-18T00:00:00Z",
    updated_at: "2026-04-18T00:00:02Z",
    ...overrides
  };
}

function buildExportListResponse(items: AuditExportTask[] = [buildExportTask()]): AuditExportTaskListResponse {
  return {
    items,
    page: 1,
    page_size: 20,
    total: items.length
  };
}

function renderAuditRoute(
  route = "/audit",
  props: { hostCatalog?: { hosts: HostListResponse["items"] }; visible?: boolean } = {}
) {
  const auditPage = props.hostCatalog
    ? <AuditPage hostCatalog={props.hostCatalog} visible={props.visible} />
    : <AuditPage visible={props.visible} />;

  return renderWithPageProviders(
    <Routes>
      <Route path="/audit" element={auditPage} />
      <Route path="/audit/:logId" element={auditPage} />
    </Routes>,
    { route }
  );
}

describe("AuditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listHostsMock.mockResolvedValue(hostList);
    getAuditLogMock.mockResolvedValue({ log: buildLog() });
    listAuditExportsMock.mockResolvedValue(buildExportListResponse());
    createAuditExportMock.mockResolvedValue({ task: buildExportTask({ status: "pending", exported_rows: 0, total_rows: 0 }) });
    downloadAuditExportMock.mockResolvedValue(new Blob(["id\nlog-1\n"], { type: "text/csv" }));
    cancelAuditExportMock.mockResolvedValue({ task: buildExportTask({ status: "canceled" }) });
    deleteAuditExportMock.mockResolvedValue(undefined);
  });

  it("exposes the audit list loading state as a status", () => {
    listAuditLogsMock.mockReturnValue(new Promise(() => {}) as Promise<AuditLogListResponse>);

    renderAuditRoute();

    expect(screen.getByRole("status", { name: "Loading audit logs..." })).toBeInTheDocument();
  });

  it("uses a provided host catalog for filters and rows without refetching hosts", async () => {
    listAuditLogsMock.mockResolvedValue(
      buildListResponse({ page: 1, page_size: 5 }, [buildLog({ message: "catalog audit" })])
    );

    renderAuditRoute("/audit", { hostCatalog: { hosts: hostList.items } });

    const row = (await screen.findByText("catalog audit")).closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Primary host")).toBeInTheDocument();
    expect(listHostsMock).not.toHaveBeenCalled();
  });

  it("exposes the audit export task loading state as a status", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));
    listAuditExportsMock.mockReturnValue(new Promise(() => {}) as Promise<AuditExportTaskListResponse>);

    const user = userEvent.setup();
    renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("status", { name: "Loading export tasks..." })).toBeInTheDocument();
  });

  it("pauses export task polling while the audit route is hidden", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));
    listAuditExportsMock.mockResolvedValue(
      buildExportListResponse([buildExportTask({ status: "running", total_rows: 10, exported_rows: 4 })])
    );
    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    let exportPollInterval: TimerHandler | null = null;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      if (timeout === 3000) {
        exportPollInterval = handler;
        return 123;
      }
      return originalSetInterval(handler, timeout, ...args);
    });
    const clearIntervalSpy = vi.spyOn(window, "clearInterval").mockImplementation((id?: number) => {
      if (id === 123) {
        exportPollInterval = null;
        return;
      }
      return originalClearInterval(id);
    });

    function VisibleAuditRoute({ visible }: { visible: boolean }) {
      return (
        <Routes>
          <Route path="/audit" element={<AuditPage visible={visible} />} />
        </Routes>
      );
    }

    const user = userEvent.setup();
    const { rerender } = renderWithPageProviders(<VisibleAuditRoute visible={true} />, { route: "/audit" });

    try {
      await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole("button", { name: "Export CSV" }));
      await waitFor(() => expect(listAuditExportsMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(exportPollInterval).toEqual(expect.any(Function)));

      rerender(<VisibleAuditRoute visible={false} />);

      expect(exportPollInterval).toBeNull();
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);
      expect(setIntervalSpy.mock.calls.filter(([, timeout]) => timeout === 3000)).toHaveLength(1);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("resets to the first page when a filter changes", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderAuditRoute();

    expect(await screen.findByText("Filters")).toBeInTheDocument();
    expect(screen.queryByText("Filters are retained and logs load by page.")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenCalledWith({
        page: 1,
        page_size: 5,
        event_type: "",
        target_host_id: "",
        result: "",
        start_time: "",
        end_time: ""
      })
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith({
        page: 2,
        page_size: 5,
        event_type: "",
        target_host_id: "",
        result: "",
        start_time: "",
        end_time: ""
      })
    );

    await selectInputOption(user, screen.getByLabelText("Result"), "failure");

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 5,
        event_type: "",
        target_host_id: "",
        result: "failure",
        start_time: "",
        end_time: ""
      })
    );
  });

  it("refreshes the current page instead of forcing page 1", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "Refresh list" }));

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith({
        page: 2,
        page_size: 5,
        event_type: "",
        target_host_id: "",
        result: "",
        start_time: "",
        end_time: ""
      })
    );
  });

  it("applies common event presets and keeps result filtering in the dropdown", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));

    const eventPresets = screen.getByLabelText("Event presets");
    await user.click(within(eventPresets).getByRole("button", { name: "File upload" }));

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 5,
        event_type: "file_upload_start",
        target_host_id: "",
        result: "",
        start_time: "",
        end_time: ""
      })
    );
    expect(screen.getByLabelText("Event type")).toHaveValue("file_upload_start");
    expect(screen.queryByLabelText("Result presets")).not.toBeInTheDocument();

    await selectInputOption(user, screen.getByLabelText("Result"), "failure");

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 5,
        event_type: "file_upload_start",
        target_host_id: "",
        result: "failure",
        start_time: "",
        end_time: ""
      })
    );

    await user.click(within(eventPresets).getByRole("button", { name: "All events" }));

    await waitFor(() =>
      expect(listAuditLogsMock).toHaveBeenLastCalledWith({
        page: 1,
        page_size: 5,
        event_type: "",
        target_host_id: "",
        result: "failure",
        start_time: "",
        end_time: ""
      })
    );
    expect(screen.getByLabelText("Event type")).toHaveValue("");
  });

  it("uses compact aligned columns for audit log rows", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));

    const { container } = renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));

    const rows = container.querySelectorAll<HTMLElement>(".audit-data-table .ui-data-table-row");
    expect(rows[0]).toHaveStyle({
      gridTemplateColumns: "minmax(210px, 0.95fr) 104px minmax(150px, 0.9fr) minmax(130px, 0.72fr) 230px 66px"
    });
    expect(rows[1]).toHaveStyle({
      gridTemplateColumns: "minmax(210px, 0.95fr) 104px minmax(150px, 0.9fr) minmax(130px, 0.72fr) 230px 66px"
    });
  });

  it("uses localized result options", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByLabelText("Result"));
    expect(await screen.findByRole("option", { name: "Success" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Failure" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "success" })).not.toBeInTheDocument();
  });

  it("creates, downloads, cancels, and deletes audit export tasks", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));
    listAuditExportsMock.mockResolvedValue(
      buildExportListResponse([
        buildExportTask({ id: "export-completed", status: "completed", total_rows: 3, exported_rows: 3 }),
        buildExportTask({ id: "export-running", status: "running", total_rows: 10, exported_rows: 4 })
      ])
    );

    const user = userEvent.setup();
    renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));
    await user.clear(screen.getByLabelText("Event type"));
    await user.type(screen.getByLabelText("Event type"), "file_upload_start");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(listAuditExportsMock).toHaveBeenCalledWith({ page: 1, page_size: 20 }));

    await user.click(screen.getByRole("button", { name: "Create export" }));
    await waitFor(() =>
      expect(createAuditExportMock).toHaveBeenCalledWith({
        event_type: "file_upload_start"
      })
    );

    await user.click(screen.getAllByRole("button", { name: "Download CSV" })[0]);
    await waitFor(() => expect(downloadAuditExportMock).toHaveBeenCalledWith("export-completed"));
    await waitFor(() => expect(saveBlobAsFileMock).toHaveBeenCalledTimes(1));
    const [blob, fileName] = saveBlobAsFileMock.mock.calls[0];
    expect(fileName).toBe("audit-export-export-completed.csv");
    await expect(blob.text()).resolves.toContain("log-1");

    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    await user.click(cancelButtons[cancelButtons.length - 1]);
    await waitFor(() => expect(cancelAuditExportMock).toHaveBeenCalledWith("export-running"));

    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(deleteAuditExportMock).toHaveBeenCalledWith("export-completed"));
    expect(screen.queryByText("3 / 3")).not.toBeInTheDocument();
  });

  it("opens detail from the URL by loading the audit log", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));
    getAuditLogMock.mockResolvedValue({
      log: buildLog({
        id: "log-2",
        event_type: "file_upload_success",
        message: "uploaded",
        metadata: { path: "/tmp/report.txt" }
      })
    });

    renderAuditRoute("/audit/log-2");

    await waitFor(() => expect(getAuditLogMock).toHaveBeenCalledWith("log-2"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("file_upload_success")).toBeInTheDocument();
    expect(screen.getByText("uploaded")).toBeInTheDocument();
    expect(screen.getByText("/tmp/report.txt")).toBeInTheDocument();
  });

  it("clicking a list item detail button updates the URL and refreshes detail", async () => {
    listAuditLogsMock.mockImplementation(async (input) => buildListResponse(input));

    const user = userEvent.setup();
    renderAuditRoute();

    await waitFor(() => expect(listAuditLogsMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "View details" }));

    await waitFor(() => expect(getAuditLogMock).toHaveBeenCalledWith("log-1"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
