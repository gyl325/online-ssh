import { beforeEach, describe, expect, it, vi } from "vitest";

import { request, requestBlob } from "../../shared/api/http";
import { downloadTransferTaskContent, listTransferTasks, uploadTransferChunk } from "./api";

vi.mock("../../shared/api/http", () => ({
  request: vi.fn(),
  requestBlob: vi.fn()
}));

const requestMock = vi.mocked(request);
const requestBlobMock = vi.mocked(requestBlob);

describe("transfers api query handling", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestBlobMock.mockReset();
    requestMock.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 });
    requestBlobMock.mockResolvedValue(new Blob());
  });

  it("passes transfer filters through the shared query option", async () => {
    await listTransferTasks({
      page: 3,
      page_size: 25,
      status: "transferring",
      task_type: "upload",
      created_from: "2026-05-01T00:00:00Z",
      created_to: "2026-05-02T00:00:00Z"
    });

    expect(requestMock).toHaveBeenCalledWith({
      path: "/api/transfers",
      query: {
        page: 3,
        page_size: 25,
        status: "transferring",
        task_type: "upload",
        created_from: "2026-05-01T00:00:00Z",
        created_to: "2026-05-02T00:00:00Z"
      }
    });
  });

  it("preserves zero upload offsets through the shared query option", async () => {
    const payload = new Blob(["chunk"]);

    await uploadTransferChunk("task-1", 0, payload);

    expect(requestMock).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/api/transfers/upload/task-1/chunk",
      query: { offset: 0 },
      body: payload,
      bodyType: "raw",
      headers: {
        "Content-Type": "application/octet-stream"
      }
    });
  });

  it("uses the shared blob request helper for downloaded content", async () => {
    await downloadTransferTaskContent("task-1");

    expect(requestBlobMock).toHaveBeenCalledWith({
      path: "/api/transfers/task-1/content"
    });
  });
});
