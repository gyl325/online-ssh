import { beforeEach, describe, expect, it, vi } from "vitest";

import { request, requestBlob } from "../../shared/api/http";
import { downloadAuditExport, listAuditExports } from "./api";

vi.mock("../../shared/api/http", () => ({
  request: vi.fn(),
  requestBlob: vi.fn()
}));

const requestMock = vi.mocked(request);
const requestBlobMock = vi.mocked(requestBlob);

describe("audit export api query handling", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestBlobMock.mockReset();
    requestMock.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 });
    requestBlobMock.mockResolvedValue(new Blob());
  });

  it("passes pagination through the shared query option", async () => {
    await listAuditExports({ page: 2, page_size: 50 });

    expect(requestMock).toHaveBeenCalledWith({
      path: "/api/audit/exports",
      query: { page: 2, page_size: 50 }
    });
  });

  it("uses the shared blob request helper for downloads", async () => {
    await downloadAuditExport("export-1");

    expect(requestBlobMock).toHaveBeenCalledWith({
      path: "/api/audit/exports/export-1/download"
    });
  });
});
