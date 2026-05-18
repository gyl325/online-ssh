import { act, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPageProviders } from "../test/renderWithProviders";
import { selectInputOption } from "../test/selectInput";
import { HttpError } from "../shared/api/http";
import { TerminalPage } from "./TerminalPage";
import * as connectionApi from "../features/connections/api";
import * as credentialApi from "../features/credentials/api";
import { confirmHostFingerprint } from "../features/fingerprint/api";
import type { Credential } from "../features/credentials/types";
import type { Host, HostFingerprintConflictResponse, HostListResponse } from "../features/hosts/types";
import type { SavedCommand, SavedCommandListResponse } from "../features/savedCommands/types";
import type { CreateTerminalSessionResponse, TerminalRecording, TerminalSessionListResponse } from "../features/terminal/types";
import * as hostApi from "../features/hosts/api";
import * as savedCommandApi from "../features/savedCommands/api";
import * as terminalApi from "../features/terminal/api";
import * as downloadLib from "../shared/lib/download";
import stylesCss from "../styles.css?raw";

const historyTerminalMocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    scrollToBottom: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
  }>,
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
  }>
}));

const terminalPaneMocks = vi.hoisted(() => ({
  sentInputs: [] as Array<{ sessionId: string; text: string }>
}));

const resizeObserverMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>
}));

vi.mock("../features/hosts/api", () => ({
  getHostMetrics: vi.fn(),
  listHostGroups: vi.fn(),
  listHosts: vi.fn(),
  testHost: vi.fn()
}));

vi.mock("../features/credentials/api", () => ({
  listCredentials: vi.fn()
}));

vi.mock("../features/connections/api", () => ({
  createTemporaryConnection: vi.fn(),
  quickConnect: vi.fn()
}));

vi.mock("../features/terminal/api", () => ({
  closeTerminalSession: vi.fn(),
  createTerminalShare: vi.fn(),
  createQuickTerminalSession: vi.fn(),
  createTerminalSession: vi.fn(),
  deleteTerminalRecording: vi.fn(),
  extendTerminalShare: vi.fn(),
  generateTerminalCommand: vi.fn(),
  getTerminalRecording: vi.fn(),
  getTerminalRecordingSettings: vi.fn(),
  getTerminalSession: vi.fn(),
  getTerminalShare: vi.fn(),
  listTerminalShareAccessLogs: vi.fn(),
  listTerminalRecordingChunks: vi.fn(),
  listTerminalRecordings: vi.fn(),
  listTerminalSessions: vi.fn(),
  revokeTerminalShare: vi.fn(),
  setTerminalSessionKeepAlive: vi.fn(),
  updateTerminalRecordingBookmark: vi.fn(),
  updateTerminalRecordingSettings: vi.fn()
}));

vi.mock("../features/savedCommands/api", () => ({
  createSavedCommand: vi.fn(),
  deleteSavedCommand: vi.fn(),
  listSavedCommands: vi.fn(),
  updateSavedCommand: vi.fn()
}));

vi.mock("../shared/lib/download", () => ({
  saveBlobAsFile: vi.fn()
}));

vi.mock("../features/terminal/TerminalPane", () => ({
  TerminalPane: ({
    connectionInfoLabel,
    minimumRemoteResizeCols,
    onInput,
    onActivity,
    onOpenConnectionInfo,
    onStateChange,
    ref,
    resizeSuspended = false,
    showSurfaceActions = true,
    sessionId,
    websocketUrl
  }: {
    connectionInfoLabel?: string;
    onActivity?: (kind: "input" | "output") => void;
    onInput?: (data: string) => void;
    onOpenConnectionInfo?: () => void;
    onStateChange: (update: {
      message?: string;
      reconnectRequested?: boolean;
      status?: "connecting" | "connected" | "disconnected" | "failed" | "reconnecting";
    }) => void;
    ref?: Ref<{ sendInput: (text: string) => boolean; toggleBrowserFullscreen: () => void }>;
    minimumRemoteResizeCols?: number;
    resizeSuspended?: boolean;
    showSurfaceActions?: boolean;
    sessionId: string;
    websocketUrl: string;
  }) => {
    useImperativeHandle(ref, () => ({
      sendInput(text: string) {
        terminalPaneMocks.sentInputs.push({ sessionId, text });
        return true;
      },
      toggleBrowserFullscreen() {
        return undefined;
      }
    }), [sessionId]);

    return (
      <div>
        <div data-minimum-remote-resize-cols={minimumRemoteResizeCols ?? "default"} data-testid={`terminal-pane-min-cols-${sessionId}`} />
        <div data-resize-suspended={resizeSuspended ? "true" : "false"} data-testid={`terminal-pane-resize-${sessionId}`} />
        <div data-testid="terminal-pane-session">{sessionId}</div>
        <div data-testid="terminal-pane-websocket">{websocketUrl}</div>
        {showSurfaceActions ? (
          <button type="button" onClick={onOpenConnectionInfo}>
            {connectionInfoLabel}
          </button>
        ) : null}
        <button type="button" onClick={() => onStateChange({ status: "connecting", message: "WebSocket connected, waiting for remote PTY" })}>
          emit websocket log
        </button>
        <button type="button" onClick={() => onStateChange({ status: "connected", message: "Connected" })}>
          emit terminal connected {sessionId}
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ status: "reconnecting", message: "connection lost", reconnectRequested: true })}
        >
          emit terminal reconnect {sessionId}
        </button>
        <button
          type="button"
          onClick={() => {
            onActivity?.("input");
            onInput?.("broadcast-input");
          }}
        >
          emit terminal input {sessionId}
        </button>
        <button type="button" onClick={() => onActivity?.("output")}>
          emit terminal output
        </button>
      </div>
    );
  }
}));

vi.mock("../features/fingerprint/api", () => ({
  confirmHostFingerprint: vi.fn()
}));

vi.mock("xterm", () => ({
  Terminal: vi.fn().mockImplementation(function MockTerminal(options: Record<string, unknown>) {
    const terminal = {
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        callback?.();
      }),
      reset: vi.fn(),
      scrollToBottom: vi.fn(),
      dispose: vi.fn(),
      options
    };
    historyTerminalMocks.terminals.push(terminal);
    return terminal;
  })
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function MockFitAddon() {
    const addon = {
      fit: vi.fn()
    };
    historyTerminalMocks.fitAddons.push(addon);
    return addon;
  })
}));

const listHostsMock = vi.mocked(hostApi.listHosts);
const listHostGroupsMock = vi.mocked(hostApi.listHostGroups);
const getHostMetricsMock = vi.mocked(hostApi.getHostMetrics);
const testHostMock = vi.mocked(hostApi.testHost);
const listCredentialsMock = vi.mocked(credentialApi.listCredentials);
const quickConnectMock = vi.mocked(connectionApi.quickConnect);
const createTemporaryConnectionMock = vi.mocked(connectionApi.createTemporaryConnection);
const createQuickTerminalSessionMock = vi.mocked(terminalApi.createQuickTerminalSession);
const createTerminalSessionMock = vi.mocked(terminalApi.createTerminalSession);
const getTerminalSessionMock = vi.mocked(terminalApi.getTerminalSession);
const listTerminalSessionsMock = vi.mocked(terminalApi.listTerminalSessions);
const closeTerminalSessionMock = vi.mocked(terminalApi.closeTerminalSession);
const setTerminalSessionKeepAliveMock = vi.mocked(terminalApi.setTerminalSessionKeepAlive);
const createTerminalShareMock = vi.mocked(terminalApi.createTerminalShare);
const getTerminalShareMock = vi.mocked(terminalApi.getTerminalShare);
const extendTerminalShareMock = vi.mocked(terminalApi.extendTerminalShare);
const generateTerminalCommandMock = vi.mocked(terminalApi.generateTerminalCommand);
const revokeTerminalShareMock = vi.mocked(terminalApi.revokeTerminalShare);
const listTerminalShareAccessLogsMock = vi.mocked(terminalApi.listTerminalShareAccessLogs);
const getTerminalRecordingSettingsMock = vi.mocked(terminalApi.getTerminalRecordingSettings);
const updateTerminalRecordingSettingsMock = vi.mocked(terminalApi.updateTerminalRecordingSettings);
const listTerminalRecordingsMock = vi.mocked(terminalApi.listTerminalRecordings);
const listTerminalRecordingChunksMock = vi.mocked(terminalApi.listTerminalRecordingChunks);
const deleteTerminalRecordingMock = vi.mocked(terminalApi.deleteTerminalRecording);
const updateTerminalRecordingBookmarkMock = vi.mocked(terminalApi.updateTerminalRecordingBookmark);
const listSavedCommandsMock = vi.mocked(savedCommandApi.listSavedCommands);
const createSavedCommandMock = vi.mocked(savedCommandApi.createSavedCommand);
const updateSavedCommandMock = vi.mocked(savedCommandApi.updateSavedCommand);
const confirmHostFingerprintMock = vi.mocked(confirmHostFingerprint);
const saveBlobAsFileMock = vi.mocked(downloadLib.saveBlobAsFile);

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

const secondaryHost: Host = {
  ...host,
  id: "host-2",
  credential_id: "cred-2",
  name: "Worker SSH",
  host: "10.0.0.2",
  username: "ubuntu"
};

const hostList: HostListResponse = {
  items: [host, secondaryHost],
  page: 1,
  page_size: 100,
  total: 2
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

const emptySessions: TerminalSessionListResponse = {
  items: []
};

const emptySavedCommands: SavedCommandListResponse = {
  items: []
};

const connectedSessions: TerminalSessionListResponse = {
  items: [
    {
      id: "session-1",
      host_id: "host-1",
      status: "connected",
      started_at: "2026-04-24T12:00:00Z",
      attached: false,
      detached_at: null,
      expires_at: null,
      keep_alive_until: null
    },
    {
      id: "session-2",
      host_id: "host-2",
      status: "connected",
      started_at: "2026-04-24T13:00:00Z",
      attached: false,
      detached_at: null,
      expires_at: null,
      keep_alive_until: null
    }
  ]
};

const threeConnectedSessions: TerminalSessionListResponse = {
  items: [
    ...connectedSessions.items,
    {
      id: "session-3",
      host_id: "host-2",
      status: "connected",
      started_at: "2026-04-24T14:00:00Z",
      attached: false,
      detached_at: null,
      expires_at: null,
      keep_alive_until: null
    }
  ]
};

const manyConnectedSessions: TerminalSessionListResponse = {
  items: Array.from({ length: 17 }, (_, index) => ({
    id: `session-${index + 1}`,
    host_id: `host-${index + 1}`,
    status: "connected" as const,
    started_at: `2026-04-24T${String(10 + (index % 10)).padStart(2, "0")}:00:00Z`,
    attached: false,
    detached_at: null,
    expires_at: null,
    keep_alive_until: null
  }))
};

const savedCommand: SavedCommand = {
  id: "command-1",
  user_id: "user-1",
  name: "Check disk",
  command_text: "df -h",
  category: "Filesystem",
  description: "Disk usage",
  sort_order: 0,
  created_at: "2026-04-26T10:00:00Z",
  updated_at: "2026-04-26T10:00:00Z"
};

const quickCredential: Credential = {
  id: "cred-quick",
  name: "Quick credential",
  auth_type: "password",
  has_secret: true,
  key_version: "1",
  is_default: false,
  created_at: "2026-04-30T00:00:00Z",
  updated_at: "2026-04-30T00:00:00Z"
};

const terminalRecording: TerminalRecording = {
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

const createResponse: CreateTerminalSessionResponse = {
  session: {
    id: "session-1",
    host_id: "host-1",
    status: "connected",
    started_at: "2026-04-24T12:00:00Z",
    attached: false,
    detached_at: null,
    expires_at: null,
    keep_alive_until: null
  },
  websocket: {
    url: "ws://example.test/ws/terminal",
    protocol: "terminal.v1",
    token: null
  }
};

function createDataTransfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: "",
    effectAllowed: "",
    getData: vi.fn((type: string) => data.get(type) || ""),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    })
  };
}

function mockElementRect(element: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      bottom: rect.bottom ?? 600,
      height: rect.height ?? 600,
      left: rect.left ?? 0,
      right: rect.right ?? 1200,
      top: rect.top ?? 0,
      width: rect.width ?? 1200,
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      toJSON: () => ({})
    }))
  });
}

function emitResize(element: Element, width: number, height = 30) {
  resizeObserverMocks.instances.forEach((observer) => {
    observer.callback([
      {
        target: element,
        contentRect: {
          bottom: height,
          height,
          left: 0,
          right: width,
          top: 0,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({})
        } as DOMRectReadOnly
      } as ResizeObserverEntry
    ], observer as unknown as ResizeObserver);
  });
}

function fireTerminalDragOver(
  element: HTMLElement,
  options: { clientX: number; clientY: number; dataTransfer: ReturnType<typeof createDataTransfer> }
) {
  const event = createEvent.dragOver(element, { dataTransfer: options.dataTransfer });
  Object.defineProperty(event, "clientX", { configurable: true, value: options.clientX });
  Object.defineProperty(event, "clientY", { configurable: true, value: options.clientY });
  fireEvent(element, event);
}

function fireTerminalDrop(
  element: HTMLElement,
  options: { clientX: number; clientY: number; dataTransfer: ReturnType<typeof createDataTransfer> }
) {
  const event = createEvent.drop(element, { dataTransfer: options.dataTransfer });
  Object.defineProperty(event, "clientX", { configurable: true, value: options.clientX });
  Object.defineProperty(event, "clientY", { configurable: true, value: options.clientY });
  fireEvent(element, event);
}

function buildBalancedSplitLayout(tabIds: string[]): unknown {
  if (tabIds.length === 1) {
    return { type: "leaf", tabId: tabIds[0] };
  }
  const mid = Math.floor(tabIds.length / 2);
  return {
    type: "split",
    direction: tabIds.length >= 4 ? "horizontal" : "vertical",
    ratio: 0.5,
    children: [
      buildBalancedSplitLayout(tabIds.slice(0, mid)),
      buildBalancedSplitLayout(tabIds.slice(mid))
    ]
  };
}

function buildLinearSplitLayout(tabIds: string[], direction: "vertical" | "horizontal"): unknown {
  if (tabIds.length === 1) {
    return { type: "leaf", tabId: tabIds[0] };
  }
  return {
    type: "split",
    direction,
    ratio: 1 / tabIds.length,
    children: [
      { type: "leaf", tabId: tabIds[0] },
      buildLinearSplitLayout(tabIds.slice(1), direction)
    ]
  };
}

function buildTwoRowColumnSplit(topTabId: string, bottomTabId: string): unknown {
  return {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { type: "leaf", tabId: topTabId },
      { type: "leaf", tabId: bottomTabId }
    ]
  };
}

function buildFourColumnTwoRowLayout(): unknown {
  return {
    type: "split",
    direction: "vertical",
    ratio: 0.25,
    children: [
      buildTwoRowColumnSplit("session-1", "session-2"),
      {
        type: "split",
        direction: "vertical",
        ratio: 1 / 3,
        children: [
          buildTwoRowColumnSplit("session-3", "session-4"),
          {
            type: "split",
            direction: "vertical",
            ratio: 0.5,
            children: [
              buildTwoRowColumnSplit("session-5", "session-6"),
              buildTwoRowColumnSplit("session-7", "session-8")
            ]
          }
        ]
      }
    ]
  };
}

describe("TerminalPage", () => {
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalExecCommand = document.execCommand;
    historyTerminalMocks.terminals.length = 0;
    historyTerminalMocks.fitAddons.length = 0;
    terminalPaneMocks.sentInputs.length = 0;
    resizeObserverMocks.instances.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: ResizeObserverCallback;
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          resizeObserverMocks.instances.push(this);
        }
      }
    );
    listHostsMock.mockResolvedValue(hostList);
    getHostMetricsMock.mockResolvedValue({
      metrics: {
        host_id: "host-1",
        collected_at: "2026-05-10T10:00:00Z",
        system: {
          hostname: "prod-node",
          os_name: "Ubuntu 22.04.2 LTS",
          kernel: "6.8.0-101-generic"
        },
        ssh: {
          user: "root",
          client: "203.0.113.8 55000 22"
        },
        login: {
          last_login: "root pts/0 203.0.113.8 Sun May 10 09:30"
        }
      }
    });
    testHostMock.mockResolvedValue({
      kind: "success",
      data: {
        ok: true,
        message: "connected",
        fingerprint: {
          algorithm: "ssh-ed25519",
          fingerprint: "SHA256:quick-test",
          status: "trusted"
        }
      }
    });
    listCredentialsMock.mockResolvedValue({ items: [], page: 1, page_size: 100, total: 0 });
    listHostGroupsMock.mockResolvedValue({ items: [] });
    quickConnectMock.mockResolvedValue({
      credential: quickCredential,
      created_credential: true,
      host
    });
    createTemporaryConnectionMock.mockResolvedValue({
      host: {
        ...host,
        id: "tmp-file-1",
        name: "root@203.0.113.40",
        host: "203.0.113.40",
        credential_id: null
      }
    });
    createQuickTerminalSessionMock.mockResolvedValue({
      ...createResponse,
      session: {
        ...createResponse.session,
        id: "quick-session-1",
        host_id: "quick-root-203-0-113-40"
      }
    });
    getTerminalSessionMock.mockResolvedValue({ session: createResponse.session });
    listTerminalSessionsMock.mockResolvedValue(emptySessions);
    getTerminalShareMock.mockRejectedValue(new HttpError(404, { code: "NOT_FOUND", message: "terminal share not found" }));
    createTerminalShareMock.mockResolvedValue({
      token: "share-token",
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2026-05-09T12:10:00Z",
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2,
        url: "https://app.example.com/share/terminal/share-token"
      }
    });
    extendTerminalShareMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2026-05-09T12:30:00Z",
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2
      }
    });
    generateTerminalCommandMock.mockResolvedValue({
      result: {
        command_text: "find /var/log -type f -name '*.log' -mtime -1",
        name: "Find recent logs",
        category: "Logs",
        description: "Find log files modified in the last day",
        risk_level: "medium",
        notes: ["Review the path before running."]
      }
    });
    revokeTerminalShareMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2026-05-09T12:10:00Z",
        revoked_at: "2026-05-09T12:00:00Z",
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 0
      }
    });
    listTerminalShareAccessLogsMock.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 20,
      total: 0
    });
    getTerminalRecordingSettingsMock.mockResolvedValue({
      settings: { enabled: false, retention_days: 7, updated_at: null }
    });
    updateTerminalRecordingSettingsMock.mockResolvedValue({
      settings: { enabled: true, retention_days: 3, updated_at: "2026-04-30T12:10:00Z" }
    });
    listTerminalRecordingsMock.mockResolvedValue({
      items: [terminalRecording],
      page: 1,
      page_size: 20,
      total: 1
    });
    updateTerminalRecordingBookmarkMock.mockResolvedValue({
      recording: { ...terminalRecording, is_bookmarked: true }
    });
    listTerminalRecordingChunksMock.mockResolvedValue({
      items: [
        {
          sequence: 1,
          direction: "input",
          occurred_at: "2026-04-30T12:01:00Z",
          data: "whoami\n",
          byte_count: 7
        },
        {
          sequence: 2,
          direction: "output",
          occurred_at: "2026-04-30T12:01:01Z",
          data: "\u001b]0;root@example: ~\u0007\u001b[01;32mroot@example\u001b[00m:~$ whoami\r\nroot\r\n",
          byte_count: 64
        },
        {
          sequence: 3,
          direction: "input",
          occurred_at: "2026-04-30T12:01:02Z",
          data: "not-echoed-secret",
          byte_count: 17
        },
        {
          sequence: 4,
          direction: "output",
          occurred_at: "2026-04-30T12:01:03Z",
          data: "clear\r\n\u001b[H\u001b[2J\u001b[3J\u001b]0;root@example: ~\u0007\u001b[01;32mroot@example\u001b[00m:~$ ",
          byte_count: 92
        }
      ],
      next_cursor: 4,
      has_more: false
    });
    deleteTerminalRecordingMock.mockResolvedValue(undefined);
    listSavedCommandsMock.mockResolvedValue(emptySavedCommands);
    createSavedCommandMock.mockResolvedValue({
      command: {
        ...savedCommand,
        id: "command-2",
        name: "Show processes",
        command_text: "ps aux",
        category: "System",
        description: null,
        updated_at: "2026-04-26T11:00:00Z"
      }
    });
    updateSavedCommandMock.mockResolvedValue({
      command: {
        ...savedCommand,
        name: "Check disk usage",
        updated_at: "2026-04-26T11:30:00Z"
      }
    });
    confirmHostFingerprintMock.mockResolvedValue({
      fingerprint: {
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:current-fingerprint",
        status: "trusted"
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: originalExecCommand
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries terminal creation after fingerprint confirmation from the host query entrypoint", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock
      .mockResolvedValueOnce({ kind: "fingerprint_conflict", data: fingerprintConflict })
      .mockResolvedValueOnce({ kind: "success", data: createResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("fingerprint changed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm fingerprint and continue|确认 fingerprint 并继续/i }));

    await waitFor(() => expect(createTerminalSessionMock).toHaveBeenCalledTimes(2));
    expect(createTerminalSessionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        host_id: "host-1",
        rows: 36,
        cols: 120
      })
    );
    expect(createTerminalSessionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        host_id: "host-1",
        rows: 36,
        cols: 120
      })
    );
    expect(confirmHostFingerprintMock).toHaveBeenCalledWith("host-1", {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:current-fingerprint"
    });
    expect(await screen.findByRole("tab", { name: /Prod SSH/i })).toBeInTheDocument();
    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
  });

  it("uses a provided host catalog for the host query entrypoint without refetching hosts", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    renderWithPageProviders(
      <TerminalPage hostCatalog={{ hosts: hostList.items, hostsLoading: false }} />,
      { route: "/terminal?host_id=host-1" }
    );

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    expect(await screen.findByRole("tab", { name: /Prod SSH/i })).toBeInTheDocument();
    expect(createTerminalSessionMock).toHaveBeenCalledWith(expect.objectContaining({ host_id: "host-1" }));
    expect(listHostsMock).not.toHaveBeenCalled();
  });

  it("clears scheduled terminal reconnect checks when unmounted", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    const { unmount } = renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /emit terminal reconnect session-1/i }));

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(getTerminalSessionMock).not.toHaveBeenCalled();
  });

  it("opens a terminal from the host query, toggles keepalive, and closes the tab", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });
    setTerminalSessionKeepAliveMock.mockResolvedValue({
      session: {
        ...createResponse.session,
        keep_alive_until: "2026-04-25T12:00:00Z",
        expires_at: "2026-04-25T12:00:00Z",
        attached: true,
        detached_at: null
      }
    });
    closeTerminalSessionMock.mockResolvedValue({
      session: {
        ...createResponse.session,
        status: "disconnected"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    expect(await screen.findByRole("tab", { name: /Prod SSH/i })).toBeInTheDocument();

    expect(screen.getByTestId("terminal-pane-header")).toBeInTheDocument();
    const prodTab = screen.getByRole("tab", { name: /Prod SSH/i });
    expect(within(prodTab).queryByText("Connected")).not.toBeInTheDocument();
    expect(within(prodTab).queryByRole("button", { name: "Enable background keepalive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connection info" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close Prod SSH pane" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions for Prod SSH" }));
    expect(screen.queryByRole("button", { name: "Connection log" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Enable background keepalive" }));

    await waitFor(() =>
      expect(setTerminalSessionKeepAliveMock).toHaveBeenCalledWith("session-1", true)
    );
    await waitFor(() => {
      expect(screen.getByText("Connected").closest(".terminal-status")).toHaveClass("terminal-status-keepalive");
    });

    await user.click(screen.getByRole("button", { name: "More actions for Prod SSH" }));
    expect(await screen.findByRole("button", { name: "Disable background keepalive" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(prodTab).getByRole("button", { name: "Close Prod SSH" }));
    expect(await screen.findByRole("dialog", { name: "Close terminal?" })).toBeInTheDocument();
    expect(closeTerminalSessionMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close terminal" }));

    await waitFor(() => expect(closeTerminalSessionMock).toHaveBeenCalledWith("session-1"));
    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
  });

  it("creates and manages a read-only terminal share from the pane menu", async () => {
    const activeShareExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    createTerminalShareMock.mockResolvedValueOnce({
      token: "share-token",
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: activeShareExpiresAt,
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2,
        url: "http://127.0.0.1:8080/share/terminal/share-token"
      }
    });
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    await user.click(screen.getByRole("button", { name: "More actions for Prod SSH" }));
    await user.click(await screen.findByRole("button", { name: "Share terminal" }));

    const dialog = await screen.findByRole("dialog", { name: "Share terminal" });
    expect(within(dialog).getByText(/information you type/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Description: visible to viewers")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Access limit"));
    await user.type(within(dialog).getByLabelText("Access limit"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Create share" }));

    await waitFor(() => expect(createTerminalShareMock).toHaveBeenCalledWith("session-1", expect.objectContaining({
      expires_in_minutes: 10,
      max_accesses: 5
    })));
    const expectedShareUrl = `${window.location.origin}/share/terminal/share-token`;
    expect(await within(dialog).findByText(expectedShareUrl)).toBeInTheDocument();
    expect(within(dialog).queryByText("http://127.0.0.1:8080/share/terminal/share-token")).not.toBeInTheDocument();
    expect(within(dialog).getByText("2 viewers")).toBeInTheDocument();
    expect(within(dialog).getByText("No password").closest(".ui-badge")).toHaveClass("ui-badge-neutral");
    expect(within(dialog).getByText(/left$/i).closest(".ui-badge")).toHaveClass("ui-badge-info");
    expect(within(dialog).queryByText("Terminal share created.")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Sharing" })).not.toBeInTheDocument();

    getTerminalShareMock.mockClear();
    getTerminalShareMock.mockResolvedValueOnce({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: activeShareExpiresAt,
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2
      }
    });
    await user.click(within(dialog).getByRole("button", { name: "Refresh share status" }));
    await waitFor(() => expect(getTerminalShareMock).toHaveBeenCalledWith("session-1"));
    expect(await within(dialog).findByText(expectedShareUrl)).toBeInTheDocument();
    expect(within(dialog).queryByText("http://127.0.0.1:8080/share/terminal/share-token")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: /Manage share for Prod SSH.*left/i })).toBeInTheDocument();
    getTerminalShareMock.mockResolvedValueOnce({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: activeShareExpiresAt,
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2,
        url: "http://127.0.0.1:8080/share/terminal/share-token"
      }
    });
    await user.click(screen.getByRole("button", { name: "More actions for Prod SSH" }));
    await user.click(await screen.findByRole("button", { name: "Sharing" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Share terminal" });
    expect(await within(manageDialog).findByText(expectedShareUrl)).toBeInTheDocument();
    expect(within(manageDialog).queryByText("The share link is only shown after creation. Revoke and create a new share if you need a new link.")).not.toBeInTheDocument();
    await user.click(within(manageDialog).getByRole("button", { name: "Revoke share" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Revoke terminal share?" })).getByRole("button", { name: "Revoke share" }));

    await waitFor(() => expect(revokeTerminalShareMock).toHaveBeenCalledWith("share-1"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Share terminal" })).not.toBeInTheDocument());
  });

  it("refreshes share status and access logs every five seconds while the share dialog is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-09T10:00:00Z"));
    const activeShareExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);
    getTerminalShareMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: activeShareExpiresAt,
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2,
        url: "https://app.example.com/share/terminal/share-token"
      }
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const shareIndicator = await screen.findByRole("button", { name: /Manage share for Prod SSH/i });
    await user.click(shareIndicator);
    const dialog = await screen.findByRole("dialog", { name: "Share terminal" });
    await waitFor(() => expect(listTerminalShareAccessLogsMock).toHaveBeenCalledWith("share-1", { page: 1, page_size: 8 }));

    getTerminalShareMock.mockClear();
    listTerminalShareAccessLogsMock.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(getTerminalShareMock).toHaveBeenCalledWith("session-1"));
    await waitFor(() => expect(listTerminalShareAccessLogsMock).toHaveBeenCalledWith("share-1", { page: 1, page_size: 8 }));

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    getTerminalShareMock.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getTerminalShareMock).not.toHaveBeenCalled();
  });

  it("clamps terminal share numeric inputs instead of showing validation errors", async () => {
    const activeShareExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    createTerminalShareMock.mockResolvedValueOnce({
      token: "share-token",
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: activeShareExpiresAt,
        revoked_at: null,
        max_accesses: 1000,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "",
        viewer_count: 0,
        url: "https://app.example.com/share/terminal/share-token"
      }
    });
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    await user.click(screen.getByRole("button", { name: "More actions for Prod SSH" }));
    await user.click(await screen.findByRole("button", { name: "Share terminal" }));

    const dialog = await screen.findByRole("dialog", { name: "Share terminal" });
    await user.clear(within(dialog).getByLabelText("Expires in minutes"));
    await user.type(within(dialog).getByLabelText("Expires in minutes"), "1");
    expect(within(dialog).getByLabelText("Expires in minutes")).toHaveValue("2");

    await user.clear(within(dialog).getByLabelText("Access limit"));
    await user.type(within(dialog).getByLabelText("Access limit"), "8000");
    expect(within(dialog).getByLabelText("Access limit")).toHaveValue("1000");
    await user.click(within(dialog).getByRole("button", { name: "Create share" }));

    await waitFor(() => expect(createTerminalShareMock).toHaveBeenCalledWith("session-1", expect.objectContaining({
      expires_in_minutes: 2,
      max_accesses: 1000
    })));
    expect(within(dialog).queryByText("Enter an expiry between 2 and 1440 minutes.")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Enter an access limit between 1 and 1000.")).not.toBeInTheDocument();
  });

  it("shows a red countdown share indicator in the final minute and removes it after expiry", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);
    const expiresAt = new Date(Date.now() + 1500).toISOString();
    getTerminalShareMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: expiresAt,
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: true,
        sensitive_prompt: "Sensitive production output",
        viewer_count: 2
      }
    });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const shareIndicator = await screen.findByRole("button", { name: /Manage share for Prod SSH.*(1|2)s left/i });
    expect(shareIndicator).toHaveClass("terminal-pane-share-indicator-countdown");
    expect(shareIndicator).toHaveTextContent(/(1|2)s/);
    expect(shareIndicator.querySelector("svg")).toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByRole("button", { name: /Manage share for Prod SSH/i })).not.toBeInTheDocument(),
      { timeout: 3000 }
    );
  });

  it("asks for confirmation before closing a terminal with pending input", async () => {
    listTerminalSessionsMock.mockResolvedValue({
      items: [connectedSessions.items[0]]
    });
    closeTerminalSessionMock.mockResolvedValue({
      session: {
        ...createResponse.session,
        status: "disconnected"
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const prodTab = await screen.findByRole("tab", { name: /Prod SSH/i });
    await user.click(screen.getByRole("button", { name: /emit terminal input/i }));
    await user.click(within(prodTab).getByRole("button", { name: "Close Prod SSH" }));

    expect(await screen.findByRole("dialog", { name: "Close terminal?" })).toBeInTheDocument();
    expect(closeTerminalSessionMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close terminal" }));

    await waitFor(() => expect(closeTerminalSessionMock).toHaveBeenCalledWith("session-1"));
  });

  it("keeps duplicate same-host terminal labels stable after closing a middle tab", async () => {
    listTerminalSessionsMock.mockResolvedValue({
      items: [
        {
          ...connectedSessions.items[0],
          id: "session-1",
          host_id: "host-1",
          started_at: "2026-04-24T12:00:00Z"
        },
        {
          ...connectedSessions.items[0],
          id: "session-2",
          host_id: "host-1",
          started_at: "2026-04-24T13:00:00Z"
        },
        {
          ...connectedSessions.items[0],
          id: "session-3",
          host_id: "host-1",
          started_at: "2026-04-24T14:00:00Z"
        }
      ]
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const tabList = await screen.findByRole("tablist", { name: "Terminal tabs" });
    await waitFor(() => expect(within(tabList).getByText("Prod SSH (2)")).toBeInTheDocument());

    const middleTab = within(tabList).getByText("Prod SSH (1)").closest("[role='tab']") as HTMLElement;
    await user.click(within(middleTab).getByRole("button", { name: "Close Prod SSH (1)" }));

    await waitFor(() => expect(closeTerminalSessionMock).toHaveBeenCalledWith("session-2"));
    expect(within(tabList).queryByText("Prod SSH (1)")).not.toBeInTheDocument();
    expect(within(tabList).getByText("Prod SSH (2)")).toBeInTheDocument();
  });

  it("does not consume a file manager host query while mounted under the files route", async () => {
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    renderWithPageProviders(<TerminalPage />, { route: "/files?host_id=host-1" });

    await waitFor(() => expect(listHostsMock).toHaveBeenCalled());
    expect(createTerminalSessionMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("terminal-pane-session")).not.toBeInTheDocument();
  });

  it("passes the requested working directory to the terminal websocket", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1&cwd=%2Fvar%2Fwww%2Fapp" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    const websocketUrl = screen.getByTestId("terminal-pane-websocket").textContent || "";
    expect(new URL(websocketUrl).searchParams.get("cwd")).toBe("/var/www/app");
  });

  it("passes default terminal path fallback candidates to the websocket", async () => {
    window.localStorage.setItem(
      "online-ssh-terminal-default-path",
      JSON.stringify({ mode: "custom", customPath: "/srv/app" })
    );
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    const websocketUrl = screen.getByTestId("terminal-pane-websocket").textContent || "";
    const params = new URL(websocketUrl).searchParams;
    expect(params.get("cwd")).toBe("/srv/app");
    expect(params.getAll("cwd_fallback")).toEqual(["/root", "/"]);
  });

  it("passes the terminal attach token to the websocket URL", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({
      kind: "success",
      data: {
        ...createResponse,
        websocket: {
          ...createResponse.websocket,
          token: "attach-token-1"
        }
      }
    });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    const websocketUrl = screen.getByTestId("terminal-pane-websocket").textContent || "";
    expect(new URL(websocketUrl).searchParams.get("attach_token")).toBe("attach-token-1");
  });

  it("shows recent hosts in the empty state and opens one directly", async () => {
    const favoriteWorker = {
      ...secondaryHost,
      is_favorite: true,
      last_connected_at: "2026-04-30T00:00:00Z"
    };
    listHostsMock.mockResolvedValue({
      items: [host, favoriteWorker],
      page: 1,
      page_size: 100,
      total: 2
    });
    createTerminalSessionMock.mockResolvedValue({
      kind: "success",
      data: {
        ...createResponse,
        session: {
          ...createResponse.session,
          host_id: "host-2"
        }
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    expect(screen.getByText("Favorite hosts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Worker SSH terminal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Worker SSH terminal" }));

    await waitFor(() =>
      expect(createTerminalSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          host_id: "host-2",
          rows: 36,
          cols: 120
        })
      )
    );
    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
  });

  it("maps terminal session creation failures to a friendly message", async () => {
    createTerminalSessionMock.mockRejectedValue(
      new HttpError(500, {
        code: "TERMINAL_FAILED",
        message: "terminal request failed"
      })
    );

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Prod SSH terminal" }));

    expect(
      await screen.findAllByText(
        "Terminal connection failed. Check the host address, port, credentials, and backend SSH logs."
      )
    ).not.toHaveLength(0);
    expect(screen.queryByText("terminal request failed")).not.toBeInTheDocument();
  });

  it("opens connection logs from a dialog when terminal creation fails", async () => {
    createTerminalSessionMock.mockRejectedValue(
      new HttpError(502, {
        code: "TERMINAL_SSH_CONNECT_FAILED",
        message: "connect ECONNREFUSED 203.0.113.227:221"
      })
    );

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Prod SSH terminal" }));

    expect(screen.queryByRole("region", { name: "Connection log" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Connection info for Prod SSH" }));

    const dialog = await screen.findByRole("dialog", { name: "Connection log" });
    expect(within(dialog).getByText(/Prod SSH/)).toBeInTheDocument();
    const log = within(dialog).getByRole("region", { name: "Connection log" });
    expect(within(log).getByText(/Starting a new connection to root@127\.0\.0\.1:22/)).toBeInTheDocument();
    expect(within(log).getByText("Credentials resolved from saved host data")).toBeInTheDocument();
    expect(within(log).getByText("Using password authentication")).toBeInTheDocument();
    expect(within(log).getByText("Starting SSH session")).toBeInTheDocument();
    expect(await within(log).findByText("Connection failed: connect ECONNREFUSED 203.0.113.227:221")).toBeInTheDocument();
  });

  it("shows backend connection log entries from terminal bootstrap failures", async () => {
    createTerminalSessionMock.mockRejectedValue(
      new HttpError(502, {
        code: "TERMINAL_BOOTSTRAP_CONNECT_FAILED",
        message: "TCP connection refused",
        connection_log: [
          {
            level: "info",
            message: "Connecting to 203.0.113.227 port 221",
            occurred_at: "2026-05-03T14:34:32Z"
          },
          {
            level: "error",
            message: "Connection error: connect ECONNREFUSED 203.0.113.227:221",
            occurred_at: "2026-05-03T14:34:32Z"
          }
        ]
      })
    );

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Prod SSH terminal" }));

    expect(screen.queryByRole("region", { name: "Connection log" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Connection info for Prod SSH" }));

    const dialog = await screen.findByRole("dialog", { name: "Connection log" });
    const log = within(dialog).getByRole("region", { name: "Connection log" });
    expect(await within(log).findByText("Connecting to 203.0.113.227 port 221")).toBeInTheDocument();
    expect(within(log).getByText("Connection error: connect ECONNREFUSED 203.0.113.227:221")).toBeInTheDocument();
  });

  it("appends websocket status updates to the connection log", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    await user.click(screen.getByRole("button", { name: "emit websocket log" }));

    expect(screen.queryByRole("region", { name: "Connection log" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connection info for Prod SSH" }));

    const dialog = await screen.findByRole("dialog", { name: "Connection log" });
    const log = within(dialog).getByRole("region", { name: "Connection log" });
    expect(within(log).getByText("Terminal session created, waiting for WebSocket ready event")).toBeInTheDocument();
    expect(within(log).getByText("WebSocket connected, waiting for remote PTY")).toBeInTheDocument();
  });

  it("shows up to sixteen launcher hosts in the terminal empty state", async () => {
    const launcherHosts = Array.from({ length: 17 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Recent ${index + 1}`,
      host: `10.0.0.${index + 1}`,
      updated_at: `2026-04-30T0${4 - index}:00:00Z`
    }));
    listHostsMock.mockResolvedValue({
      items: launcherHosts,
      page: 1,
      page_size: 100,
      total: launcherHosts.length
    });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Open Recent \d+ terminal$/ })).toHaveLength(16);
    expect(screen.getByText("Recent 1")).toBeInTheDocument();
    expect(screen.getByText("Recent 16")).toBeInTheDocument();
    expect(screen.queryByText("Recent 17")).not.toBeInTheDocument();
  });

  it("shows only favorite launcher hosts when favorites exist", async () => {
    listHostsMock.mockResolvedValue({
      items: [
        {
          ...host,
          id: "host-favorite-1",
          credential_id: "cred-favorite-1",
          name: "Favorite 1",
          is_favorite: true,
          updated_at: "2026-04-30T04:00:00Z"
        },
        {
          ...host,
          id: "host-favorite-2",
          credential_id: "cred-favorite-2",
          name: "Favorite 2",
          is_favorite: true,
          updated_at: "2026-04-30T03:00:00Z"
        },
        {
          ...host,
          id: "host-recent-1",
          credential_id: "cred-recent-1",
          name: "Recent nonfavorite",
          is_favorite: false,
          updated_at: "2026-04-30T05:00:00Z"
        }
      ],
      page: 1,
      page_size: 100,
      total: 3
    });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("Favorite hosts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Favorite 1 terminal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Favorite 2 terminal" })).toBeInTheDocument();
    expect(screen.queryByText("Recent nonfavorite")).not.toBeInTheDocument();
    expect(screen.queryByText("3 hosts")).not.toBeInTheDocument();
  });

  it("opens an existing host picker from the empty state new connection action", async () => {
    createTerminalSessionMock.mockResolvedValue({
      kind: "success",
      data: {
        ...createResponse,
        session: {
          ...createResponse.session,
          id: "session-picked",
          host_id: "host-1"
        }
      }
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    expect(screen.queryByText("The system creates a session and opens the WebSocket automatically.")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New connection" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Quick connect" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New connection" }));
    const picker = await screen.findByText("Available hosts");
    expect(picker).toBeInTheDocument();
    const pickerPanel = picker.closest(".files-host-picker") as HTMLElement;
    expect(within(pickerPanel).getByPlaceholderText("Filter hosts")).toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Prod SSH/ })).toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Worker SSH/ })).toBeInTheDocument();

    await user.type(within(pickerPanel).getByPlaceholderText("Filter hosts"), "prod");

    expect(within(pickerPanel).getByRole("button", { name: /Prod SSH/ })).toBeInTheDocument();
    expect(within(pickerPanel).queryByRole("button", { name: /Worker SSH/ })).not.toBeInTheDocument();
    await user.click(within(pickerPanel).getByRole("button", { name: /Prod SSH/ }));

    await waitFor(() =>
      expect(createTerminalSessionMock).toHaveBeenCalledWith(expect.objectContaining({
        host_id: "host-1",
        rows: 36,
        cols: 120
      }))
    );
    expect(quickConnectMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-picked");
  });

  it("opens quick connect from the topbar request and connects without saving host or credential resources", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage quickConnectRequestId={1} />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", { name: "Quick connect" });
    expect(within(dialog).queryByLabelText("Connection name")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Group")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Add to favorites")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save and connect" })).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Host address"), "203.0.113.40");
    await user.type(within(dialog).getByLabelText("Username"), "root");
    await user.type(within(dialog).getByLabelText("SSH password"), "secret-password");
    await user.click(within(dialog).getByRole("button", { name: "Connect to terminal" }));

    await waitFor(() =>
      expect(createQuickTerminalSessionMock).toHaveBeenCalledWith({
        host: "203.0.113.40",
        port: 22,
        username: "root",
        auth_type: "password",
        password: "secret-password",
        rows: 36,
        cols: 120
      })
    );
    expect(quickConnectMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("quick-session-1");
  });

  it("tests quick connect details without starting a terminal or clearing the form", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage quickConnectRequestId={1} />, { route: "/terminal" });

    const dialog = await screen.findByRole("dialog", { name: "Quick connect" });
    await user.type(within(dialog).getByLabelText("Host address"), "203.0.113.41");
    await user.type(within(dialog).getByLabelText("Username"), "deploy");
    await user.type(within(dialog).getByLabelText("SSH password"), "test-password");
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(createTemporaryConnectionMock).toHaveBeenCalledWith({
        host: "203.0.113.41",
        port: 22,
        username: "deploy",
        auth_type: "password",
        password: "test-password"
      })
    );
    expect(testHostMock).toHaveBeenCalledWith("tmp-file-1", {});
    expect(createQuickTerminalSessionMock).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Host address")).toHaveValue("203.0.113.41");
    expect(within(dialog).getByLabelText("Username")).toHaveValue("deploy");
  });

  it("can create a temporary file manager connection from quick connect", async () => {
    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage quickConnectRequestId={1} />, { route: "/terminal" });

    expect(await screen.findByText("No terminals are open.")).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", { name: "Quick connect" });
    await user.type(within(dialog).getByLabelText("Host address"), "203.0.113.40");
    await user.type(within(dialog).getByLabelText("Username"), "root");
    await user.type(within(dialog).getByLabelText("SSH password"), "secret-password");
    await user.click(within(dialog).getByRole("button", { name: "Connect to file manager" }));

    await waitFor(() =>
      expect(createTemporaryConnectionMock).toHaveBeenCalledWith({
        host: "203.0.113.40",
        port: 22,
        username: "root",
        auth_type: "password",
        password: "secret-password"
      })
    );
    expect(quickConnectMock).not.toHaveBeenCalled();
  });

  it("opens saved commands dialog, copies, and creates a command", async () => {
    const createdCommand: SavedCommand = {
      ...savedCommand,
      id: "command-2",
      name: "Show processes",
      command_text: "ps aux",
      category: "System",
      description: "Process list",
      sort_order: 1,
      updated_at: "2026-04-26T11:00:00Z"
    };
    listSavedCommandsMock
      .mockResolvedValueOnce({ items: [savedCommand] })
      .mockResolvedValue({ items: [savedCommand, createdCommand] });
    createSavedCommandMock.mockResolvedValue({ command: createdCommand });
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn() }
      });
    }
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
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

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const openBtn = await screen.findByRole("button", { name: /saved commands|常用命令/i });
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

    await user.click(openBtn);
    expect(screen.getByRole("dialog", { name: "Saved commands" })).toBeInTheDocument();

    expect(await screen.findByText("Check disk")).toBeInTheDocument();
    expect(screen.getAllByText("Filesystem").length).toBeGreaterThan(0);
    expect(screen.getByText("df -h")).toBeInTheDocument();

    const sendBtn = screen.getByTitle("Open a connected terminal first");
    expect(sendBtn).toBeDisabled();

    const copyBtn = screen.getByTitle("Copy");
    await user.click(copyBtn);
    await waitFor(() => expect(setClipboardData).toHaveBeenCalledWith("text/plain", "df -h"));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).not.toHaveBeenCalled();
    expect(copyBtn.className).toContain("copied");

    await user.click(screen.getByRole("button", { name: "Add command" }));
    const createDialog = screen.getByRole("dialog", { name: "Add command" });
    expect(within(createDialog).queryByText("Check disk")).not.toBeInTheDocument();
    await user.type(within(createDialog).getByLabelText("Name"), "Show processes");
    await user.type(within(createDialog).getByLabelText("Category"), "System");
    await user.type(within(createDialog).getByLabelText("Command"), "ps aux");
    await user.type(within(createDialog).getByLabelText("Description"), "Process list");
    await user.click(within(createDialog).getByRole("button", { name: "Create command" }));

    await waitFor(() =>
      expect(createSavedCommandMock).toHaveBeenCalledWith({
        name: "Show processes",
        command_text: "ps aux",
        category: "System",
        description: "Process list",
        sort_order: 1
      })
    );
    expect(await screen.findByRole("dialog", { name: "Saved commands" })).toBeInTheDocument();
    expect(await screen.findByText("Show processes")).toBeInTheDocument();
  });

  it("interpolates saved command send messages before writing to the active terminal", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    listSavedCommandsMock.mockResolvedValue({ items: [savedCommand] });
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    await user.click(await screen.findByRole("button", { name: /saved commands|常用命令/i }));
    const dialog = await screen.findByRole("dialog", { name: "Saved commands" });
    await user.click(within(dialog).getByRole("button", { name: "Send to active terminal" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "Send command to terminal?" });
    expect(within(confirmDialog).getByText(/Prod SSH/)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/df -h/)).toBeInTheDocument();
    expect(within(confirmDialog).queryByText(/\{host\}|\{command\}/)).not.toBeInTheDocument();

    await user.click(within(confirmDialog).getByRole("button", { name: "Send to terminal" }));

    expect(terminalPaneMocks.sentInputs).toEqual([{ sessionId: "session-1", text: "df -h" }]);
    expect(await screen.findByText(/Command written to the .*Prod SSH.* terminal/i)).toBeInTheDocument();
    expect(screen.queryByText(/\{host\}|\{command\}/)).not.toBeInTheDocument();
  });

  it("generates an AI command, lets the result be edited, imports it, and writes it without Enter", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    listSavedCommandsMock.mockResolvedValue({ items: [savedCommand] });
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });
    const importedCommand: SavedCommand = {
      ...savedCommand,
      id: "command-ai",
      name: "List recent logs",
      command_text: "find /var/log -type f -name '*.log' -mtime -2",
      category: "Logs",
      description: "Find log files changed in the last two days",
      sort_order: 1,
      updated_at: "2026-05-10T10:00:00Z"
    };
    createSavedCommandMock.mockResolvedValue({ command: importedCommand });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    const assistantButton = await screen.findByRole("button", { name: "AI command assistant" });
    const headerActions = assistantButton.closest(".header-actions") as HTMLElement | null;
    expect(headerActions).not.toBeNull();
    const savedCommandsButton = within(headerActions as HTMLElement).getByRole("button", { name: /Saved commands/ });
    const headerButtons = within(headerActions as HTMLElement).getAllByRole("button");
    expect(headerButtons.indexOf(assistantButton)).toBeLessThan(headerButtons.indexOf(savedCommandsButton));
    const tabList = screen.getByRole("tablist", { name: "Terminal tabs" });
    expect(tabList).not.toContainElement(assistantButton);

    await user.click(assistantButton);
    const dialog = await screen.findByRole("dialog", { name: "AI command assistant" });
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "find logs modified recently");
    await user.click(within(dialog).getByRole("button", { name: "Generate command" }));

    await waitFor(() =>
      expect(generateTerminalCommandMock).toHaveBeenCalledWith({
        prompt: "find logs modified recently",
        host_label: "Prod SSH"
      })
    );
    expect(await within(dialog).findByDisplayValue("find /var/log -type f -name '*.log' -mtime -1")).toBeInTheDocument();
    expect(within(dialog).getByText("Medium risk")).toBeInTheDocument();
    expect(within(dialog).getByText("Review the path before running.")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "List recent logs");
    await user.clear(within(dialog).getByLabelText("Category"));
    await user.type(within(dialog).getByLabelText("Category"), "Logs");
    await user.clear(within(dialog).getByLabelText("Command"));
    await user.type(within(dialog).getByLabelText("Command"), "find /var/log -type f -name '*.log' -mtime -2");
    await user.clear(within(dialog).getByLabelText("Description"));
    await user.type(within(dialog).getByLabelText("Description"), "Find log files changed in the last two days");

    await user.click(within(dialog).getByRole("button", { name: "Import to saved commands" }));
    await waitFor(() =>
      expect(createSavedCommandMock).toHaveBeenCalledWith({
        name: "List recent logs",
        command_text: "find /var/log -type f -name '*.log' -mtime -2",
        category: "Logs",
        description: "Find log files changed in the last two days",
        sort_order: 1
      })
    );
    expect(await within(dialog).findByText("Saved command imported.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Write to terminal" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Send command to terminal?" });
    expect(within(confirmDialog).getByText(/find \/var\/log/)).toBeInTheDocument();
    await user.click(within(confirmDialog).getByRole("button", { name: "Send to terminal" }));

    expect(terminalPaneMocks.sentInputs).toEqual([
      { sessionId: "session-1", text: "find /var/log -type f -name '*.log' -mtime -2" }
    ]);
    expect(terminalPaneMocks.sentInputs[0].text).not.toMatch(/[\r\n]$/);
  });

  it("can include active host system information when generating an AI command", async () => {
    listTerminalSessionsMock.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the restore effect pending so it does not overwrite the tab opened from the query entrypoint.
        })
    );
    createTerminalSessionMock.mockResolvedValue({ kind: "success", data: createResponse });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal?host_id=host-1" });

    expect(await screen.findByTestId("terminal-pane-session")).toHaveTextContent("session-1");
    await user.click(await screen.findByRole("button", { name: "AI command assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "AI command assistant" });
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "show package updates");
    await user.click(within(dialog).getByRole("button", { name: "Generate command" }));

    await waitFor(() =>
      expect(generateTerminalCommandMock).toHaveBeenCalledWith({
        prompt: "show package updates",
        host_label: "Prod SSH"
      })
    );
    expect(getHostMetricsMock).not.toHaveBeenCalled();

    generateTerminalCommandMock.mockClear();
    await user.click(within(dialog).getByRole("checkbox", { name: "Send system info" }));
    await user.click(within(dialog).getByRole("button", { name: "Generate command" }));

    await waitFor(() => expect(getHostMetricsMock).toHaveBeenCalledWith("host-1"));
    await waitFor(() =>
      expect(generateTerminalCommandMock).toHaveBeenLastCalledWith({
        prompt: "show package updates",
        host_label: "Prod SSH",
        system_info: "Hostname: prod-node\nOS: Ubuntu 22.04.2 LTS\nKernel: 6.8.0-101-generic"
      })
    );
  });

  it("shows unsupported AI requests without command actions", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);
    generateTerminalCommandMock.mockResolvedValue({
      unsupported_request: true,
      refusal_message: "This request is not about generating a terminal command.",
      suggested_prompt: "Describe the operation you want to perform in a terminal."
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("button", { name: "AI command assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "AI command assistant" });
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "write a poem");
    await user.click(within(dialog).getByRole("button", { name: "Generate command" }));

    expect(await within(dialog).findByText("Unable to generate a terminal command")).toBeInTheDocument();
    expect(within(dialog).getByText("This request is not about generating a terminal command.")).toBeInTheDocument();
    expect(within(dialog).getByText("Describe the operation you want to perform in a terminal.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Command")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Import to saved commands" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Write to terminal" })).not.toBeInTheDocument();
  });

  it("keeps the AI command assistant in the header when no terminal tabs are open", async () => {
    listTerminalSessionsMock.mockResolvedValue(emptySessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const assistantButton = await screen.findByRole("button", { name: "AI command assistant" });
    const headerActions = assistantButton.closest(".header-actions") as HTMLElement | null;
    expect(headerActions).not.toBeNull();
    const savedCommandsButton = within(headerActions as HTMLElement).getByRole("button", { name: /Saved commands/ });
    const headerButtons = within(headerActions as HTMLElement).getAllByRole("button");
    expect(headerButtons.indexOf(assistantButton)).toBeLessThan(headerButtons.indexOf(savedCommandsButton));
    expect(screen.queryByRole("tablist", { name: "Terminal tabs" })).not.toBeInTheDocument();

    await user.click(assistantButton);
    expect(await screen.findByRole("dialog", { name: "AI command assistant" })).toBeInTheDocument();
  });

  it("shows AI command generation errors via toast only", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);
    generateTerminalCommandMock.mockRejectedValue(new HttpError(503, {
      code: "LLM_NOT_CONFIGURED",
      message: "LLM command generation is not configured"
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("button", { name: "AI command assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "AI command assistant" });
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "show disk usage");
    await user.click(within(dialog).getByRole("button", { name: "Generate command" }));

    expect(await screen.findByText("LLM command generation is not configured", { selector: ".toast-content p" })).toBeInTheDocument();
    expect(within(dialog).queryByText("LLM command generation is not configured")).not.toBeInTheDocument();
  });

  it("shows raw AI output when the backend cannot parse a structured command", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);
    generateTerminalCommandMock.mockResolvedValue({
      raw_response: "You can inspect memory with: ps aux --sort=-%mem | head -20",
      invalid_response: true
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("button", { name: "AI command assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "AI command assistant" });
    await user.type(within(dialog).getByLabelText("What do you want to do?"), "show high memory processes");
    await user.click(within(dialog).getByRole("button", { name: "Generate command" }));

    expect(await within(dialog).findByText("Model raw output")).toBeInTheDocument();
    expect(within(dialog).getByText(/ps aux --sort=-%mem/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Command")).not.toBeInTheDocument();
    expect(screen.queryByText("The model response could not be parsed.", { selector: ".toast-content p" })).not.toBeInTheDocument();
  });

  it("sends saved commands to every pane in the active workspace when broadcast is enabled", async () => {
    const openHosts = Array.from({ length: 4 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 4)
    });
    listSavedCommandsMock.mockResolvedValue({ items: [savedCommand] });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", tabId: "session-1" },
            { type: "leaf", tabId: "session-2" }
          ]
        },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", tabId: "session-3" },
            { type: "leaf", tabId: "session-4" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const firstWorkspaceTab = await screen.findByRole("tab", { name: /^Workspace$/i });
    await user.click(within(firstWorkspaceTab).getByRole("button", { name: /Enable broadcast session/i }));
    await user.click(await screen.findByRole("button", { name: /emit terminal connected session-1/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /emit terminal input session-1/i })).toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: /saved commands|常用命令/i }));
    const dialog = await screen.findByRole("dialog", { name: "Saved commands" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Send to active terminal" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "Send to active terminal" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Send command to terminal?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Send to terminal" }));

    expect(terminalPaneMocks.sentInputs).toEqual([
      { sessionId: "session-1", text: "df -h" },
      { sessionId: "session-2", text: "df -h" }
    ]);
  });

  it("switches saved commands dialog into edit mode and returns to the list after saving", async () => {
    const updatedCommand: SavedCommand = {
      ...savedCommand,
      name: "Check disk usage",
      updated_at: "2026-04-26T11:30:00Z"
    };
    listSavedCommandsMock
      .mockResolvedValueOnce({ items: [savedCommand] })
      .mockResolvedValue({ items: [updatedCommand] });
    updateSavedCommandMock.mockResolvedValue({ command: updatedCommand });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("button", { name: /saved commands|常用命令/i }));
    expect(await screen.findByText("Check disk")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit command" });
    const nameInput = within(editDialog).getByLabelText("Name");
    expect(nameInput).toHaveValue("Check disk");

    await user.clear(nameInput);
    await user.type(nameInput, "Check disk usage");
    await user.click(within(editDialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSavedCommandMock).toHaveBeenCalledWith("command-1", {
        name: "Check disk usage",
        command_text: "df -h",
        category: "Filesystem",
        description: "Disk usage",
        sort_order: 0
      })
    );
    expect(await screen.findByRole("dialog", { name: "Saved commands" })).toBeInTheDocument();
    expect(await screen.findByText("Check disk usage")).toBeInTheDocument();
  });

  it("opens terminal history, updates settings, replays chunks, and deletes a recording", async () => {
    window.localStorage.setItem("online-ssh-language", "en-US");
    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("button", { name: "Terminal history" }));
    const dialog = await screen.findByRole("dialog", { name: "Terminal history" });

    await waitFor(() => expect(getTerminalRecordingSettingsMock).toHaveBeenCalled());
    expect(await within(dialog).findByRole("columnheader", { name: "Start time" })).toBeInTheDocument();
    expect(within(dialog).getByRole("columnheader", { name: "End time" })).toBeInTheDocument();
    expect(within(dialog).getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    const captureSetting = within(dialog).getByLabelText("Recording");
    expect(within(captureSetting).getByText("Recording")).toBeInTheDocument();
    expect(within(captureSetting).getByLabelText("Save input and output for new terminal sessions")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveClass("terminal-history-save-button");
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveClass("ui-button-sm");
    expect(within(dialog).getAllByText(/2026/).length).toBeGreaterThanOrEqual(2);
    expect(historyTerminalMocks.terminals).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Add bookmark" }));
    await waitFor(() => expect(updateTerminalRecordingBookmarkMock).toHaveBeenCalledWith("recording-1", true));
    await waitFor(() => expect(listTerminalRecordingsMock).toHaveBeenCalledTimes(2));

    await user.click(within(dialog).getByRole("button", { name: "Show details" }));
    await waitFor(() => expect(historyTerminalMocks.terminals).toHaveLength(1));
    await waitFor(() => expect(historyTerminalMocks.terminals[0].write).toHaveBeenCalled());
    const replayedData = historyTerminalMocks.terminals[0].write.mock.calls.map((call) => call[0]).join("");
    expect(replayedData).toContain("whoami");
    expect(replayedData).toContain("root");
    expect(replayedData).toContain("clear\r\n");
    expect(replayedData).not.toContain("\u001b[H");
    expect(replayedData).not.toContain("\u001b[2J");
    expect(replayedData).not.toContain("\u001b[3J");
    expect(replayedData).not.toContain("[Output");
    expect(replayedData).not.toContain("[Input");
    expect(replayedData.startsWith("whoami\n")).toBe(false);
    expect(within(dialog).queryByText(/\\u001b|\\x1b|\\033|输出|输入/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByLabelText("Save input and output for new terminal sessions"));
    await selectInputOption(user, within(dialog).getByLabelText("Retention"), "3");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTerminalRecordingSettingsMock).toHaveBeenCalledWith({
        enabled: true,
        retention_days: 3
      })
    );

    expect(within(dialog).getByRole("button", { name: "Back to list" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete history" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Delete terminal history" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete history" }));
    await waitFor(() => expect(deleteTerminalRecordingMock).toHaveBeenCalledWith("recording-1"));
    await waitFor(() => expect(listTerminalRecordingsMock).toHaveBeenCalledTimes(3));
  });

  it("paginates terminal history and downloads the expanded recording", async () => {
    window.localStorage.setItem("online-ssh-language", "en-US");
    const secondRecording: TerminalRecording = {
      ...terminalRecording,
      id: "recording-2",
      started_at: "2026-04-30T13:00:00Z",
      ended_at: "2026-04-30T13:03:00Z",
      input_bytes: 12,
      output_bytes: 24
    };
    listTerminalRecordingsMock.mockImplementation(async (params = {}) => ({
      items: params.page === 2 ? [secondRecording] : [terminalRecording],
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      total: 40
    }));
    listTerminalRecordingChunksMock.mockResolvedValue({
      items: [
        {
          sequence: 1,
          direction: "input",
          occurred_at: "2026-04-30T13:00:01Z",
          data: "uptime\n",
          byte_count: 7
        },
        {
          sequence: 2,
          direction: "output",
          occurred_at: "2026-04-30T13:00:02Z",
          data: "13:00 up 7 days\r\n",
          byte_count: 18
        }
      ],
      next_cursor: 2,
      has_more: false
    });

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("button", { name: "Terminal history" }));
    const dialog = await screen.findByRole("dialog", { name: "Terminal history" });

    await waitFor(() => expect(listTerminalRecordingsMock).toHaveBeenCalledWith({ page: 1, page_size: 20 }));
    expect(await within(dialog).findByText("Page 1 / 2, 40 items total.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listTerminalRecordingsMock).toHaveBeenLastCalledWith({ page: 2, page_size: 20 }));
    expect(await within(dialog).findByText("Page 2 / 2, 40 items total.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Show details" }));
    await waitFor(() => expect(listTerminalRecordingChunksMock).toHaveBeenCalledWith("recording-2", { cursor: 0, limit: 200 }));
    const toolbar = dialog.querySelector(".terminal-history-replay-toolbar");
    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Back to list",
      "Download history",
      "Add bookmark",
      "Delete history"
    ]);

    await user.click(within(dialog).getByRole("button", { name: "Download history" }));
    await waitFor(() => expect(saveBlobAsFileMock).toHaveBeenCalledTimes(1));
    const [blob, fileName] = saveBlobAsFileMock.mock.calls[0];
    await expect(blob.text()).resolves.toContain("[2026-04-30T13:00:01Z] input");
    await expect(blob.text()).resolves.toContain("13:00 up 7 days");
    expect(fileName).toMatch(/^terminal-history-20260430-130000-recording-2\.log$/);
  });

  it("splits terminal panes with pane headers and cancels by dragging a pane header back to tabs", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getAllByText("Worker SSH")[0].closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });

    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));
    expect(screen.getByRole("tab", { name: /Workspace/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2);
    expect(screen.getByText("Prod SSH")).toBeInTheDocument();
    expect(screen.getByText("Worker SSH")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize terminal panes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connection info for Prod SSH" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Worker SSH pane" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Worker SSH browser fullscreen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maximize Worker SSH pane" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connection info" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("terminal-split-pane-handle")).not.toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane-min-cols-session-1")).toHaveAttribute("data-minimum-remote-resize-cols", "default");
    expect(screen.getByTestId("terminal-pane-min-cols-session-2")).toHaveAttribute("data-minimum-remote-resize-cols", "default");

    const splitHandles = screen.getAllByTestId("terminal-pane-drag-handle");
    const returnTransfer = createDataTransfer();
    fireEvent.dragStart(splitHandles[1], { dataTransfer: returnTransfer });
    const tabList = screen.getByRole("tablist", { name: "Terminal tabs" });
    fireEvent.dragOver(tabList, { dataTransfer: returnTransfer });
    fireEvent.drop(tabList, { dataTransfer: returnTransfer });

    await waitFor(() => expect(paneStack).not.toHaveClass("terminal-pane-stack-split"));
    expect(closeTerminalSessionMock).not.toHaveBeenCalled();
  });

  it("previews a right split from the middle-right triangular drop region", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getAllByText("Worker SSH")[0].closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 780, clientY: 300, dataTransfer });

    const preview = document.querySelector(".terminal-drop-preview");
    expect(preview).toBeTruthy();
    expect(preview).toHaveClass("terminal-drop-preview-right");
  });

  it("keeps the terminal drop preview above focused pane shells", () => {
    expect(stylesCss).toContain(".terminal-drop-preview {");
    expect(stylesCss).toContain("z-index: 30;");
  });

  it("keeps terminal splitters above hovered pane shells for reliable hit testing", () => {
    expect(stylesCss).toMatch(
      /\.terminal-pane-splitter\s*\{[^}]*z-index:\s*20;/
    );
  });

  it("keeps the pane share indicator stable and compact on hover", () => {
    expect(stylesCss).toMatch(
      /\.terminal-pane-share-indicator:hover,[\s\S]*?\.terminal-pane-share-indicator:focus-visible\s*\{[^}]*transform:\s*none;/
    );
    expect(stylesCss).toMatch(
      /\.terminal-pane-share-indicator\s*\{[^}]*border-color:\s*transparent;/
    );
    expect(stylesCss).toMatch(
      /\.terminal-pane-share-indicator-countdown\s*\{[^}]*height:\s*24px;[\s\S]*?width:\s*auto;[\s\S]*?max-width:\s*54px;/
    );
  });

  it("moves pane header primary actions into the more menu on narrow panes", () => {
    expect(stylesCss).toContain(".terminal-pane-header.terminal-pane-header-compact .terminal-pane-header-primary-action");
    expect(stylesCss).toContain(".terminal-pane-header-primary-action");
    expect(stylesCss).toContain(".terminal-pane-menu-compact-action");
    expect(stylesCss).not.toContain("@container terminal-pane-header (max-width: 260px)");
  });

  it("keeps compact pane actions visible in the portal-rendered more menu", () => {
    expect(stylesCss).toMatch(
      /\.terminal-pane-actions-menu-compact\s+\.terminal-pane-menu-compact-action\s*\{[^}]*display:\s*block;/
    );
  });

  it("uses visible hover feedback for terminal header and menu actions", () => {
    expect(stylesCss).toMatch(
      /\.terminal-pane-header-actions \.ui-inline-icon-button:hover,[\s\S]*background:\s*var\(--ui-surface-hover\);/
    );
    expect(stylesCss).toMatch(
      /\.terminal-pane-actions-menu button:hover,[\s\S]*background:\s*var\(--ui-surface-hover\);/
    );
    expect(stylesCss).toMatch(
      /\.terminal-pane-actions-menu \.terminal-pane-menu-compact-danger:hover,[\s\S]*background:\s*var\(--ui-danger-bg-strong\);/
    );
  });

  it("keeps terminal frame padding symmetric with the selected terminal background", () => {
    expect(stylesCss).toMatch(
      /\.terminal-surface-frame\s*\{[^}]*background:\s*var\(--terminal-surface-background,\s*var\(--xterm-background\)\);[^}]*padding:\s*0\.5rem;/
    );
  });

  it("shows compact pane actions inside the more menu after the header becomes narrow", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getAllByText("Worker SSH")[0].closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    const prodHeader = screen.getAllByTestId("terminal-pane-header")[0];
    emitResize(prodHeader, 220);

    await user.click(screen.getByRole("button", { name: "More actions for Prod SSH" }));

    expect(await screen.findByRole("button", { name: "Connection info for Prod SSH" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Prod SSH browser fullscreen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Prod SSH pane" })).toBeInTheDocument();
  });

  it("only resizes the adjacent panes when dragging a parent splitter", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.4166666666666667,
          children: [
            { type: "leaf", tabId: "session-1" },
            {
              type: "split",
              direction: "vertical",
              ratio: 0.6285714285714286,
              children: [
                { type: "leaf", tabId: "session-2" },
                { type: "leaf", tabId: "session-3" }
              ]
            }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    const [rootSplitter] = screen.getAllByRole("separator", { name: "Resize terminal panes" });
    const getPaneWidth = (label: string) => {
      const shell = screen.getByText(label).closest(".terminal-pane-shell");
      if (!(shell instanceof HTMLElement)) {
        throw new Error(`Missing terminal pane shell for ${label}`);
      }
      return parseFloat(shell.style.getPropertyValue("--terminal-pane-width") || "0");
    };
    const initialPane1Width = getPaneWidth("Node 1");
    const initialPane2Width = getPaneWidth("Node 2");
    const initialPane3Width = getPaneWidth("Node 3");

    fireEvent.mouseDown(rootSplitter, { clientX: 600, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 900, clientY: 300 });

    expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.57" });
    expect(getPaneWidth("Node 1")).toBeGreaterThan(initialPane1Width);
    expect(getPaneWidth("Node 2")).toBeLessThan(initialPane2Width);
    expect(Math.abs(getPaneWidth("Node 3") - initialPane3Width)).toBeLessThan(0.5);
    expect(getPaneWidth("Node 2")).toBeCloseTo(getPaneWidth("Node 3"), 5);

    fireEvent.mouseUp(window, { clientX: 900, clientY: 300 });

    await waitFor(() => expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.57" }));
  });

  it("keeps the leading pane fixed when dragging a left-nested parent splitter", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5833333333333334,
          children: [
            {
              type: "split",
              direction: "vertical",
              ratio: 0.37142857142857144,
              children: [
                { type: "leaf", tabId: "session-1" },
                { type: "leaf", tabId: "session-2" }
              ]
            },
            { type: "leaf", tabId: "session-3" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    const [rootSplitter] = screen.getAllByRole("separator", { name: "Resize terminal panes" });
    const getPaneWidth = (label: string) => {
      const shell = screen.getByText(label).closest(".terminal-pane-shell");
      if (!(shell instanceof HTMLElement)) {
        throw new Error(`Missing terminal pane shell for ${label}`);
      }
      return parseFloat(shell.style.getPropertyValue("--terminal-pane-width") || "0");
    };
    const initialPane1Width = getPaneWidth("Node 1");
    const initialPane2Width = getPaneWidth("Node 2");
    const initialPane3Width = getPaneWidth("Node 3");

    fireEvent.mouseDown(rootSplitter, { clientX: 700, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 900, clientY: 300 });

    expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.75" });
    expect(Math.abs(getPaneWidth("Node 1") - initialPane1Width)).toBeLessThan(0.5);
    expect(getPaneWidth("Node 2")).toBeGreaterThan(initialPane2Width);
    expect(getPaneWidth("Node 3")).toBeLessThan(initialPane3Width);
  });

  it("keeps outer panes fixed when dragging between balanced columns", async () => {
    const openHosts = Array.from({ length: 4 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 4)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                { type: "leaf", tabId: "session-1" },
                { type: "leaf", tabId: "session-2" }
              ]
            },
            {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                { type: "leaf", tabId: "session-3" },
                { type: "leaf", tabId: "session-4" }
              ]
            }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(4));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    const [rootSplitter] = screen.getAllByRole("separator", { name: "Resize terminal panes" });
    const getPaneWidth = (label: string) => {
      const shell = screen.getByText(label).closest(".terminal-pane-shell");
      if (!(shell instanceof HTMLElement)) {
        throw new Error(`Missing terminal pane shell for ${label}`);
      }
      return parseFloat(shell.style.getPropertyValue("--terminal-pane-width") || "0");
    };
    const initialPane1Width = getPaneWidth("Node 1");
    const initialPane2Width = getPaneWidth("Node 2");
    const initialPane3Width = getPaneWidth("Node 3");
    const initialPane4Width = getPaneWidth("Node 4");

    fireEvent.mouseDown(rootSplitter, { clientX: 600, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 640, clientY: 300 });

    expect(Math.abs(getPaneWidth("Node 1") - initialPane1Width)).toBeLessThan(0.5);
    expect(getPaneWidth("Node 2")).toBeGreaterThan(initialPane2Width);
    expect(getPaneWidth("Node 3")).toBeLessThan(initialPane3Width);
    expect(Math.abs(getPaneWidth("Node 4") - initialPane4Width)).toBeLessThan(0.5);
  });

  it("only resizes the adjacent panes when dragging a parent horizontal splitter", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.4166666666666667,
          children: [
            { type: "leaf", tabId: "session-1" },
            {
              type: "split",
              direction: "horizontal",
              ratio: 0.6285714285714286,
              children: [
                { type: "leaf", tabId: "session-2" },
                { type: "leaf", tabId: "session-3" }
              ]
            }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    const [rootSplitter] = screen.getAllByRole("separator", { name: "Resize terminal panes" });
    const getPaneHeight = (label: string) => {
      const shell = screen.getByText(label).closest(".terminal-pane-shell");
      if (!(shell instanceof HTMLElement)) {
        throw new Error(`Missing terminal pane shell for ${label}`);
      }
      return parseFloat(shell.style.getPropertyValue("--terminal-pane-height") || "0");
    };
    const initialPane1Height = getPaneHeight("Node 1");
    const initialPane2Height = getPaneHeight("Node 2");
    const initialPane3Height = getPaneHeight("Node 3");

    fireEvent.mouseDown(rootSplitter, { clientX: 600, clientY: 250 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 450 });

    expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.58" });
    expect(getPaneHeight("Node 1")).toBeGreaterThan(initialPane1Height);
    expect(getPaneHeight("Node 2")).toBeLessThan(initialPane2Height);
    expect(Math.abs(getPaneHeight("Node 3") - initialPane3Height)).toBeLessThan(0.5);

    fireEvent.mouseUp(window, { clientX: 600, clientY: 450 });

    await waitFor(() => expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.58" }));
  });

  it("keeps the first mixed column fixed when dragging the second vertical splitter", async () => {
    const openHosts = Array.from({ length: 5 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 5)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.7,
          children: [
            {
              type: "split",
              direction: "vertical",
              ratio: 0.52,
              children: [
                {
                  type: "split",
                  direction: "horizontal",
                  ratio: 0.34,
                  children: [
                    { type: "leaf", tabId: "session-1" },
                    {
                      type: "split",
                      direction: "horizontal",
                      ratio: 0.5,
                      children: [
                        { type: "leaf", tabId: "session-2" },
                        { type: "leaf", tabId: "session-3" }
                      ]
                    }
                  ]
                },
                { type: "leaf", tabId: "session-4" }
              ]
            },
            { type: "leaf", tabId: "session-5" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(5));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    const [secondVerticalSplitter] = screen.getAllByRole("separator", { name: "Resize terminal panes" });
    const getPaneMetric = (label: string, property: "--terminal-pane-left" | "--terminal-pane-width") => {
      const shell = screen.getByText(label).closest(".terminal-pane-shell");
      if (!(shell instanceof HTMLElement)) {
        throw new Error(`Missing terminal pane shell for ${label}`);
      }
      return parseFloat(shell.style.getPropertyValue(property) || "0");
    };
    const initialFirstColumnWidth = getPaneMetric("Node 1", "--terminal-pane-width");
    const initialSecondColumnLeft = getPaneMetric("Node 4", "--terminal-pane-left");
    const initialSecondColumnWidth = getPaneMetric("Node 4", "--terminal-pane-width");
    const initialThirdColumnWidth = getPaneMetric("Node 5", "--terminal-pane-width");

    fireEvent.mouseDown(secondVerticalSplitter, { clientX: 840, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 900, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 940, clientY: 300 });

    expect(Math.abs(getPaneMetric("Node 1", "--terminal-pane-width") - initialFirstColumnWidth)).toBeLessThan(0.5);
    expect(Math.abs(getPaneMetric("Node 4", "--terminal-pane-left") - initialSecondColumnLeft)).toBeLessThan(0.5);
    expect(getPaneMetric("Node 4", "--terminal-pane-width")).toBeGreaterThan(initialSecondColumnWidth);
    expect(getPaneMetric("Node 5", "--terminal-pane-width")).toBeLessThan(initialThirdColumnWidth);
  });

  it("allows a local split inside a mixed workspace with independent row boundaries", async () => {
    const openHosts = Array.from({ length: 7 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 7)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.55,
          children: [
            {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                {
                  type: "split",
                  direction: "horizontal",
                  ratio: 0.4,
                  children: [
                    { type: "leaf", tabId: "session-1" },
                    { type: "leaf", tabId: "session-2" }
                  ]
                },
                { type: "leaf", tabId: "session-3" }
              ]
            },
            {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                {
                  type: "split",
                  direction: "horizontal",
                  ratio: 0.7,
                  children: [
                    { type: "leaf", tabId: "session-4" },
                    { type: "leaf", tabId: "session-5" }
                  ]
                },
                { type: "leaf", tabId: "session-6" }
              ]
            }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(6));
    const node7Tab = screen.getByRole("tab", { name: /Node 7/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(node7Tab, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 495, clientY: 500, dataTransfer });

    await waitFor(() => expect(document.querySelector(".terminal-drop-preview")).toBeTruthy());
    expect(document.querySelector(".terminal-drop-preview")).toHaveClass("terminal-drop-preview-bottom");

    fireTerminalDrop(paneStack, { clientX: 495, clientY: 500, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(7));
    expect(screen.getByText("Node 7")).toBeInTheDocument();
  });

  it("does not keep a stale maximized split frame around a single active terminal", async () => {
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: { type: "leaf", tabId: "session-1" },
      maximizedTabId: "session-1"
    }));
    listTerminalSessionsMock.mockResolvedValue({
      items: [connectedSessions.items[0]]
    });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    expect(paneStack).not.toHaveClass("terminal-pane-stack-maximized");
    expect(screen.getByTestId("terminal-pane-header")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close Prod SSH pane" })).not.toBeInTheDocument();
  });

  it("does not show or apply a center drop target before a workspace exists", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getAllByText("Worker SSH")[0].closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 600, clientY: 300, dataTransfer });
    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-center");
    expect(document.querySelector(".terminal-drop-preview")).not.toBeInTheDocument();
    fireTerminalDrop(paneStack, { clientX: 600, clientY: 300, dataTransfer });

    expect(paneStack).not.toHaveClass("terminal-pane-stack-split");
    expect(screen.queryByRole("tab", { name: /Workspace/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("does not show or apply a center drop target inside an active split workspace", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    const splitHandles = screen.getAllByTestId("terminal-pane-drag-handle");
    const centerTransfer = createDataTransfer();
    fireEvent.dragStart(splitHandles[1], { dataTransfer: centerTransfer });
    fireTerminalDragOver(paneStack, { clientX: 600, clientY: 300, dataTransfer: centerTransfer });
    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-center");
    expect(document.querySelector(".terminal-drop-preview")).not.toBeInTheDocument();
    fireTerminalDrop(paneStack, { clientX: 600, clientY: 300, dataTransfer: centerTransfer });

    expect(paneStack).toHaveClass("terminal-pane-stack-split");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /Workspace/i })).toHaveClass("terminal-tab-active");
  });

  it("shows the tab list as a drop target when dragging a split pane header back to tabs", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1000, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1000, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1000, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    const tabList = screen.getByRole("tablist", { name: "Terminal tabs" });
    const returnTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getAllByTestId("terminal-pane-drag-handle")[1], { dataTransfer: returnTransfer });
    fireEvent.dragOver(tabList, { dataTransfer: returnTransfer });

    expect(tabList).toHaveClass("terminal-tab-list-drop-active");
  });

  it("exits split from the pane more menu without closing the terminal session", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    await user.click(screen.getByRole("button", { name: "More actions for Worker SSH" }));
    await user.click(await screen.findByRole("button", { name: "Exit split" }));

    await waitFor(() => expect(paneStack).not.toHaveClass("terminal-pane-stack-split"));
    expect(closeTerminalSessionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Prod SSH/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Worker SSH/i })).toBeInTheDocument();
  });

  it("closes a split pane view without closing the underlying terminal session", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    await user.click(screen.getByRole("button", { name: "Close Worker SSH pane" }));

    await waitFor(() => expect(closeTerminalSessionMock).toHaveBeenCalledWith("session-2"));
    await waitFor(() => expect(paneStack).not.toHaveClass("terminal-pane-stack-split"));
    expect(screen.queryByText("Worker SSH")).not.toBeInTheDocument();
  });

  it("switches between a split workspace and a standalone terminal tab", async () => {
    listTerminalSessionsMock.mockResolvedValue(threeConnectedSessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    const workerTab = screen.getAllByText("Worker SSH")[0].closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    const standaloneTab = screen.getByRole("tab", { name: /Worker SSH \(1\)/i });
    expect(screen.getByRole("tab", { name: /Workspace/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    await user.click(standaloneTab);

    await waitFor(() => expect(paneStack).not.toHaveClass("terminal-pane-stack-split"));
    expect(screen.getByTestId("terminal-pane-header")).toBeInTheDocument();
    expect(standaloneTab).toHaveClass("terminal-tab-active");

    await user.click(screen.getByRole("tab", { name: /Workspace/i }));

    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));
    expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2);
  });

  it("opens the host picker from the terminal tab add button", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "New connection" }));

    const picker = await screen.findByText("Available hosts");
    const pickerPanel = picker.closest(".files-host-picker") as HTMLElement;
    expect(within(pickerPanel).getByPlaceholderText("Filter hosts")).toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Prod SSH/ })).toBeInTheDocument();
    expect(within(pickerPanel).getByRole("button", { name: /Worker SSH/ })).toBeInTheDocument();
  });

  it("resizes pane shells while dragging the splitter and defers terminal resize until release", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1000, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1000, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1000, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));
    expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.5" });

    const splitter = screen.getByRole("separator", { name: "Resize terminal panes" });
    fireEvent.mouseDown(splitter, { clientX: 500, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 300 });

    expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.7" });
    expect(screen.getByTestId("terminal-pane-resize-session-1")).toHaveAttribute("data-resize-suspended", "true");
    expect(screen.getByTestId("terminal-pane-resize-session-2")).toHaveAttribute("data-resize-suspended", "true");

    fireEvent.mouseUp(window, { clientX: 700, clientY: 300 });

    await waitFor(() => expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.7" }));
    await waitFor(() => expect(screen.getByTestId("terminal-pane-resize-session-1")).toHaveAttribute("data-resize-suspended", "false"));

    fireEvent.doubleClick(splitter);

    await waitFor(() => expect(paneStack).toHaveStyle({ "--terminal-split-ratio": "0.5" }));
  });

  it("limits the split drop preview to the target pane instead of the whole workspace", async () => {
    listTerminalSessionsMock.mockResolvedValue(threeConnectedSessions);
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "leaf", tabId: "session-1" },
          { type: "leaf", tabId: "session-2" }
        ]
      },
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getByTestId("terminal-pane-stack")).toHaveClass("terminal-pane-stack-split"));
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1000, height: 600 });

    const nodeTab = screen.getByRole("tab", { name: /Worker SSH \(1\)/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(nodeTab, { dataTransfer });
    fireTerminalDragOver(paneStack, { clientX: 250, clientY: 40, dataTransfer });

    await waitFor(() => expect(document.querySelector(".terminal-drop-preview")).toBeTruthy());
    const preview = document.querySelector(".terminal-drop-preview");
    expect(preview).toBeTruthy();
    expect(preview).toHaveClass("terminal-drop-preview-top");
    expect(preview).toHaveStyle({
      left: "0%",
      top: "0%",
      width: "50%",
      height: "50%"
    });
  });

  it("does not target another pane while dragging inside the pane being moved", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1000, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1000, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1000, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    const paneTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getAllByTestId("terminal-pane-drag-handle")[1], { dataTransfer: paneTransfer });
    fireTerminalDragOver(paneStack, { clientX: 760, clientY: 300, dataTransfer: paneTransfer });

    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-left");
    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-right");
    expect(document.querySelector(".terminal-drop-preview")).not.toBeInTheDocument();
  });

  it("persists and restores the split layout tree for recoverable terminal sessions", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    const firstRender = renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });

    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));
    await waitFor(() => {
      const raw = window.localStorage.getItem("online-ssh-terminal-layout");
      expect(raw).toContain("\"type\":\"split\"");
      expect(raw).toContain("\"direction\":\"vertical\"");
      expect(raw).toContain("\"tabId\":\"session-1\"");
      expect(raw).toContain("\"tabId\":\"session-2\"");
    });

    firstRender.unmount();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getByTestId("terminal-pane-stack")).toHaveClass("terminal-pane-stack-split"));
    expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2);
  });

  it("restores a saved terminal snapshot without entering a recursive update loop", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);
    window.localStorage.setItem("online-ssh-terminal-snapshot", JSON.stringify({
      open_host_ids: ["host-1", "host-2"],
      active_host_id: "host-1",
      active_session_id: "session-1",
      sessions: [
        {
          session_id: "session-1",
          host_id: "host-1",
          host_label: "Prod SSH",
          rows: 36,
          cols: 120,
          started_at: "2026-04-24T12:00:00Z",
          keep_alive_until: null
        },
        {
          session_id: "session-2",
          host_id: "host-2",
          host_label: "Worker SSH",
          rows: 36,
          cols: 120,
          started_at: "2026-04-24T13:00:00Z",
          keep_alive_until: null
        }
      ]
    }));
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", tabId: "session-1" },
            { type: "leaf", tabId: "session-2" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getByTestId("terminal-pane-stack")).toHaveClass("terminal-pane-stack-split"));
    expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2);
    expect(consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes("Maximum update depth exceeded"))).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it("opens the correct connection log for each split terminal pane", async () => {
    listTerminalSessionsMock.mockResolvedValue(connectedSessions);

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    const workerTab = screen.getByText("Worker SSH").closest("[role='tab']");
    expect(workerTab).toBeTruthy();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(workerTab as HTMLElement, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    await waitFor(() => expect(paneStack).toHaveClass("terminal-pane-stack-split"));

    await user.click(screen.getByRole("button", { name: "Connection info for Prod SSH" }));

    let dialog = await screen.findByRole("dialog", { name: "Connection log" });
    expect(within(dialog).getByText(/Prod SSH/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connection log" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Connection info for Worker SSH" }));
    dialog = await screen.findByRole("dialog", { name: "Connection log" });
    expect(within(dialog).getByText(/Worker SSH/)).toBeInTheDocument();
  });

  it("shows the same connection details from the pane header status tooltip", async () => {
    listTerminalSessionsMock.mockResolvedValue({
      items: [{
        ...connectedSessions.items[0],
        expires_at: "2026-04-25T12:00:00Z",
        keep_alive_until: "2026-04-25T12:00:00Z"
      }]
    });

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    const header = screen.getByTestId("terminal-pane-header");
    const status = within(header).getByText("Connecting");
    expect(status.closest(".terminal-status-with-info")).toBeTruthy();
    const tooltip = within(header).getByText(/Restoring backend-managed terminal session/);
    expect(tooltip).toBeInTheDocument();
    expect(within(header).getByText(/session:session-1/)).toBeInTheDocument();
    expect(within(header).getByText(/Created at:/)).toBeInTheDocument();
    expect(within(header).getByText(/Managed until:/)).toBeInTheDocument();
    expect(within(header).getByText(/Keepalive until:/)).toBeInTheDocument();
  });

  it("does not add another pane when the split workspace already has sixteen panes", async () => {
    const openHosts = Array.from({ length: 17 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue(manyConnectedSessions);
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: buildBalancedSplitLayout(Array.from({ length: 16 }, (_, index) => `session-${index + 1}`)),
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("tab", { name: /Workspace/i }));
    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(16));
    expect(screen.getByRole("tab", { name: /Node 17/i })).toBeInTheDocument();
    const node17Tab = screen.getByRole("tab", { name: /Node 17/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(node17Tab, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1200, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1200, clientY: 120, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(16));
    expect(screen.getByRole("tab", { name: /Node 17/i })).toBeInTheDocument();
  });

  it("creates a second split workspace without replacing the first workspace", async () => {
    const openHosts = Array.from({ length: 4 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 4)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "leaf", tabId: "session-1" },
          { type: "leaf", tabId: "session-2" }
        ]
      },
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("tab", { name: /Node 3/i }));
    const node4Tab = screen.getByRole("tab", { name: /Node 4/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(node4Tab, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1190, clientY: 120, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 1190, clientY: 120, dataTransfer });

    await waitFor(() => expect(screen.getAllByRole("tab", { name: /^Workspace$/i })).toHaveLength(1));
    expect(screen.getByRole("tab", { name: /Workspace \(1\)/i })).toBeInTheDocument();
    expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2);
    expect(screen.getByTestId("terminal-pane-stack")).toHaveClass("terminal-pane-stack-split");
    expect(screen.getByText("Node 3")).toBeInTheDocument();
    expect(screen.getByText("Node 4")).toBeInTheDocument();

    await user.click(screen.getAllByRole("tab", { name: /Workspace/i })[0]);

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2));
    expect(screen.getByText("Node 1")).toBeInTheDocument();
    expect(screen.getByText("Node 2")).toBeInTheDocument();
  });

  it("activates the remaining standalone terminal after closing the active workspace", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    let resolveSession1: ((value: { session: typeof createResponse.session }) => void) | null = null;
    let resolveSession2: ((value: { session: typeof createResponse.session }) => void) | null = null;
    closeTerminalSessionMock.mockImplementation((sessionId: string) =>
      new Promise((resolve) => {
        if (sessionId === "session-1") {
          resolveSession1 = resolve;
        } else if (sessionId === "session-2") {
          resolveSession2 = resolve;
        } else {
          resolve({
            session: {
              ...createResponse.session,
              id: sessionId,
              status: "disconnected"
            }
          });
        }
      })
    );
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", tabId: "session-1" },
            { type: "leaf", tabId: "session-2" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const workspaceTab = await screen.findByRole("tab", { name: /^Workspace$/i });
    expect(screen.getByRole("tab", { name: /Node 3/i })).toBeInTheDocument();
    await user.click(within(workspaceTab).getByRole("button", { name: "Close all terminals in workspace" }));

    expect(resolveSession2).toBeTruthy();
    await act(async () => {
      resolveSession2?.({
        session: {
          ...createResponse.session,
          id: "session-2",
          status: "disconnected"
        }
      });
    });
    expect(resolveSession1).toBeTruthy();
    await act(async () => {
      resolveSession1?.({
        session: {
          ...createResponse.session,
          id: "session-1",
          status: "disconnected"
        }
      });
    });

    await waitFor(() => expect(closeTerminalSessionMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^Workspace$/i })).not.toBeInTheDocument());
    const node3Tab = screen.getByRole("tab", { name: /Node 3/i });
    expect(node3Tab).toHaveClass("terminal-tab-active");
    expect(screen.getByTestId("terminal-pane-header")).toHaveTextContent("Node 3");
    expect(screen.queryByText("Node 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Node 2")).not.toBeInTheDocument();
  });

  it("moves a pane inside the same workspace without creating another workspace", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            {
              type: "split",
              direction: "horizontal",
              ratio: 0.5,
              children: [
                { type: "leaf", tabId: "session-1" },
                { type: "leaf", tabId: "session-2" }
              ]
            },
            { type: "leaf", tabId: "session-3" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    const dragHandles = screen.getAllByTestId("terminal-pane-drag-handle");
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(dragHandles[0], { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 580, clientY: 450, dataTransfer });
    fireTerminalDrop(paneStack, { clientX: 580, clientY: 450, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    expect(screen.getAllByRole("tab", { name: /^Workspace$/i })).toHaveLength(1);
    expect(screen.queryByRole("tab", { name: /Workspace \(1\)/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Node 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Node 2/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Node 3/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^Workspace$/i }));
    expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3);
  });

  it("previews same-workspace pane drops against the layout after the dragged pane is removed", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            {
              type: "split",
              direction: "horizontal",
              ratio: 0.5,
              children: [
                { type: "leaf", tabId: "session-1" },
                { type: "leaf", tabId: "session-2" }
              ]
            },
            { type: "leaf", tabId: "session-3" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    const dragHandles = screen.getAllByTestId("terminal-pane-drag-handle");
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(dragHandles[0], { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 580, clientY: 450, dataTransfer });

    const preview = document.querySelector(".terminal-drop-preview");
    expect(preview).toBeTruthy();
    expect(preview).toHaveClass("terminal-drop-preview-right");
    expect(preview).toHaveStyle({
      left: "25%",
      top: "0%",
      width: "25%",
      height: "100%"
    });
  });

  it("removes the dragged vertical pane from the temporary layout and previews a top split", async () => {
    const openHosts = Array.from({ length: 3 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 3)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                { type: "leaf", tabId: "session-1" },
                { type: "leaf", tabId: "session-2" }
              ]
            },
            { type: "leaf", tabId: "session-3" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(3));
    const dragHandles = screen.getAllByTestId("terminal-pane-drag-handle");
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(dragHandles[1], { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 150, clientY: 90, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(2));
    const preview = document.querySelector(".terminal-drop-preview");
    expect(preview).toBeTruthy();
    expect(preview).toHaveClass("terminal-drop-preview-top");
    expect(preview).toHaveStyle({
      left: "0%",
      top: "0%",
      width: "50%",
      height: "50%"
    });
  });

  it("broadcasts input only to panes in the toggled workspace", async () => {
    const openHosts = Array.from({ length: 4 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 4)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layouts: [
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", tabId: "session-1" },
            { type: "leaf", tabId: "session-2" }
          ]
        },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", tabId: "session-3" },
            { type: "leaf", tabId: "session-4" }
          ]
        }
      ],
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    const firstWorkspaceTab = await screen.findByRole("tab", { name: /^Workspace$/i });
    await user.click(within(firstWorkspaceTab).getByRole("button", { name: /Enable broadcast session/i }));
    await user.click(await screen.findByRole("button", { name: /emit terminal input session-1/i }));

    expect(terminalPaneMocks.sentInputs).toEqual([{ sessionId: "session-2", text: "broadcast-input" }]);

    await user.click(screen.getByRole("tab", { name: /Workspace \(1\)/i }));
    await waitFor(() => expect(screen.getByText("Node 3")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /emit terminal input session-3/i }));

    expect(terminalPaneMocks.sentInputs).toEqual([{ sessionId: "session-2", text: "broadcast-input" }]);
  });

  it("does not preview or add a fifth column in a mixed split workspace", async () => {
    const openHosts = Array.from({ length: 9 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 9)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: buildFourColumnTwoRowLayout(),
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("tab", { name: /Workspace/i }));
    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(8));
    const node9Tab = screen.getByRole("tab", { name: /Node 9/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(node9Tab, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1190, clientY: 120, dataTransfer });

    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-right");
    expect(document.querySelector(".terminal-drop-preview")).not.toBeInTheDocument();

    fireTerminalDrop(paneStack, { clientX: 1190, clientY: 120, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(8));
    expect(screen.getByRole("tab", { name: /Node 9/i })).toBeInTheDocument();
  });

  it("does not preview or add a fifth column to a pure vertical split workspace", async () => {
    const openHosts = Array.from({ length: 5 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 5)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: buildLinearSplitLayout(["session-1", "session-2", "session-3", "session-4"], "vertical"),
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("tab", { name: /Workspace/i }));
    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(4));
    const node5Tab = screen.getByRole("tab", { name: /Node 5/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(node5Tab, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 1190, clientY: 120, dataTransfer });

    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-right");
    expect(document.querySelector(".terminal-drop-preview")).not.toBeInTheDocument();

    fireTerminalDrop(paneStack, { clientX: 1190, clientY: 120, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(4));
    expect(screen.getByRole("tab", { name: /Node 5/i })).toBeInTheDocument();
  });

  it("does not preview or add a fifth row to a pure horizontal split workspace", async () => {
    const openHosts = Array.from({ length: 5 }, (_, index) => ({
      ...host,
      id: `host-${index + 1}`,
      credential_id: `cred-${index + 1}`,
      name: `Node ${index + 1}`
    }));
    listHostsMock.mockResolvedValue({
      items: openHosts,
      page: 1,
      page_size: 100,
      total: openHosts.length
    });
    listTerminalSessionsMock.mockResolvedValue({
      items: manyConnectedSessions.items.slice(0, 5)
    });
    window.localStorage.setItem("online-ssh-terminal-layout", JSON.stringify({
      version: 1,
      layout: buildLinearSplitLayout(["session-1", "session-2", "session-3", "session-4"], "horizontal"),
      maximizedTabId: null
    }));

    const user = userEvent.setup();
    renderWithPageProviders(<TerminalPage />, { route: "/terminal" });

    await user.click(await screen.findByRole("tab", { name: /Workspace/i }));
    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(4));
    const node5Tab = screen.getByRole("tab", { name: /Node 5/i });
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(node5Tab, { dataTransfer });
    const paneStack = screen.getByTestId("terminal-pane-stack");
    mockElementRect(paneStack, { left: 0, top: 0, width: 1200, height: 600 });
    fireTerminalDragOver(paneStack, { clientX: 600, clientY: 590, dataTransfer });

    expect(paneStack).not.toHaveClass("terminal-pane-stack-drop-bottom");
    expect(document.querySelector(".terminal-drop-preview")).not.toBeInTheDocument();

    fireTerminalDrop(paneStack, { clientX: 600, clientY: 590, dataTransfer });

    await waitFor(() => expect(screen.getAllByTestId("terminal-pane-header")).toHaveLength(4));
    expect(screen.getByRole("tab", { name: /Node 5/i })).toBeInTheDocument();
  });
});
