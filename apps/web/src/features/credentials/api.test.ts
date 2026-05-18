import { beforeEach, describe, expect, it, vi } from "vitest";

import { request } from "../../shared/api/http";
import { listCredentials } from "./api";

vi.mock("../../shared/api/http", () => ({
  request: vi.fn()
}));

const requestMock = vi.mocked(request);

describe("credentials api query handling", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ items: [], page: 1, page_size: 100, total: 0 });
  });

  it("passes list filters through the shared query option", async () => {
    await listCredentials("private_key");

    expect(requestMock).toHaveBeenCalledWith({
      path: "/api/credentials",
      query: {
        page: 1,
        page_size: 100,
        auth_type: "private_key"
      }
    });
  });
});
