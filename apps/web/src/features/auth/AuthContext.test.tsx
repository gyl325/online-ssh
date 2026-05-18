import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { HttpError, authUnauthorizedEvent } from "../../shared/api/http";
import { renderWithAuth } from "../../test/renderWithProviders";
import { AuthProvider, useAuth } from "./AuthContext";
import type { AuthUserResponse } from "./types";
import * as authApi from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    refreshAuthSession: vi.fn(),
    register: vi.fn()
  };
});

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="status">{auth.status}</div>
      <div data-testid="authenticated">{String(auth.isAuthenticated)}</div>
      <div data-testid="user-email">{auth.user?.email ?? "none"}</div>
      <div data-testid="login-method">{auth.session?.login_method ?? "none"}</div>
      <div data-testid="boot-error">{auth.bootError ?? "none"}</div>
    </div>
  );
}

const getCurrentUserMock = vi.mocked(authApi.getCurrentUser);
const refreshAuthSessionMock = vi.mocked(authApi.refreshAuthSession);

const sampleUser: AuthUserResponse = {
  session: {
    id: "session-1",
    client_ip: "203.0.113.10",
    created_at: "2026-04-18T00:00:00Z",
    device_label: "Chrome on macOS",
    expires_at: "2026-04-18T02:00:00Z",
    last_seen_at: "2026-04-18T01:00:00Z",
    login_method: "email_code",
    user_agent: "Mozilla/5.0"
  },
  user: {
    id: "user-1",
    email: "tester@example.com",
    display_name: "Tester",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "user",
    auth_type: "password",
    permissions: ["files.manage"],
    created_at: "2026-04-18T00:00:00Z",
    last_login_at: "2026-04-18T00:00:00Z"
  }
};

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshAuthSessionMock.mockRejectedValue(new HttpError(401, { code: "UNAUTHORIZED", message: "login required" }));
  });

  it("restores the current user on boot", async () => {
    getCurrentUserMock.mockResolvedValue(sampleUser);

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("user-email")).toHaveTextContent(sampleUser.user.email);
    expect(screen.getByTestId("login-method")).toHaveTextContent("email_code");
    expect(window.sessionStorage.getItem("online-ssh.auth-user")).toContain(sampleUser.user.email);
  });

  it("resets to anonymous when the server returns 401 on boot", async () => {
    getCurrentUserMock.mockRejectedValue(new HttpError(401, { code: "UNAUTHORIZED", message: "login required" }));

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("user-email")).toHaveTextContent("none");
    expect(window.sessionStorage.getItem("online-ssh.auth-user")).toBeNull();
  });

  it("uses refresh when the session cookie has expired on boot", async () => {
    getCurrentUserMock.mockRejectedValue(new HttpError(401, { code: "UNAUTHORIZED", message: "login required" }));
    refreshAuthSessionMock.mockResolvedValue(sampleUser);

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(refreshAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user-email")).toHaveTextContent(sampleUser.user.email);
  });

  it("clears the session when the unauthorized event is dispatched", async () => {
    getCurrentUserMock.mockResolvedValue(sampleUser);

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    window.dispatchEvent(new Event(authUnauthorizedEvent));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("user-email")).toHaveTextContent("none");
  });

  it("shows a session invalidation notice when the current session was revoked", async () => {
    getCurrentUserMock.mockResolvedValue(sampleUser);

    renderWithAuth(<AuthProbe />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    window.dispatchEvent(
      new CustomEvent(authUnauthorizedEvent, {
        detail: { reason: "session_revoked" }
      })
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(await screen.findByText("Current login session expired")).toBeInTheDocument();
    expect(screen.getByText("The current session has expired. Please log in again.")).toBeInTheDocument();
  });
});
