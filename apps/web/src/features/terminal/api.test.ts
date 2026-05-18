import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, request } from "../../shared/api/http";
import {
  createTerminalSession,
  listTerminalRecordingChunks,
  listTerminalRecordings,
  listTerminalShareAccessLogs
} from "./api";

vi.mock("../../shared/api/http", () => ({
  HttpError: class HttpError extends Error {
    status: number;
    code: string;
    payload?: unknown;

    constructor(status: number, payload?: { code?: string; message?: string } | unknown) {
      super(typeof payload === "object" && payload !== null && "message" in payload ? String(payload.message) : "request failed");
      this.status = status;
      this.code = typeof payload === "object" && payload !== null && "code" in payload ? String(payload.code) : "HTTP_ERROR";
      this.payload = payload;
    }
  },
  request: vi.fn()
}));

const requestMock = vi.mocked(request);

describe("terminal api query handling", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 });
  });

  it("passes share access log pagination through the shared query option", async () => {
    await listTerminalShareAccessLogs("share-1", { page: 2, page_size: 8 });

    expect(requestMock).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/terminal/shares/share-1/access-logs",
      query: { page: 2, page_size: 8 }
    });
  });

  it("passes recording pagination through the shared query option", async () => {
    await listTerminalRecordings({ page: 3, page_size: 20 });

    expect(requestMock).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/terminal/recordings",
      query: { page: 3, page_size: 20 }
    });
  });

  it("preserves zero cursors when listing recording chunks through the shared query option", async () => {
    await listTerminalRecordingChunks("recording-1", { cursor: 0, limit: 200 });

    expect(requestMock).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/terminal/recordings/recording-1/chunks",
      query: { cursor: 0, limit: 200 }
    });
  });

  it("wraps created terminal sessions as success results", async () => {
    const response = {
      session: {
        id: "session-1",
        host_id: "host-1",
        status: "connected",
        websocket_url: "/ws/terminal",
        created_at: "2026-05-13T00:00:00Z"
      }
    };
    requestMock.mockResolvedValueOnce(response);

    await expect(createTerminalSession({ host_id: "host-1", rows: 32, cols: 100 })).resolves.toEqual({
      kind: "success",
      data: response
    });
    expect(requestMock).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/terminal/sessions",
      body: {
        host_id: "host-1",
        rows: 32,
        cols: 100
      }
    });
  });

  it("maps terminal session fingerprint conflicts to result values", async () => {
    const payload = {
      code: "HOST_FINGERPRINT_CHANGED",
      message: "host fingerprint changed",
      current_fingerprint: {
        algorithm: "SHA256",
        fingerprint: "SHA256:new",
        ok: false,
        message: "changed"
      },
      previous_fingerprint: null
    };
    requestMock.mockRejectedValueOnce(new HttpError(409, payload));

    await expect(createTerminalSession({ host_id: "host-1", rows: 32, cols: 100 })).resolves.toEqual({
      kind: "fingerprint_conflict",
      data: payload
    });
  });

  it("preserves terminal session limit errors as thrown messages", async () => {
    const payload = {
      code: "TERMINAL_SESSION_LIMIT_EXCEEDED",
      message: "terminal session limit exceeded",
      scope: "user",
      limit: 8
    };
    requestMock.mockRejectedValueOnce(new HttpError(429, payload));

    await expect(createTerminalSession({
      host_id: "host-1",
      rows: 32,
      cols: 100,
      formatSessionLimitMessage: (errorPayload) => `Limit ${errorPayload.limit} reached`
    })).rejects.toThrow("Limit 8 reached");
  });
});
