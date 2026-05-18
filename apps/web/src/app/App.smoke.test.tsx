import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "../shared/api/http";
import { App } from "./App";
import * as authApi from "../features/auth/api";
import * as bootstrapApi from "../features/bootstrap/api";

vi.mock("../features/auth/api", async () => {
  const actual = await vi.importActual<typeof import("../features/auth/api")>("../features/auth/api");
  return {
    ...actual,
    getAuthConfig: vi.fn(),
    getCurrentUser: vi.fn(),
    refreshAuthSession: vi.fn()
  };
});

vi.mock("../features/bootstrap/api", () => ({
  getBootstrapStatus: vi.fn()
}));

const getAuthConfigMock = vi.mocked(authApi.getAuthConfig);
const getCurrentUserMock = vi.mocked(authApi.getCurrentUser);
const refreshAuthSessionMock = vi.mocked(authApi.refreshAuthSession);
const getBootstrapStatusMock = vi.mocked(bootstrapApi.getBootstrapStatus);

describe("App smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    getAuthConfigMock.mockResolvedValue({ allow_registration: true });
    getCurrentUserMock.mockRejectedValue(
      new HttpError(401, { code: "UNAUTHORIZED", message: "login required" })
    );
    refreshAuthSessionMock.mockRejectedValue(
      new HttpError(401, { code: "UNAUTHORIZED", message: "login required" })
    );
    getBootstrapStatusMock.mockResolvedValue({ setup_required: false });
  });

  it("boots the app shell and reaches the login route for anonymous users", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Online SSH Console" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
    expect(getCurrentUserMock).toHaveBeenCalledWith({ skipAuthRefresh: true });
  });

  it("shows setup before login when the system is uninitialized", async () => {
    getBootstrapStatusMock.mockResolvedValue({ setup_required: true });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Create administrator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });
});
