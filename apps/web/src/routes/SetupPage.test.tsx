import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bootstrapApi from "../features/bootstrap/api";
import { PreferencesProvider } from "../features/preferences/PreferencesContext";
import { ToastProvider } from "../features/ui/ToastContext";
import { SetupPage } from "./SetupPage";

vi.mock("../features/bootstrap/api", () => ({
  setupBootstrap: vi.fn()
}));

const setupBootstrapMock = vi.mocked(bootstrapApi.setupBootstrap);

function renderSetupPage(onSetupComplete = vi.fn(), setupTokenRequired = false) {
  render(
    <PreferencesProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={["/setup"]}>
          <Routes>
            <Route path="/setup" element={<SetupPage onSetupComplete={onSetupComplete} setupTokenRequired={setupTokenRequired} />} />
            <Route path="/dashboard" element={<div>Dashboard route</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </PreferencesProvider>
  );
}

describe("SetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBootstrapMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@example.com",
        display_name: "Admin",
        preferred_locale: "zh-CN",
        theme: "light",
        status: "active",
        role: "admin",
        auth_type: "password",
        permissions: ["admin.access"],
        created_at: new Date().toISOString()
      },
      session: {
        id: "session-1",
        login_method: "password",
        last_seen_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        created_at: new Date().toISOString()
      }
    });
  });

  it("creates the first administrator", async () => {
    const user = userEvent.setup();
    const onSetupComplete = vi.fn();
    renderSetupPage(onSetupComplete);

    await user.type(screen.getByLabelText("Username"), "Admin");
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "strong-password");
    await user.type(screen.getByLabelText("Confirm password"), "strong-password");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    await waitFor(() =>
      expect(setupBootstrapMock).toHaveBeenCalledWith({
        display_name: "Admin",
        email: "admin@example.com",
        password: "strong-password",
        password_confirm: "strong-password",
        setup_token: ""
      })
    );
    expect(onSetupComplete).toHaveBeenCalledOnce();
    expect(await screen.findByText("Dashboard route")).toBeInTheDocument();
  });

  it("includes the setup token when required", async () => {
    const user = userEvent.setup();
    renderSetupPage(vi.fn(), true);

    await user.type(screen.getByLabelText("Username"), "Admin");
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "strong-password");
    await user.type(screen.getByLabelText("Confirm password"), "strong-password");
    await user.type(screen.getByLabelText("Setup token"), "setup-token");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    await waitFor(() =>
      expect(setupBootstrapMock).toHaveBeenCalledWith({
        display_name: "Admin",
        email: "admin@example.com",
        password: "strong-password",
        password_confirm: "strong-password",
        setup_token: "setup-token"
      })
    );
  });

  it("uses shared eye-icon controls for password fields", async () => {
    const user = userEvent.setup();
    renderSetupPage(vi.fn(), true);

    const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
    const revealButtons = screen.getAllByRole("button", { name: "Show password" });

    expect(revealButtons).toHaveLength(3);
    revealButtons.forEach((button) => {
      expect(button).toHaveClass("auth-password-toggle");
      expect(button).toHaveTextContent("");
      expect(button.querySelector(".lucide-eye")).not.toBeNull();
    });
    expect(passwordInput.type).toBe("password");

    await user.click(revealButtons[0]);

    expect(passwordInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });
});
