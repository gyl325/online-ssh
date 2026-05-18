import { beforeEach, describe, expect, it, vi } from "vitest";

import { request, requestBlob } from "../../shared/api/http";
import { exportAdminDatabase } from "./api";

vi.mock("../../shared/api/http", () => ({
  request: vi.fn(),
  requestBlob: vi.fn()
}));

const requestMock = vi.mocked(request);
const requestBlobMock = vi.mocked(requestBlob);

describe("admin api blob handling", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestBlobMock.mockReset();
    requestBlobMock.mockResolvedValue(new Blob());
  });

  it("uses the shared blob request helper for database exports", async () => {
    await exportAdminDatabase();

    expect(requestBlobMock).toHaveBeenCalledWith({
      path: "/api/admin/database/export"
    });
  });
});
