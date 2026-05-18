import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithPageProviders } from "../test/renderWithProviders";
import { HttpError } from "../shared/api/http";
import * as terminalApi from "../features/terminal/api";
import { TerminalSharePage } from "./TerminalSharePage";
import stylesCss from "../styles.css?raw";

vi.mock("../features/terminal/api", () => ({
  openTerminalShareAccess: vi.fn()
}));

vi.mock("../features/terminal/TerminalShareViewer", () => ({
  TerminalShareViewer: ({
    onStateChange,
    protocol,
    websocketUrl
  }: {
    onStateChange?: (update: { expiresAt?: string | null; message?: string; status?: "connecting" | "connected" | "disconnected" | "failed" }) => void;
    protocol: string;
    websocketUrl: string;
  }) => {
    (window as typeof window & { __emitTerminalShareViewerState?: typeof onStateChange }).__emitTerminalShareViewerState = onStateChange;
    return (
      <div data-testid="share-viewer">
        {protocol} {websocketUrl}
      </div>
    );
  }
}));

const openTerminalShareAccessMock = vi.mocked(terminalApi.openTerminalShareAccess);

describe("TerminalSharePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    delete (window as typeof window & { __emitTerminalShareViewerState?: unknown }).__emitTerminalShareViewerState;
  });

  it("opens a public read-only terminal share from the URL token", async () => {
    openTerminalShareAccessMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2026-05-09T11:00:00Z",
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "Production shell. Do not type secrets.",
        viewer_count: 1
      },
      viewer_token: "viewer-token",
      viewer_token_expires_at: "2026-05-09T10:05:00Z",
      websocket: {
        protocol: "terminal-share.v1",
        url: "ws://app.example.com/ws/terminal/share?viewer_token=viewer-token"
      }
    });

    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    await waitFor(() => expect(openTerminalShareAccessMock).toHaveBeenCalledWith(
      "share-token",
      "",
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    ));
    expect(await screen.findByTestId("share-viewer")).toHaveTextContent("terminal-share.v1");
    expect(screen.getByText("Production shell. Do not type secrets.")).toBeInTheDocument();
    const readOnlyBadge = screen.getByText("Read-only").closest(".ui-badge");
    expect(readOnlyBadge).toHaveClass("terminal-share-readonly-badge", "ui-badge-info", "ui-badge-md");
  });

  it("reuses one open idempotency key for the same browser tab", async () => {
    openTerminalShareAccessMock.mockRejectedValue(
      new HttpError(404, { code: "TERMINAL_SHARE_NOT_AVAILABLE", message: "terminal share is not available" })
    );

    const route = "/share/terminal/share-token";
    const firstView = renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route }
    );

    await waitFor(() => expect(openTerminalShareAccessMock).toHaveBeenCalledTimes(1));
    const firstCall = openTerminalShareAccessMock.mock.calls[0] as unknown as [string, string, { idempotencyKey: string }];
    expect(firstCall[2].idempotencyKey).toMatch(/^terminal-share-open-/);
    firstView.unmount();

    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route }
    );

    await waitFor(() => expect(openTerminalShareAccessMock).toHaveBeenCalledTimes(2));
    const secondCall = openTerminalShareAccessMock.mock.calls[1] as unknown as [string, string, { idempotencyKey: string }];
    expect(secondCall[2].idempotencyKey).toBe(firstCall[2].idempotencyKey);
  });

  it("reuses a valid viewer token from the same tab after reload without opening access again", async () => {
    openTerminalShareAccessMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2999-05-09T11:00:00Z",
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "",
        viewer_count: 1
      },
      viewer_token: "viewer-token",
      viewer_token_expires_at: "2999-05-09T10:05:00Z",
      websocket: {
        protocol: "terminal-share.v1",
        url: "ws://app.example.com/ws/terminal/share?viewer_token=viewer-token"
      }
    });

    const route = "/share/terminal/share-token";
    const firstView = renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route }
    );

    await screen.findByTestId("share-viewer");
    expect(openTerminalShareAccessMock).toHaveBeenCalledTimes(1);
    firstView.unmount();

    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route }
    );

    expect(await screen.findByTestId("share-viewer")).toHaveTextContent("viewer-token");
    expect(openTerminalShareAccessMock).toHaveBeenCalledTimes(1);
  });

  it("updates the displayed expiry when the share viewer reports an extension", async () => {
    openTerminalShareAccessMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2026-05-09T10:10:00Z",
        revoked_at: null,
        max_accesses: 5,
        access_count: 1,
        password_required: false,
        sensitive_prompt: "",
        viewer_count: 1
      },
      viewer_token: "viewer-token",
      viewer_token_expires_at: "2026-05-09T10:05:00Z",
      websocket: {
        protocol: "terminal-share.v1",
        url: "ws://app.example.com/ws/terminal/share?viewer_token=viewer-token"
      }
    });

    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    await screen.findByTestId("share-viewer");
    const initialExpiry = screen.getByText(/^Expires:/);
    expect(initialExpiry).toHaveTextContent("2026");
    expect(initialExpiry).toHaveTextContent("10");
    const emitState = (window as typeof window & {
      __emitTerminalShareViewerState?: (update: { expiresAt?: string | null }) => void;
    }).__emitTerminalShareViewerState;
    emitState?.({ expiresAt: "2026-05-09T10:30:00Z" });

    await waitFor(() => expect(screen.getByText(/^Expires:/)).toHaveTextContent("30"));
  });

  it("ignores an expired cached viewer token and opens access again", async () => {
    window.sessionStorage.setItem(
      "online-ssh-terminal-share-access:share-token",
      JSON.stringify({
        share: {
          id: "share-1",
          terminal_session_id: "session-1",
          host_id: "host-1",
          expires_at: "2999-05-09T11:00:00Z",
          revoked_at: null,
          max_accesses: 5,
          access_count: 1,
          password_required: false,
          sensitive_prompt: "",
          viewer_count: 1
        },
        viewer_token: "expired-viewer-token",
        viewer_token_expires_at: "2000-05-09T10:05:00Z",
        websocket: {
          protocol: "terminal-share.v1",
          url: "ws://app.example.com/ws/terminal/share?viewer_token=expired-viewer-token"
        }
      })
    );
    openTerminalShareAccessMock.mockResolvedValue({
      share: {
        id: "share-1",
        terminal_session_id: "session-1",
        host_id: "host-1",
        expires_at: "2999-05-09T11:00:00Z",
        revoked_at: null,
        max_accesses: 5,
        access_count: 2,
        password_required: false,
        sensitive_prompt: "",
        viewer_count: 1
      },
      viewer_token: "fresh-viewer-token",
      viewer_token_expires_at: "2999-05-09T10:05:00Z",
      websocket: {
        protocol: "terminal-share.v1",
        url: "ws://app.example.com/ws/terminal/share?viewer_token=fresh-viewer-token"
      }
    });

    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    expect(await screen.findByTestId("share-viewer")).toHaveTextContent("fresh-viewer-token");
    await waitFor(() => expect(openTerminalShareAccessMock).toHaveBeenCalledTimes(1));
  });

  it("shows an invalid password error after a submitted password fails", async () => {
    openTerminalShareAccessMock.mockRejectedValue(
      new HttpError(401, { code: "TERMINAL_SHARE_PASSWORD_INVALID", message: "share password is invalid" })
    );

    const user = userEvent.setup();
    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    expect(await screen.findByText("Enter the share password.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open share" })).toHaveClass("terminal-share-password-submit");
    await user.type(screen.getByLabelText("Access password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Open share" }));

    expect(await screen.findByText("Share password is invalid.")).toBeInTheDocument();
  });

  it("uses the shared eye-icon control for share access passwords", async () => {
    openTerminalShareAccessMock.mockRejectedValue(
      new HttpError(401, { code: "TERMINAL_SHARE_PASSWORD_INVALID", message: "share password is invalid" })
    );

    const user = userEvent.setup();
    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    const passwordInput = (await screen.findByLabelText("Access password")) as HTMLInputElement;
    const revealButton = screen.getByRole("button", { name: "Show password" });

    expect(passwordInput.type).toBe("password");
    expect(revealButton).toHaveClass("auth-password-toggle");
    expect(revealButton).toHaveTextContent("");
    expect(revealButton.querySelector(".lucide-eye")).not.toBeNull();

    await user.click(revealButton);

    expect(passwordInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("keeps the password input and open button the same height", () => {
    expect(stylesCss).toMatch(
      /\.terminal-share-password-form \.auth-input-group,[\s\S]*?\.terminal-share-password-submit\.ui-button\s*\{[^}]*height:\s*var\(--ui-control-height-lg\);[\s\S]*?min-height:\s*var\(--ui-control-height-lg\);/
    );
    expect(stylesCss).toMatch(
      /\.terminal-share-password-field\s*\{[^}]*display:\s*contents;/
    );
    expect(stylesCss).toMatch(
      /\.terminal-share-password-submit\.ui-button\s*\{[^}]*grid-column:\s*2;[\s\S]*?grid-row:\s*2;/
    );
  });

  it("localizes unavailable and access limit errors without showing raw backend messages", async () => {
    openTerminalShareAccessMock.mockRejectedValueOnce(
      new HttpError(429, { code: "TERMINAL_SHARE_ACCESS_LIMIT", message: "terminal share access limit reached" })
    );
    const { unmount } = renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    expect(await screen.findAllByText("This terminal share has reached its access limit.")).not.toHaveLength(0);
    expect(screen.queryByText("terminal share access limit reached")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Access password")).not.toBeInTheDocument();
    unmount();

    openTerminalShareAccessMock.mockRejectedValueOnce(
      new HttpError(404, { code: "TERMINAL_SHARE_NOT_AVAILABLE", message: "terminal share is not available" })
    );
    renderWithPageProviders(
      <Routes>
        <Route path="/share/terminal/:token" element={<TerminalSharePage />} />
      </Routes>,
      { route: "/share/terminal/share-token" }
    );

    expect(await screen.findAllByText("This terminal share is no longer available.")).not.toHaveLength(0);
    expect(screen.queryByText("terminal share is not available")).not.toBeInTheDocument();
  });
});
