import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation, useNavigate } from "react-router-dom";

import { renderWithPageProviders } from "../test/renderWithProviders";
import { selectInputOption } from "../test/selectInput";
import { FilesPage } from "./FilesPage";
import { confirmHostFingerprint } from "../features/fingerprint/api";
import type { Host, HostFingerprintConflictResponse, HostListResponse } from "../features/hosts/types";
import type { FileEntry, FileListResponse } from "../features/files/types";
import type { TransferTask } from "../features/transfers/types";
import * as filesApi from "../features/files/api";
import * as hostApi from "../features/hosts/api";
import * as transferApi from "../features/transfers/api";
import * as transferClient from "../features/transfers/client";
import * as downloadLib from "../shared/lib/download";

vi.mock("../features/hosts/api", () => ({
  listHosts: vi.fn()
}));

vi.mock("../features/files/api", () => ({
  calculateFileChecksum: vi.fn(),
  cancelFileSearchTask: vi.fn(),
  chmodFile: vi.fn(),
  compressArchive: vi.fn(),
  copyFile: vi.fn(),
  createDirectory: vi.fn(),
  createDownloadTask: vi.fn(),
  createFile: vi.fn(),
  createFileSearchTask: vi.fn(),
  deleteFile: vi.fn(),
  extractArchive: vi.fn(),
  getFileSearchTask: vi.fn(),
  listFileSearchTaskResults: vi.fn(),
  listDirectory: vi.fn(),
  readFileContent: vi.fn(),
  renameFile: vi.fn(),
  writeFileContent: vi.fn()
}));

vi.mock("../features/transfers/api", () => ({
  downloadTransferTaskContent: vi.fn(),
  initUploadTask: vi.fn(),
  resumeTransferTask: vi.fn(),
  uploadTransferChunk: vi.fn()
}));

vi.mock("../features/transfers/client", () => ({
  waitForTransferTask: vi.fn()
}));

vi.mock("../shared/lib/download", () => ({
  saveBlobAsFile: vi.fn()
}));

vi.mock("../features/fingerprint/api", () => ({
  confirmHostFingerprint: vi.fn()
}));

vi.mock("../features/files/FileTextEditor", () => ({
  FileTextEditor: ({
    ariaLabel,
    disabled,
    editable,
    onChange,
    value
  }: {
    ariaLabel: string;
    disabled?: boolean;
    editable: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      contentEditable={editable}
      disabled={disabled || !editable}
      onChange={(event) => onChange(event.target.value)}
      readOnly={!editable}
      role="textbox"
      value={value}
    />
  )
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    destroy: vi.fn(),
    promise: Promise.resolve({
      destroy: vi.fn(),
      getPage: vi.fn(() =>
        Promise.resolve({
          getViewport: vi.fn(({ scale }: { scale: number }) => ({
            height: 120 * scale,
            width: 90 * scale
          })),
          render: vi.fn(() => ({
            cancel: vi.fn(),
            promise: Promise.resolve()
          }))
        })
      ),
      numPages: 3
    })
  }))
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?url", () => ({
  default: "/mock-pdf-worker.mjs"
}));

const listHostsMock = vi.mocked(hostApi.listHosts);
const calculateFileChecksumMock = vi.mocked(filesApi.calculateFileChecksum);
const createDownloadTaskMock = vi.mocked(filesApi.createDownloadTask);
const compressArchiveMock = vi.mocked(filesApi.compressArchive);
const copyFileMock = vi.mocked(filesApi.copyFile);
const createFileSearchTaskMock = vi.mocked(filesApi.createFileSearchTask);
const extractArchiveMock = vi.mocked(filesApi.extractArchive);
const getFileSearchTaskMock = vi.mocked(filesApi.getFileSearchTask);
const listFileSearchTaskResultsMock = vi.mocked(filesApi.listFileSearchTaskResults);
const listDirectoryMock = vi.mocked(filesApi.listDirectory);
const readFileContentMock = vi.mocked(filesApi.readFileContent);
const renameFileMock = vi.mocked(filesApi.renameFile);
const writeFileContentMock = vi.mocked(filesApi.writeFileContent);
const downloadTransferTaskContentMock = vi.mocked(transferApi.downloadTransferTaskContent);
const initUploadTaskMock = vi.mocked(transferApi.initUploadTask);
const uploadTransferChunkMock = vi.mocked(transferApi.uploadTransferChunk);
const saveBlobAsFileMock = vi.mocked(downloadLib.saveBlobAsFile);
const waitForTransferTaskMock = vi.mocked(transferClient.waitForTransferTask);
const confirmHostFingerprintMock = vi.mocked(confirmHostFingerprint);
const clipboardWriteTextMock = vi.fn();
const createObjectURLMock = vi.fn();
const revokeObjectURLMock = vi.fn();

function mockClipboardEventCopy() {
  const setClipboardData = vi.fn();
  const execCommand = vi.fn((command: string) => {
    if (command !== "copy") {
      return false;
    }
    const event = new Event("copy") as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      configurable: true,
      value: {
        setData: setClipboardData
      }
    });
    document.dispatchEvent(event);
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand
  });
  return { execCommand, setClipboardData };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function NavigateToFilesHostButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/files?host_id=host-1")}>Open host files</button>;
}

async function connectFileHost(user: ReturnType<typeof userEvent.setup>, hostName = "Prod SSH") {
  await user.click(await screen.findByRole("button", { name: "New link" }));
  const escapedHostName = hostName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await user.click(await screen.findByRole("button", { name: new RegExp(escapedHostName) }));
}

const host: Host = {
  id: "host-1",
  credential_id: "cred-1",
  group_id: null,
  name: "Prod SSH",
  host: "127.0.0.1",
  port: 22,
  username: "root",
  auth_type: "password",
  remark: null,
  is_favorite: false,
  status: "online",
  last_connected_at: null,
  created_at: "2026-04-24T00:00:00Z",
  updated_at: "2026-04-24T00:00:00Z"
};

const hostList: HostListResponse = {
  items: [host],
  page: 1,
  page_size: 100,
  total: 1
};

const fingerprintConflict: HostFingerprintConflictResponse = {
  code: "HOST_FINGERPRINT_CONFLICT",
  message: "fingerprint changed",
  current_fingerprint: {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:current-fingerprint",
    status: "changed",
    first_seen_at: "2026-04-24T10:00:00Z",
    last_verified_at: "2026-04-24T11:00:00Z"
  },
  previous_fingerprint: {
    algorithm: "ssh-rsa",
    fingerprint: "SHA256:previous-fingerprint",
    status: "trusted"
  }
};

const directoryResponse: FileListResponse = {
  host_id: "host-1",
  path: "/root",
  items: [
    {
      name: "notes.txt",
      path: "/root/notes.txt",
      entry_type: "file",
      size_bytes: 128,
      permissions: "-rw-r--r--",
      owner: "root",
      group: "root",
      modified_at: "2026-04-24T12:00:00Z",
      is_hidden: false
    }
  ],
  next_cursor: null
};

function buildFileEntry(overrides: Partial<FileEntry>): FileEntry {
  return {
    name: "entry.txt",
    path: "/root/entry.txt",
    entry_type: "file",
    size_bytes: 0,
    permissions: "-rw-r--r--",
    owner: "root",
    group: "root",
    modified_at: "2026-04-24T12:00:00Z",
    is_hidden: false,
    ...overrides
  };
}

function createDragDataTransfer(path = "") {
  const store = new Map<string, string>();
  if (path) {
    store.set("application/x-online-ssh-file-path", path);
    store.set("text/plain", path);
  }
  return {
    dropEffect: "none",
    effectAllowed: "all",
    getData: vi.fn((type: string) => store.get(type) || ""),
    setData: vi.fn((type: string, value: string) => {
      store.set(type, value);
    })
  };
}

function expectShortcut(button: HTMLElement, ariaShortcut: string, keys: string[]) {
  expect(button).toHaveAttribute("aria-keyshortcuts", ariaShortcut);
  const shortcut = button.querySelector(".files-row-menu-shortcut");
  expect(shortcut).not.toBeNull();
  for (const key of keys) {
    expect(within(shortcut as HTMLElement).getByText(key)).toBeInTheDocument();
  }
}

const completedDownloadTask: TransferTask = {
  id: "task-1",
  task_type: "download",
  source_type: "remote",
  target_type: "platform",
  source_host_id: "host-1",
  target_host_id: null,
  source_path: "/root/notes.txt",
  target_path: null,
  file_name: "notes.txt",
  total_bytes: 128,
  transferred_bytes: 128,
  chunk_size: null,
  status: "completed",
  resumable: false,
  retry_count: 0,
  error_code: null,
  error_message: null,
  download_url: null,
  started_at: "2026-04-24T12:00:00Z",
  finished_at: "2026-04-24T12:00:01Z",
  created_at: "2026-04-24T12:00:00Z",
  updated_at: "2026-04-24T12:00:01Z"
};

const completedUploadTask: TransferTask = {
  id: "upload-task-1",
  task_type: "upload",
  source_type: "platform",
  target_type: "remote",
  source_host_id: null,
  target_host_id: "host-1",
  source_path: null,
  target_path: "/root",
  file_name: "upload.txt",
  total_bytes: 11,
  transferred_bytes: 11,
  chunk_size: 5,
  status: "completed",
  resumable: true,
  retry_count: 0,
  error_code: null,
  error_message: null,
  download_url: null,
  started_at: "2026-04-24T12:00:00Z",
  finished_at: "2026-04-24T12:00:01Z",
  created_at: "2026-04-24T12:00:00Z",
  updated_at: "2026-04-24T12:00:01Z"
};

const remoteSearchTask = {
  id: "search-task-1",
  host_id: "host-1",
  base_path: "/root",
  keyword: "log",
  match_mode: "path" as const,
  recursive: true,
  include_hidden: false,
  max_depth: 6,
  max_results: 500,
  max_scanned_entries: 50000,
  timeout_seconds: 30,
  status: "completed" as const,
  scanned_dirs: 2,
  scanned_entries: 12,
  matched_entries: 1,
  skipped_errors_count: 0,
  limit_reached: false,
  error_code: null,
  error_message: null,
  warnings_json: [],
  started_at: "2026-04-24T12:00:00Z",
  finished_at: "2026-04-24T12:00:01Z",
  expires_at: "2026-04-25T12:00:00Z",
  created_at: "2026-04-24T12:00:00Z",
  updated_at: "2026-04-24T12:00:01Z"
};

describe("FilesPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteTextMock }
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteTextMock }
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURLMock
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURLMock
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({}))
    });
    clipboardWriteTextMock.mockResolvedValue(undefined);
    createObjectURLMock.mockReturnValue("blob:preview-file");
    listHostsMock.mockResolvedValue(hostList);
    confirmHostFingerprintMock.mockResolvedValue({
      fingerprint: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:current-fingerprint",
        status: "trusted"
      }
    });
  });

  it("filters available hosts from the new link picker", async () => {
    const backupHost: Host = {
      ...host,
      id: "host-2",
      credential_id: "cred-2",
      name: "Backup SSH",
      host: "10.0.0.2",
      username: "ubuntu"
    };
    listHostsMock.mockResolvedValue({ ...hostList, items: [host, backupHost], total: 2 });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await user.click(await screen.findByRole("button", { name: "New link" }));
    const picker = await screen.findByText("Available hosts");
    const pickerPanel = picker.closest(".files-host-picker") as HTMLElement;
    expect(within(pickerPanel).getByPlaceholderText("Filter hosts")).toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Prod SSH/ })).toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Backup SSH/ })).toBeInTheDocument();

    await user.type(within(pickerPanel).getByPlaceholderText("Filter hosts"), "backup");

    expect(within(pickerPanel).queryByRole("button", { name: /Prod SSH/ })).not.toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Backup SSH/ })).toBeInTheDocument();
  });

  it("uses a provided host catalog for the host query entrypoint without refetching hosts", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: directoryResponse
    });

    renderWithPageProviders(
      <FilesPage hostCatalog={{ hosts: hostList.items }} />,
      { route: "/files?host_id=host-1" }
    );

    await waitFor(() =>
      expect(listDirectoryMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/",
        limit: 200
      })
    );
    expect(screen.getByRole("button", { name: /Prod SSH/ })).toHaveAttribute("aria-current", "true");
    expect(listHostsMock).not.toHaveBeenCalled();
  });

  it("keeps the temporary file host when a host catalog is provided", async () => {
    const temporaryHost: Host = {
      ...host,
      id: "temp-host-1",
      credential_id: null,
      name: "Temporary SSH",
      host: "203.0.113.40",
      username: "deploy"
    };
    window.sessionStorage.setItem("online-ssh-temporary-file-host", JSON.stringify(temporaryHost));
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        host_id: temporaryHost.id,
        path: "/home/deploy"
      }
    });

    renderWithPageProviders(
      <FilesPage hostCatalog={{ hosts: hostList.items }} />,
      { route: "/files?host_id=temp-host-1" }
    );

    await waitFor(() =>
      expect(listDirectoryMock).toHaveBeenCalledWith({
        host_id: "temp-host-1",
        path: "/",
        limit: 200
      })
    );
    expect(screen.getByRole("button", { name: /Temporary SSH/ })).toHaveAttribute("aria-current", "true");
    expect(listHostsMock).not.toHaveBeenCalled();
  });

  it("reloads the directory after fingerprint confirmation when selecting a host", async () => {
    listDirectoryMock
      .mockResolvedValueOnce({ kind: "fingerprint_conflict", data: fingerprintConflict })
      .mockResolvedValueOnce({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("fingerprint changed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm fingerprint and continue|确认 fingerprint 并继续/i }));

    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(2));
    expect(listDirectoryMock).toHaveBeenNthCalledWith(1, {
      host_id: "host-1",
      path: "/root",
      limit: 200
    });
    expect(listDirectoryMock).toHaveBeenNthCalledWith(2, {
      host_id: "host-1",
      path: "/root",
      limit: 200
    });
    expect(confirmHostFingerprintMock).toHaveBeenCalledWith("host-1", {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:current-fingerprint"
    });
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
  });

  it("shows a canceled directory state when fingerprint confirmation is canceled while selecting a host", async () => {
    listDirectoryMock.mockResolvedValueOnce({ kind: "fingerprint_conflict", data: fingerprintConflict });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel and stop|取消并中止/i }));

    const message = "Fingerprint confirmation was canceled; Browse remote directory has stopped.";
    expect(await screen.findByText("Directory load did not complete.")).toBeInTheDocument();
    expect(screen.getAllByText(message).some((element) => element.closest(".ui-empty-state"))).toBe(true);

    const hostItem = screen.getByText("Prod SSH").closest(".files-connected-host-item") as HTMLElement;
    expect(hostItem).not.toBeNull();
    expect(within(hostItem).getByRole("button", { name: "Prod SSH" })).toHaveAttribute("aria-current", "true");
    expect(within(hostItem).getByText("Failed")).toHaveClass("files-connected-host-status-error");

    expect(confirmHostFingerprintMock).not.toHaveBeenCalled();
    expect(screen.queryByText("No host selected.")).not.toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("restores the last file host, path, and search after a page refresh", async () => {
    window.localStorage.setItem(
      "online-ssh-files-snapshot",
      JSON.stringify({
        selected_host_id: "host-1",
        current_path: "/var/log",
        search_keyword: "notes"
      })
    );
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        path: "/var/log"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await waitFor(() =>
      expect(listDirectoryMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/var/log",
        limit: 200
      })
    );
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prod SSH/ })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByText("/var/log")).not.toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "Connection information" }));
    expect(await screen.findAllByText("/var/log")).not.toHaveLength(0);
    expect(screen.getByPlaceholderText("Search current directory")).toHaveValue("notes");
    expect(screen.getByRole("button", { name: "log" })).toHaveAttribute("title", "/var/log");
  });

  it("connects the requested host when host_id is added to an already mounted files page", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: directoryResponse
    });

    const user = userEvent.setup();
    renderWithPageProviders(
      <>
        <FilesPage />
        <NavigateToFilesHostButton />
        <LocationProbe />
      </>,
      { route: "/files" }
    );

    expect(await screen.findByText("No connected hosts yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open host files" }));

    await waitFor(() =>
      expect(listDirectoryMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/root",
        limit: 200
      })
    );
    expect(screen.getByRole("button", { name: /Prod SSH/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/files");
  });

  it("loads the selected host home path when switching hosts manually", async () => {
    window.localStorage.setItem(
      "online-ssh-files-snapshot",
      JSON.stringify({
        selected_host_id: "host-1",
        current_path: "/var/log",
        search_keyword: "notes"
      })
    );
    const secondHost = {
      ...host,
      id: "host-2",
      name: "Backup SSH",
      username: "deploy"
    };
    listHostsMock.mockResolvedValue({ ...hostList, items: [host, secondHost], total: 2 });
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledWith({ host_id: "host-1", path: "/var/log", limit: 200 }));

    await connectFileHost(user, "Backup SSH");

    await waitFor(() => expect(listDirectoryMock).toHaveBeenLastCalledWith({ host_id: "host-2", path: "/home/deploy", limit: 200 }));
    expect(screen.getByPlaceholderText("Search current directory")).toHaveValue("");
  });

  it("keeps separate file contexts when switching connected hosts", async () => {
    const secondHost = {
      ...host,
      id: "host-2",
      name: "Backup SSH",
      username: "deploy"
    };
    const backupDirectoryResponse: FileListResponse = {
      host_id: "host-2",
      path: "/home/deploy",
      items: [
        buildFileEntry({
          name: "backup.log",
          path: "/home/deploy/backup.log",
          size_bytes: 64
        })
      ],
      next_cursor: null
    };

    listHostsMock.mockResolvedValue({ ...hostList, items: [host, secondHost], total: 2 });
    listDirectoryMock.mockImplementation(async (input) => ({
      kind: "success",
      data: input.host_id === "host-2" ? backupDirectoryResponse : directoryResponse
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Search current directory"), "notes");

    await connectFileHost(user, "Backup SSH");
    expect(await screen.findByText("backup.log")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search current directory")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /Prod SSH/ }));

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search current directory")).toHaveValue("notes");
    expect(listDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it("disconnects a connected host after confirmation", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Disconnect host" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect host?" });
    expect(within(dialog).getByText(/Prod SSH/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByText("No connected hosts yet.")).toBeInTheDocument());
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    expect(screen.getByText("No host selected.")).toBeInTheDocument();
  });

  it("navigates backward and forward through visited directories", async () => {
    const rootResponse: FileListResponse = {
      ...directoryResponse,
      path: "/root",
      items: [
        buildFileEntry({
          name: "logs",
          path: "/root/logs",
          entry_type: "directory",
          permissions: "drwxr-xr-x"
        })
      ]
    };
    const logsResponse: FileListResponse = {
      ...directoryResponse,
      path: "/root/logs",
      items: [
        buildFileEntry({
          name: "app.log",
          path: "/root/logs/app.log",
          size_bytes: 64
        })
      ]
    };
    listDirectoryMock.mockImplementation(async (input) => ({
      kind: "success",
      data: input.path === "/root/logs" ? logsResponse : rootResponse
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const logsRow = (await screen.findByText("logs")).closest(".file-row");
    expect(logsRow).not.toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    await user.dblClick(logsRow as HTMLElement);
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("logs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("orders directory navigation controls before root and parent actions", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    await screen.findByText("notes.txt");

    const toolbar = document.querySelector(".files-toolbar");
    expect(toolbar).not.toBeNull();
    const controls = Array.from((toolbar as HTMLElement).children).map((element) => {
      if (element.getAttribute("role") === "group") {
        return element.getAttribute("aria-label");
      }
      return element.getAttribute("aria-label");
    });

    expect(controls.slice(0, 5)).toEqual(["Back", "Forward", "View mode", "Go to root", "Parent directory"]);
    expect(screen.getByRole("button", { name: "Parent directory" })).toHaveTextContent("..");
  });

  it("sorts the compact file list from the column headers", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "zeta.log",
            path: "/root/zeta.log",
            size_bytes: 10
          }),
          buildFileEntry({
            name: "logs",
            path: "/root/logs",
            entry_type: "directory",
            permissions: "drwxr-xr-x"
          }),
          buildFileEntry({
            name: "alpha.txt",
            path: "/root/alpha.txt",
            size_bytes: 200
          })
        ]
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    await waitFor(() => expect(screen.getByText("alpha.txt")).toBeInTheDocument());

    const rowNames = () =>
      Array.from(document.querySelectorAll(".file-row-name-text")).map((element) => element.textContent);

    expect(rowNames()).toEqual(["logs", "alpha.txt", "zeta.log"]);

    await user.click(screen.getByRole("button", { name: "Size" }));
    expect(rowNames()).toEqual(["logs", "zeta.log", "alpha.txt"]);

    await user.click(screen.getByRole("button", { name: "Size" }));
    expect(rowNames()).toEqual(["logs", "alpha.txt", "zeta.log"]);
  });

  it("switches to grid view and opens a directory tile", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "logs",
            path: "/root/logs",
            entry_type: "directory",
            permissions: "drwxr-xr-x"
          }),
          buildFileEntry({
            name: "notes.txt",
            path: "/root/notes.txt",
            size_bytes: 128
          })
        ]
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    await screen.findByText("logs");

    const viewMode = screen.getByRole("group", { name: "View mode" });
    await user.click(within(viewMode).getByRole("button", { name: "Grid view" }));

    const tile = screen.getByText("logs").closest(".files-grid-item");
    expect(tile).not.toBeNull();
    await user.dblClick(tile as HTMLElement);

    await waitFor(() =>
      expect(listDirectoryMock).toHaveBeenLastCalledWith({
        host_id: "host-1",
        path: "/root/logs",
        limit: 200
      })
    );
  });

  it("shows file totals and the current selection count in the footer", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();

    expect(screen.getByText("1 items")).toBeInTheDocument();
    expect(screen.getByText("0 selected")).toBeInTheDocument();

    await user.click(row as HTMLElement);

    await waitFor(() => expect(screen.getByText("1 selected")).toBeInTheDocument());
  });

  it("creates a download task, waits for completion, and saves the blob", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    createDownloadTaskMock.mockResolvedValue({
      kind: "success",
      data: {
        task: {
          id: "task-1",
          task_type: "download",
          status: "transferring",
          file_name: "notes.txt",
          total_bytes: 128,
          transferred_bytes: 64,
          source_host_id: "host-1",
          source_path: "/root/notes.txt"
        }
      }
    });
    waitForTransferTaskMock.mockResolvedValue(completedDownloadTask);
    const blob = new Blob(["hello"], { type: "text/plain" });
    downloadTransferTaskContentMock.mockResolvedValue(blob);

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as HTMLElement, { clientX: 120, clientY: 160 });
    await user.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(createDownloadTaskMock).toHaveBeenCalledWith({
        host_id: "host-1",
        source_path: "/root/notes.txt"
      })
    );
    expect(waitForTransferTaskMock).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        timeoutMessage: "Transfer task polling timed out."
      })
    );
    expect(downloadTransferTaskContentMock).toHaveBeenCalledWith("task-1");
    expect(saveBlobAsFileMock).toHaveBeenCalledWith(blob, "notes.txt");
  });

  it("opens a text file and saves edited content", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    readFileContentMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "old contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:00:00Z"
      }
    });
    writeFileContentMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "new contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:01:00Z"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);

    expect(await screen.findByText("old contents")).toBeInTheDocument();
    const editor = await screen.findByRole("textbox", { name: "File text content" });
    expect(editor).toHaveAttribute("contenteditable", "false");
    expect(screen.getByText("Read-only preview. Choose Edit before changing and saving this file.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(editor).toHaveAttribute("contenteditable", "true");

    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}new contents");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const dialog = (await screen.findByRole("heading", { name: "Save remote file?" })).closest("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(within(dialog as HTMLElement).getByText(/\/root\/notes\.txt/)).toBeInTheDocument();
    expect(writeFileContentMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(writeFileContentMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "new contents"
      })
    );
    expect(await screen.findByText("new contents")).toBeInTheDocument();
  });

  it("uses shared loading and note primitives in preview surfaces", async () => {
    let resolveRead: (value: Awaited<ReturnType<typeof readFileContentMock>>) => void = () => undefined;
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    readFileContentMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "old contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:00:00Z"
      }
    });
    readFileContentMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);

    const previewLoading = await screen.findByRole("status", { name: "Reading text content..." });
    expect(previewLoading).toHaveClass("ui-loading-state", "files-preview-loading");

    resolveRead({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "old contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:00:00Z"
      }
    });

    const previewNote = await screen.findByText("Read-only preview. Choose Edit before changing and saving this file.");
    expect(previewNote.closest(".ui-inline-note")).toHaveClass("files-preview-note");
  });

  it("shows the shared loading button state while saving edited content", async () => {
    let resolveWrite: (value: Awaited<ReturnType<typeof writeFileContentMock>>) => void = () => undefined;
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    readFileContentMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "old contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:00:00Z"
      }
    });
    writeFileContentMock.mockReturnValue(new Promise((resolve) => {
      resolveWrite = resolve;
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);
    await screen.findByText("old contents");

    const editor = await screen.findByRole("textbox", { name: "File text content" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}new contents");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    const savingButton = await screen.findByRole("button", { name: "Saving..." });
    expect(savingButton).toHaveClass("ui-button-loading");
    expect(savingButton).toHaveAttribute("aria-busy", "true");
    expect(savingButton.querySelector(".ui-button-spinner")).not.toBeNull();
    expect(savingButton.querySelector(".button-spinner")).toBeNull();

    resolveWrite({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "new contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:01:00Z"
      }
    });

    expect(await screen.findByText("new contents")).toBeInTheDocument();
  });

  it("renders the row context menu outside the filtered workspace panel", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
    fireEvent.contextMenu(row as HTMLElement, { clientX: 120, clientY: 160 });

    const menu = document.body.querySelector(".files-row-menu");
    expect(menu).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body);
    expect(within(menu as HTMLElement).getByRole("button", { name: "View information" })).toBeInTheDocument();
    expect(within(menu as HTMLElement).getByRole("button", { name: "Open content" })).toBeInTheDocument();
    expect(within(menu as HTMLElement).getByRole("button", { name: "Open in terminal" })).toBeInTheDocument();
  });

  it("shows shortcut hints in entry and blank context menus", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as HTMLElement, { clientX: 120, clientY: 160 });

    let menu = document.body.querySelector(".files-row-menu");
    expect(menu).not.toBeNull();
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Open content" }), "Space", ["Space"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Rename" }), "Enter", ["Enter"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Copy" }), "Control+C", ["Ctrl", "C"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Cut" }), "Control+X", ["Ctrl", "X"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Copy path" }), "Control+Shift+C", ["Ctrl", "Shift", "C"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Open in terminal" }), "Control+Shift+T", ["Ctrl", "Shift", "T"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Delete" }), "Delete", ["Delete"]);

    const tableBody = document.querySelector(".files-data-table .ui-data-table-body");
    expect(tableBody).not.toBeNull();
    fireEvent.contextMenu(tableBody as HTMLElement, { clientX: 240, clientY: 260 });
    menu = document.body.querySelector(".files-row-menu");
    expect(menu).not.toBeNull();
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "New directory" }), "Control+Shift+N", ["Ctrl", "Shift", "N"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "New file" }), "Control+N", ["Ctrl", "N"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Open in terminal" }), "Control+Shift+T", ["Ctrl", "Shift", "T"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Paste" }), "Control+V", ["Ctrl", "V"]);
    expectShortcut(within(menu as HTMLElement).getByRole("button", { name: "Refresh current directory" }), "Control+Y", ["Ctrl", "Y"]);
  });

  it("runs file actions from keyboard shortcuts when a row is selected", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    copyFileMock.mockResolvedValue({
      kind: "success",
      data: { success: true, message: "remote path copied" }
    });
    const { setClipboardData } = mockClipboardEventCopy();
    const user = userEvent.setup();
    renderWithPageProviders(
      <>
        <FilesPage />
        <LocationProbe />
      </>
    );

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.click(row as HTMLElement);
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { code: "KeyC", key: "c", ctrlKey: true, shiftKey: true });
    expect(await screen.findByText("Path copied.")).toBeInTheDocument();
    expect(setClipboardData).toHaveBeenCalledWith("text/plain", "/root/notes.txt");

    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Rename" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename" })).not.toBeInTheDocument());

    await user.keyboard("{Control>}c{/Control}");
    expect(await screen.findByText("Copied \"notes.txt\".")).toBeInTheDocument();

    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() =>
      expect(copyFileMock).toHaveBeenCalledWith({
        host_id: "host-1",
        source_path: "/root/notes.txt",
        target_path: "/root/notes-copy.txt"
      })
    );
    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(2));

    await user.click((await screen.findByText("notes.txt")).closest(".file-row") as HTMLElement);
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    await user.keyboard("{Control>}x{/Control}");
    expect(await screen.findByText("Cut \"notes.txt\".")).toBeInTheDocument();

    await user.keyboard("{Control>}{Shift>}T{/Shift}{/Control}");
    await waitFor(() => {
      const location = screen.getByTestId("location").textContent || "";
      const url = new URL(location, "http://localhost");
      expect(url.pathname).toBe("/terminal");
      expect(url.searchParams.get("host_id")).toBe("host-1");
      expect(url.searchParams.get("cwd")).toBe("/root");
    });

    await user.keyboard("{Delete}");
    expect(await screen.findByRole("dialog", { name: "Delete confirmation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete confirmation" })).not.toBeInTheDocument()
    );
  });

  it("opens the selected item with the Space shortcut", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    readFileContentMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "old contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:00:00Z"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    const rowElement = row as HTMLElement;
    await user.click(rowElement);
    expect(await screen.findByText("1 selected")).toBeInTheDocument();
    rowElement.focus();
    expect(rowElement).toHaveFocus();
    fireEvent.keyDown(rowElement, { key: " " });

    await waitFor(() =>
      expect(readFileContentMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/root/notes.txt"
      })
    );
    expect(await screen.findByText("old contents")).toBeInTheDocument();
  });

  it("runs current-directory shortcuts and ignores shortcuts from text inputs", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(
      <>
        <FilesPage />
        <LocationProbe />
      </>
    );

    await connectFileHost(user);
    await screen.findByText("notes.txt");

    const searchInput = screen.getByPlaceholderText("Search current directory");
    await user.click(searchInput);
    await user.keyboard("{Control>}n{/Control}");
    expect(screen.queryByRole("dialog", { name: "New file" })).not.toBeInTheDocument();

    await user.click(document.body);
    await user.keyboard("{Control>}n{/Control}");
    expect(await screen.findByRole("dialog", { name: "New file" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.keyboard("{Control>}{Shift>}N{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "New directory" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.keyboard("{Control>}y{/Control}");
    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(2));

    await user.keyboard("{Control>}{Shift>}T{/Shift}{/Control}");
    await waitFor(() => {
      const location = screen.getByTestId("location").textContent || "";
      const url = new URL(location, "http://localhost");
      expect(url.pathname).toBe("/terminal");
      expect(url.searchParams.get("host_id")).toBe("host-1");
      expect(url.searchParams.get("cwd")).toBe("/root");
    });
  });

  it("ignores document shortcuts while hidden by AppShell keepalive", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage visible={false} />);

    await connectFileHost(user);
    await screen.findByText("notes.txt");

    await user.click(document.body);
    await user.keyboard("{Control>}y{/Control}");

    expect(listDirectoryMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "New file" })).not.toBeInTheDocument();
  });

  it("copies a remote item from the row context menu and pastes from the blank context menu", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    copyFileMock.mockResolvedValue({
      kind: "success",
      data: { success: true, message: "remote path copied" }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as HTMLElement, { clientX: 120, clientY: 160 });
    await user.click(await screen.findByRole("button", { name: "Copy" }));

    const tableBody = document.querySelector(".files-data-table .ui-data-table-body");
    expect(tableBody).not.toBeNull();
    fireEvent.contextMenu(tableBody as HTMLElement, { clientX: 240, clientY: 260 });
    const menu = document.body.querySelector(".files-row-menu");
    expect(menu).not.toBeNull();
    expect(within(menu as HTMLElement).getByRole("button", { name: "New directory" })).toBeInTheDocument();
    await user.click(within(menu as HTMLElement).getByRole("button", { name: "Paste" }));

    await waitFor(() =>
      expect(copyFileMock).toHaveBeenCalledWith({
        host_id: "host-1",
        source_path: "/root/notes.txt",
        target_path: "/root/notes-copy.txt"
      })
    );
    expect(await screen.findByText("Copied as: notes-copy.txt.")).toBeInTheDocument();
  });

  it("opens a terminal at the current directory from the blank context menu", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    renderWithPageProviders(
      <>
        <FilesPage />
        <LocationProbe />
      </>
    );

    await connectFileHost(user);

    const tableBody = document.querySelector(".files-data-table .ui-data-table-body");
    expect(tableBody).not.toBeNull();
    fireEvent.contextMenu(tableBody as HTMLElement, { clientX: 240, clientY: 260 });
    const menu = document.body.querySelector(".files-row-menu");
    expect(menu).not.toBeNull();
    await user.click(within(menu as HTMLElement).getByRole("button", { name: "Open in terminal" }));

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent || "";
      const url = new URL(location, "http://localhost");
      expect(url.pathname).toBe("/terminal");
      expect(url.searchParams.get("host_id")).toBe("host-1");
      expect(url.searchParams.get("cwd")).toBe("/root");
    });
  });

  it("calculates a remote file checksum from the context menu", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    calculateFileChecksumMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        algorithm: "sha256",
        checksum: "abc123"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row as HTMLElement, { clientX: 120, clientY: 160 });
    await user.click(await screen.findByRole("button", { name: "Calculate SHA256" }));

    await waitFor(() =>
      expect(calculateFileChecksumMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/root/notes.txt",
        algorithm: "sha256"
      })
    );
    expect(await screen.findByText(/SHA256: abc123/)).toBeInTheDocument();
  });

  it("shows archive actions for supported row types and refreshes after running them", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "logs",
            path: "/root/logs",
            entry_type: "directory",
            permissions: "drwxr-xr-x"
          }),
          buildFileEntry({
            name: "backup.tar.gz",
            path: "/root/backup.tar.gz",
            size_bytes: 512
          }),
          buildFileEntry({
            name: "notes.txt",
            path: "/root/notes.txt",
            size_bytes: 128
          })
        ]
      }
    });
    compressArchiveMock.mockResolvedValue({
      kind: "success",
      data: { success: true, message: "remote directory compressed" }
    });
    extractArchiveMock.mockResolvedValue({
      kind: "success",
      data: { success: true, message: "remote archive extracted" }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const logsRow = (await screen.findByText("logs")).closest(".file-row");
    expect(logsRow).not.toBeNull();
    fireEvent.contextMenu(logsRow as HTMLElement, { clientX: 120, clientY: 160 });
    expect(await screen.findByRole("button", { name: "Compress" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Extract" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Compress" }));

    const compressDialog = await screen.findByRole("dialog", { name: "Compress directory" });
    expect(within(compressDialog).getByDisplayValue("logs.tar.gz")).toBeInTheDocument();
    expect(within(compressDialog).getByText("logs")).toBeInTheDocument();
    await selectInputOption(user, within(compressDialog).getByRole("combobox", { name: "Archive format" }), "zip");
    expect(within(compressDialog).getByDisplayValue("logs.zip")).toBeInTheDocument();
    await user.click(within(compressDialog).getByRole("button", { name: "Compress" }));

    await waitFor(() =>
      expect(compressArchiveMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/root/logs",
        output_path: "/root/logs.zip"
      })
    );
    expect(await screen.findByText("Archive created: logs.zip.")).toBeInTheDocument();
    expect(screen.queryByText("remote directory compressed")).not.toBeInTheDocument();

    const archiveRow = (await screen.findByText("backup.tar.gz")).closest(".file-row");
    expect(archiveRow).not.toBeNull();
    fireEvent.contextMenu(archiveRow as HTMLElement, { clientX: 120, clientY: 160 });
    expect(screen.queryByRole("button", { name: "Compress" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Extract" }));

    await waitFor(() =>
      expect(extractArchiveMock).toHaveBeenCalledWith({
        host_id: "host-1",
        path: "/root/backup.tar.gz"
      })
    );
    expect(await screen.findByText("Archive extracted: backup.tar.gz.")).toBeInTheDocument();
    expect(screen.queryByText("remote archive extracted")).not.toBeInTheDocument();

    const fileRow = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(fileRow).not.toBeNull();
    fireEvent.contextMenu(fileRow as HTMLElement, { clientX: 120, clientY: 160 });
    expect(screen.queryByRole("button", { name: "Compress" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Extract" })).not.toBeInTheDocument();
    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(3));
  });

  it("moves a file into a directory by dragging a list row", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "logs",
            path: "/root/logs",
            entry_type: "directory",
            permissions: "drwxr-xr-x"
          }),
          buildFileEntry({
            name: "notes.txt",
            path: "/root/notes.txt",
            size_bytes: 128
          })
        ]
      }
    });
    renameFileMock.mockResolvedValue({
      kind: "success",
      data: { success: true, message: "remote path moved" }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const sourceRow = (await screen.findByText("notes.txt")).closest(".file-row");
    const targetRow = (await screen.findByText("logs")).closest(".file-row");
    expect(sourceRow).not.toBeNull();
    expect(targetRow).not.toBeNull();

    fireEvent.dragStart(sourceRow as HTMLElement, {
      dataTransfer: createDragDataTransfer()
    });
    fireEvent.dragOver(targetRow as HTMLElement, {
      dataTransfer: createDragDataTransfer()
    });
    fireEvent.drop(targetRow as HTMLElement, {
      dataTransfer: createDragDataTransfer("/root/notes.txt")
    });

    const dialog = await screen.findByRole("dialog", { name: "Move item?" });
    expect(within(dialog).getByText(/\/root\/notes\.txt/)).toBeInTheDocument();
    expect(within(dialog).getByText(/\/root\/logs/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(renameFileMock).toHaveBeenCalledWith({
        host_id: "host-1",
        old_path: "/root/notes.txt",
        new_path: "/root/logs/notes.txt"
      })
    );
    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(2));
  });

  it("moves a directory into another directory from grid view", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "logs",
            path: "/root/logs",
            entry_type: "directory",
            permissions: "drwxr-xr-x"
          }),
          buildFileEntry({
            name: "archive",
            path: "/root/archive",
            entry_type: "directory",
            permissions: "drwxr-xr-x"
          })
        ]
      }
    });
    renameFileMock.mockResolvedValue({
      kind: "success",
      data: { success: true, message: "remote path moved" }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    await screen.findByText("archive");
    const viewMode = screen.getByRole("group", { name: "View mode" });
    await user.click(within(viewMode).getByRole("button", { name: "Grid view" }));

    const sourceTile = screen.getByText("archive").closest(".files-grid-item");
    const targetTile = screen.getByText("logs").closest(".files-grid-item");
    expect(sourceTile).not.toBeNull();
    expect(targetTile).not.toBeNull();

    fireEvent.dragStart(sourceTile as HTMLElement, {
      dataTransfer: createDragDataTransfer()
    });
    fireEvent.dragOver(targetTile as HTMLElement, {
      dataTransfer: createDragDataTransfer()
    });
    fireEvent.drop(targetTile as HTMLElement, {
      dataTransfer: createDragDataTransfer("/root/archive")
    });

    await user.click(await screen.findByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(renameFileMock).toHaveBeenCalledWith({
        host_id: "host-1",
        old_path: "/root/archive",
        new_path: "/root/logs/archive"
      })
    );
  });

  it("does not save edited content when the save confirmation is canceled", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    readFileContentMock.mockResolvedValue({
      kind: "success",
      data: {
        host_id: "host-1",
        path: "/root/notes.txt",
        content: "old contents",
        encoding: "utf-8",
        size_bytes: 12,
        last_modified_at: "2026-04-24T12:00:00Z"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("notes.txt")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);

    expect(await screen.findByText("old contents")).toBeInTheDocument();
    const editor = await screen.findByRole("textbox", { name: "File text content" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}new contents");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Save remote file?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Save remote file?" })).not.toBeInTheDocument());
    expect(writeFileContentMock).not.toHaveBeenCalled();
    expect(screen.getByText("new contents")).toBeInTheDocument();
  });

  it("shows a large file prompt instead of reading inline content", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          {
            ...directoryResponse.items[0],
            name: "large.log",
            path: "/root/large.log",
            size_bytes: 1024 * 1024 + 1
          }
        ]
      }
    });
    createDownloadTaskMock.mockResolvedValue({
      kind: "success",
      data: {
        task: {
          id: "task-1",
          task_type: "download",
          status: "transferring",
          file_name: "large.log",
          total_bytes: 1024 * 1024 + 1,
          transferred_bytes: 64,
          source_host_id: "host-1",
          source_path: "/root/large.log"
        }
      }
    });
    waitForTransferTaskMock.mockResolvedValue({
      ...completedDownloadTask,
      source_path: "/root/large.log",
      file_name: "large.log"
    });
    const blob = new Blob(["large"]);
    downloadTransferTaskContentMock.mockResolvedValue(blob);

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const row = (await screen.findByText("large.log")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);

    expect(await screen.findByText(/exceeds the 1\.0 MB inline preview limit/)).toBeInTheDocument();
    expect(readFileContentMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(createDownloadTaskMock).toHaveBeenCalledWith({
        host_id: "host-1",
        source_path: "/root/large.log"
      })
    );
    expect(saveBlobAsFileMock).toHaveBeenCalledWith(blob, "large.log");
  });

  it("previews image files from remote blobs with case-insensitive extensions", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "PHOTO.PNG",
            path: "/root/PHOTO.PNG",
            size_bytes: 256
          })
        ]
      }
    });
    createDownloadTaskMock.mockResolvedValue({
      kind: "success",
      data: {
        task: {
          id: "image-task-1",
          task_type: "download",
          status: "transferring",
          file_name: "PHOTO.PNG",
          total_bytes: 256,
          transferred_bytes: 128,
          source_host_id: "host-1",
          source_path: "/root/PHOTO.PNG"
        }
      }
    });
    waitForTransferTaskMock.mockResolvedValue({
      ...completedDownloadTask,
      id: "image-task-1",
      file_name: "PHOTO.PNG",
      source_path: "/root/PHOTO.PNG",
      total_bytes: 256,
      transferred_bytes: 256
    });
    const blob = new Blob(["image"], { type: "image/png" });
    downloadTransferTaskContentMock.mockResolvedValue(blob);
    createObjectURLMock.mockReturnValue("blob:image-preview");

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const row = (await screen.findByText("PHOTO.PNG")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);

    await waitFor(() =>
      expect(createDownloadTaskMock).toHaveBeenCalledWith({
        host_id: "host-1",
        source_path: "/root/PHOTO.PNG"
      })
    );
    expect(downloadTransferTaskContentMock).toHaveBeenCalledWith("image-task-1");
    const image = await screen.findByRole("img", { name: "PHOTO.PNG" });
    expect(image).toHaveAttribute("src", "blob:image-preview");
    expect(screen.getByText("IMAGE")).toBeInTheDocument();
  });

  it("previews PDF files with page and zoom controls", async () => {
    listDirectoryMock.mockResolvedValue({
      kind: "success",
      data: {
        ...directoryResponse,
        items: [
          buildFileEntry({
            name: "REPORT.PDF",
            path: "/root/REPORT.PDF",
            size_bytes: 512
          })
        ]
      }
    });
    createDownloadTaskMock.mockResolvedValue({
      kind: "success",
      data: {
        task: {
          id: "pdf-task-1",
          task_type: "download",
          status: "transferring",
          file_name: "REPORT.PDF",
          total_bytes: 512,
          transferred_bytes: 256,
          source_host_id: "host-1",
          source_path: "/root/REPORT.PDF"
        }
      }
    });
    waitForTransferTaskMock.mockResolvedValue({
      ...completedDownloadTask,
      id: "pdf-task-1",
      file_name: "REPORT.PDF",
      source_path: "/root/REPORT.PDF",
      total_bytes: 512,
      transferred_bytes: 512
    });
    downloadTransferTaskContentMock.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    createObjectURLMock.mockReturnValue("blob:pdf-preview");

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    const row = (await screen.findByText("REPORT.PDF")).closest(".file-row");
    expect(row).not.toBeNull();
    await user.dblClick(row as HTMLElement);

    await waitFor(() =>
      expect(createDownloadTaskMock).toHaveBeenCalledWith({
        host_id: "host-1",
        source_path: "/root/REPORT.PDF"
      })
    );
    expect(await screen.findByText("PDF")).toBeInTheDocument();
    expect(await screen.findByText("Page 1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  });

  it("uploads a selected local file in chunks and refreshes the directory", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    initUploadTaskMock.mockResolvedValue({
      task_id: "upload-task-1",
      chunk_size: 5,
      resume_offset: 0,
      status: "uploading_to_platform"
    });
    uploadTransferChunkMock
      .mockResolvedValueOnce({
        accepted_bytes: 5,
        received_bytes: 5,
        next_offset: 5,
        status: "uploading_to_platform"
      })
      .mockResolvedValueOnce({
        accepted_bytes: 5,
        received_bytes: 10,
        next_offset: 10,
        status: "uploading_to_platform"
      })
      .mockResolvedValueOnce({
        accepted_bytes: 1,
        received_bytes: 11,
        next_offset: 11,
        status: "queued_for_remote_transfer"
      });
    waitForTransferTaskMock.mockResolvedValue(completedUploadTask);

    const user = userEvent.setup();
    const { container } = renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const uploadInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(uploadInput).not.toBeNull();

    const file = new File(["hello world"], "upload.txt", { type: "text/plain" });
    await user.upload(uploadInput as HTMLInputElement, file);

    await waitFor(() =>
      expect(initUploadTaskMock).toHaveBeenCalledWith({
        target_host_id: "host-1",
        target_path: "/root",
        file_name: "upload.txt",
        file_size: 11
      })
    );
    expect(uploadTransferChunkMock).toHaveBeenNthCalledWith(1, "upload-task-1", 0, expect.any(Blob));
    expect(uploadTransferChunkMock).toHaveBeenNthCalledWith(2, "upload-task-1", 5, expect.any(Blob));
    expect(uploadTransferChunkMock).toHaveBeenNthCalledWith(3, "upload-task-1", 10, expect.any(Blob));
    expect(waitForTransferTaskMock).toHaveBeenCalledWith(
      "upload-task-1",
      expect.objectContaining({
        timeoutMessage: "Transfer task polling timed out."
      })
    );
    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(2));
  });

  it("requires confirmation before uploading over an existing remote name", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    initUploadTaskMock.mockResolvedValue({
      task_id: "upload-task-1",
      chunk_size: 5,
      resume_offset: 0,
      status: "uploading_to_platform"
    });
    uploadTransferChunkMock.mockResolvedValue({
      accepted_bytes: 5,
      received_bytes: 5,
      next_offset: 5,
      status: "queued_for_remote_transfer"
    });
    waitForTransferTaskMock.mockResolvedValue({
      ...completedUploadTask,
      file_name: "notes.txt",
      total_bytes: 5,
      transferred_bytes: 5
    });

    const user = userEvent.setup();
    const { container } = renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    const uploadInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(uploadInput).not.toBeNull();
    await user.upload(uploadInput as HTMLInputElement, new File(["hello"], "notes.txt", { type: "text/plain" }));

    const dialog = (await screen.findByRole("heading", { name: "Overwrite remote file?" })).closest("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(within(dialog as HTMLElement).getByText(/notes\.txt/)).toBeInTheDocument();
    expect(initUploadTaskMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continue upload" }));

    await waitFor(() =>
      expect(initUploadTaskMock).toHaveBeenCalledWith({
        target_host_id: "host-1",
        target_path: "/root",
        file_name: "notes.txt",
        file_size: 5
      })
    );
    expect(await screen.findByText("Upload completed")).toBeInTheDocument();
  });

  it("does not create an upload task when overwrite confirmation is canceled", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });

    const user = userEvent.setup();
    const { container } = renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    const uploadInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(uploadInput).not.toBeNull();
    await user.upload(uploadInput as HTMLInputElement, new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(await screen.findByRole("heading", { name: "Overwrite remote file?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Overwrite remote file?" })).not.toBeInTheDocument());
    expect(initUploadTaskMock).not.toHaveBeenCalled();
  });

  it("uploads dropped files sequentially and shows queue status", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    initUploadTaskMock
      .mockResolvedValueOnce({
        task_id: "upload-task-1",
        chunk_size: 5,
        resume_offset: 0,
        status: "uploading_to_platform"
      })
      .mockResolvedValueOnce({
        task_id: "upload-task-2",
        chunk_size: 5,
        resume_offset: 0,
        status: "uploading_to_platform"
      });
    uploadTransferChunkMock
      .mockResolvedValueOnce({
        accepted_bytes: 5,
        received_bytes: 5,
        next_offset: 5,
        status: "queued_for_remote_transfer"
      })
      .mockResolvedValueOnce({
        accepted_bytes: 4,
        received_bytes: 4,
        next_offset: 4,
        status: "queued_for_remote_transfer"
      });
    waitForTransferTaskMock
      .mockResolvedValueOnce({
        ...completedUploadTask,
        id: "upload-task-1",
        file_name: "alpha.txt",
        total_bytes: 5,
        transferred_bytes: 5
      })
      .mockResolvedValueOnce({
        ...completedUploadTask,
        id: "upload-task-2",
        file_name: "beta.txt",
        total_bytes: 4,
        transferred_bytes: 4
      });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);

    const dropzone = await screen.findByRole("button", { name: /drop files to upload/i });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(["alpha"], "alpha.txt", { type: "text/plain" }),
          new File(["beta"], "beta.txt", { type: "text/plain" })
        ]
      }
    });

    await waitFor(() => expect(initUploadTaskMock).toHaveBeenCalledTimes(2));
    expect(initUploadTaskMock).toHaveBeenNthCalledWith(1, {
      target_host_id: "host-1",
      target_path: "/root",
      file_name: "alpha.txt",
      file_size: 5
    });
    expect(initUploadTaskMock).toHaveBeenNthCalledWith(2, {
      target_host_id: "host-1",
      target_path: "/root",
      file_name: "beta.txt",
      file_size: 4
    });
    expect(uploadTransferChunkMock).toHaveBeenNthCalledWith(1, "upload-task-1", 0, expect.any(Blob));
    expect(uploadTransferChunkMock).toHaveBeenNthCalledWith(2, "upload-task-2", 0, expect.any(Blob));
    expect(waitForTransferTaskMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("alpha.txt")).toBeInTheDocument();
    expect(await screen.findByText("beta.txt")).toBeInTheDocument();
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    await waitFor(() => expect(listDirectoryMock).toHaveBeenCalledTimes(2));
  });

  it("starts a remote search task and displays remote results separately", async () => {
    listDirectoryMock.mockResolvedValue({ kind: "success", data: directoryResponse });
    createFileSearchTaskMock.mockResolvedValue({
      kind: "success",
      data: {
        task: remoteSearchTask
      }
    });
    getFileSearchTaskMock.mockResolvedValue({
      kind: "success",
      data: {
        task: remoteSearchTask
      }
    });
    listFileSearchTaskResultsMock
      .mockResolvedValueOnce({
        kind: "success",
        data: {
          items: [
            {
              id: "result-1",
              task_id: "search-task-1",
              rank: 1,
              name: "app.log",
              path: "/root/logs/app.log",
              entry_type: "file",
              size_bytes: 20,
              permissions: "0644",
              owner: "root",
              group: "root",
              modified_at: "2026-04-24T12:00:00Z",
              is_hidden: false,
              created_at: "2026-04-24T12:00:01Z"
            }
          ],
          page: 1,
          page_size: 50,
          total: 70
        }
      })
      .mockResolvedValueOnce({
        kind: "success",
        data: {
          items: [
            {
              id: "result-2",
              task_id: "search-task-1",
              rank: 51,
              name: "worker.log",
              path: "/root/logs/worker.log",
              entry_type: "file",
              size_bytes: 32,
              permissions: "0644",
              owner: "root",
              group: "root",
              modified_at: "2026-04-24T12:00:00Z",
              is_hidden: false,
              created_at: "2026-04-24T12:00:01Z"
            }
          ],
          page: 2,
          page_size: 50,
          total: 70
        }
      });

    const user = userEvent.setup();
    renderWithPageProviders(<FilesPage />);

    await connectFileHost(user);
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remote search" }));
    const searchDialog = await screen.findByRole("dialog", { name: "Remote search" });
    expect(within(searchDialog).getByText("Search scope: /root")).toBeInTheDocument();
    await user.type(within(searchDialog).getByLabelText("Keyword"), "log");
    await selectInputOption(user, within(searchDialog).getByLabelText("Depth"), "2");
    await user.click(within(searchDialog).getByRole("button", { name: "Start remote search" }));

    await waitFor(() =>
      expect(createFileSearchTaskMock).toHaveBeenCalledWith({
        host_id: "host-1",
        base_path: "/root",
        keyword: "log",
        match_mode: "path",
        recursive: true,
        include_hidden: false,
        max_depth: 2,
        max_results: 500,
        max_scanned_entries: 50000,
        timeout_seconds: 30
      })
    );
    expect(getFileSearchTaskMock).toHaveBeenCalledWith("search-task-1");
    expect(listFileSearchTaskResultsMock).toHaveBeenCalledWith({
      task_id: "search-task-1",
      page: 1,
      page_size: 50
    });
    expect(await within(searchDialog).findByText("app.log")).toBeInTheDocument();
    expect(within(searchDialog).getByText("/root/logs/app.log")).toBeInTheDocument();
    expect(within(searchDialog).getByText("Page 1 / 2, 70 results total.")).toBeInTheDocument();

    await user.click(within(searchDialog).getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(listFileSearchTaskResultsMock).toHaveBeenCalledWith({
        task_id: "search-task-1",
        page: 2,
        page_size: 50
      })
    );
    expect(await within(searchDialog).findByText("worker.log")).toBeInTheDocument();
    expect(within(searchDialog).getByText("Page 2 / 2, 70 results total.")).toBeInTheDocument();

    await user.click(within(searchDialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remote search" })).not.toBeInTheDocument());

    listDirectoryMock.mockResolvedValueOnce({
      kind: "success",
      data: {
        ...directoryResponse,
        path: "/",
        items: []
      }
    });
    await user.click(screen.getByRole("button", { name: "Go to root" }));
    await waitFor(() =>
      expect(listDirectoryMock).toHaveBeenLastCalledWith({
        host_id: "host-1",
        path: "/",
        limit: 200
      })
    );

    await user.click(screen.getByRole("button", { name: "Remote search" }));
    const reopenedSearchDialog = await screen.findByRole("dialog", { name: "Remote search" });
    expect(within(reopenedSearchDialog).getByText("Search scope: /root")).toBeInTheDocument();
    expect(within(reopenedSearchDialog).queryByText("Search scope: /")).not.toBeInTheDocument();
  });
});
