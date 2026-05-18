import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, request } from "../../shared/api/http";
import { listHosts, testHost } from "./api";

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

describe("hosts api query handling", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ items: [], page: 1, page_size: 100, total: 0 });
  });

  it("passes list filters through the shared query option", async () => {
    await listHosts("prod", true, "group-1");

    expect(requestMock).toHaveBeenCalledWith({
      path: "/api/hosts",
      query: {
        page: 1,
        page_size: 100,
        keyword: "prod",
        favorite_only: true,
        group_id: "group-1"
      }
    });
  });

  it("maps host test fingerprint conflicts through the shared result helper", async () => {
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

    await expect(testHost("host-1")).resolves.toEqual({
      kind: "fingerprint_conflict",
      data: payload
    });
  });
});
