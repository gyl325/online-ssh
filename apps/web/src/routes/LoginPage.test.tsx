import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../features/auth/AuthContext";
import type { AuthUserResponse } from "../features/auth/types";
import { PreferencesProvider } from "../features/preferences/PreferencesContext";
import { ToastProvider } from "../features/ui/ToastContext";
import { HttpError } from "../shared/api/http";
import { LoginPage } from "./LoginPage";
import * as authApi from "../features/auth/api";
import stylesCss from "../styles.css?raw";

vi.mock("../features/auth/api", async () => {
  const actual = await vi.importActual<typeof import("../features/auth/api")>("../features/auth/api");
  return {
    ...actual,
    getAuthConfig: vi.fn(),
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    loginWithEmailCode: vi.fn(),
    verifyMfaLogin: vi.fn(),
    refreshAuthSession: vi.fn(),
    register: vi.fn(),
    sendEmailVerificationCode: vi.fn()
  };
});

const getAuthConfigMock = vi.mocked(authApi.getAuthConfig);
const getCurrentUserMock = vi.mocked(authApi.getCurrentUser);
const loginMock = vi.mocked(authApi.login);
const loginWithEmailCodeMock = vi.mocked(authApi.loginWithEmailCode);
const verifyMfaLoginMock = vi.mocked(authApi.verifyMfaLogin);
const refreshAuthSessionMock = vi.mocked(authApi.refreshAuthSession);
const registerMock = vi.mocked(authApi.register);
const sendEmailVerificationCodeMock = vi.mocked(authApi.sendEmailVerificationCode);

const userResponse: AuthUserResponse = {
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
    created_at: "2026-04-24T00:00:00Z",
    last_login_at: "2026-04-24T01:00:00Z"
  }
};

function LoginWrapper({ children }: PropsWithChildren) {
  return (
    <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: "/terminal" } }]}>
      <PreferencesProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={children} />
              <Route path="/dashboard" element={<div>Dashboard route</div>} />
              <Route path="/terminal" element={<div>Terminal route</div>} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>
  );
}

function renderLoginPage() {
  return render(
    <LoginWrapper>
      <LoginPage />
    </LoginWrapper>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthConfigMock.mockResolvedValue({ allow_registration: true });
    getCurrentUserMock.mockRejectedValue(
      new HttpError(401, { code: "UNAUTHORIZED", message: "login required" })
    );
    refreshAuthSessionMock.mockRejectedValue(
      new HttpError(401, { code: "UNAUTHORIZED", message: "login required" })
    );
  });

  it("logs in and redirects to the protected route that sent the user here", async () => {
    loginMock.mockResolvedValue(userResponse);

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(await screen.findByLabelText("Email or username"), "tester@example.com");
    await user.type(screen.getAllByLabelText("Password")[0], "secret-password");
    await user.click(screen.getByRole("button", { name: "Log in to console" }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        identifier: "tester@example.com",
        password: "secret-password"
      })
    );
    expect(await screen.findByText("Terminal route")).toBeInTheDocument();
  });

  it("logs in with a username and keeps the same visual flow", async () => {
    loginMock.mockResolvedValue(userResponse);

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(await screen.findByLabelText("Email or username"), "Tester");
    await user.type(screen.getAllByLabelText("Password")[0], "secret-password");
    await user.click(screen.getByRole("button", { name: "Log in to console" }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        identifier: "Tester",
        password: "secret-password"
      })
    );
    expect(await screen.findByText("Terminal route")).toBeInTheDocument();
  });

  it("registers a new user and redirects to the dashboard", async () => {
    registerMock.mockResolvedValue(userResponse);

    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Register" }));
    await user.type(screen.getByLabelText("Username"), "Tester");
    await user.type(screen.getAllByLabelText("Password")[0], "secret-password");
    await user.type(screen.getAllByLabelText("Confirm password")[0], "secret-password");
    await user.type(screen.getByLabelText("Email"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    const codeDigits = screen.getAllByLabelText(/Verification code digit/);
    expect(codeDigits).toHaveLength(6);
    await user.type(codeDigits[0], "123456");
    await user.click(screen.getByRole("button", { name: "Register and enter console" }));

    await waitFor(() =>
      expect(sendEmailVerificationCodeMock).toHaveBeenCalledWith({
        email: "tester@example.com",
        purpose: "register"
      })
    );
    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith({
        display_name: "Tester",
        email: "tester@example.com",
        password: "secret-password",
        password_confirm: "secret-password",
        verification_code: "123456"
      })
    );
    expect(await screen.findByText("Dashboard route")).toBeInTheDocument();
  });

  it("orders the registration fields and places code sending with the verification code", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Register" }));

    const authForm = screen.getByRole("button", { name: "Register and enter console" }).closest("form");
    expect(authForm).not.toBeNull();
    const fields = Array.from((authForm as HTMLFormElement).querySelectorAll(".ui-field"));
    expect(fields.map((field) => field.querySelector(".ui-field-label")?.textContent)).toEqual([
      "Username",
      "Password",
      "Confirm password",
      "Email",
      "Verification code"
    ]);

    const emailField = screen.getByLabelText("Email").closest(".ui-field");
    const verificationField = screen.getByText("Verification code").closest(".ui-field");
    expect(emailField).not.toContainElement(screen.getByRole("button", { name: "Send code" }));
    expect(verificationField).toContainElement(screen.getByRole("button", { name: "Send code" }));
    expect(verificationField).toHaveClass("auth-code-field-with-send");
    expect(screen.getByRole("button", { name: "Send code" }).closest(".auth-verification-row")).toContainElement(
      screen.getByLabelText("Verification code digit 1")
    );
  });

  it("logs in with an email verification code", async () => {
    loginWithEmailCodeMock.mockResolvedValue(userResponse);

    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Email code" }));
    await user.type(screen.getByLabelText("Email"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    const codeDigits = screen.getAllByLabelText(/Verification code digit/);
    expect(codeDigits).toHaveLength(6);
    await user.type(codeDigits[0], "654321");
    await user.click(screen.getByRole("button", { name: "Log in with code" }));

    await waitFor(() =>
      expect(sendEmailVerificationCodeMock).toHaveBeenCalledWith({
        identifier: "tester@example.com",
        purpose: "login"
      })
    );
    await waitFor(() =>
      expect(loginWithEmailCodeMock).toHaveBeenCalledWith({
        identifier: "tester@example.com",
        verification_code: "654321"
      })
    );
    expect(await screen.findByText("Terminal route")).toBeInTheDocument();
  });

  it("keeps email-code login email full width and validates email format before sending", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Email code" }));

    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    const emailField = emailInput.closest(".ui-field");
    const verificationField = screen.getByText("Verification code").closest(".ui-field");
    const sendButton = screen.getByRole("button", { name: "Send code" });

    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toHaveAttribute("autocomplete", "email");
    expect(emailField).not.toContainElement(sendButton);
    expect(verificationField).toContainElement(sendButton);
    expect(verificationField).toHaveClass("auth-code-field-with-send");
    expect(sendButton.closest(".auth-verification-row")).toContainElement(
      screen.getByLabelText("Verification code digit 1")
    );

    await user.type(emailInput, "Tester");
    expect(sendButton).toBeDisabled();
    expect(sendEmailVerificationCodeMock).not.toHaveBeenCalled();

    await user.clear(emailInput);
    await user.type(emailInput, "tester@example.com");
    expect(sendButton).toBeEnabled();
  });

  it("keeps verification send buttons aligned to the form edge", () => {
    expect(stylesCss).toMatch(
      /\.auth-code-field\.auth-code-field-with-send\s*\{[^}]*width:\s*100%;/
    );
    expect(stylesCss.indexOf(".auth-code-field.auth-code-field-with-send")).toBeGreaterThan(
      stylesCss.indexOf(".auth-code-field {")
    );
    expect(stylesCss).toMatch(
      /\.auth-verification-row\s*\{[^}]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*max-content\)\s+128px;[\s\S]*justify-content:\s*space-between;/
    );
    expect(stylesCss).toMatch(
      /\.auth-verification-row \.auth-code-input\s*\{[^}]*justify-content:\s*start;/
    );
  });

  it("requires and verifies MFA before entering the protected route", async () => {
    loginMock.mockResolvedValue({
      status: "mfa_required",
      mfa_token: "pending-token",
      methods: ["totp", "recovery_code"],
      expires_at: "2026-05-08T12:05:00Z"
    });
    verifyMfaLoginMock.mockResolvedValue(userResponse);

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(await screen.findByLabelText("Email or username"), "tester@example.com");
    await user.type(screen.getAllByLabelText("Password")[0], "secret-password");
    await user.click(screen.getByRole("button", { name: "Log in to console" }));

    expect(await screen.findByRole("heading", { name: "Two-factor authentication" })).toBeInTheDocument();
    const codeField = screen.getByText("Verification code").closest(".auth-code-field");
    expect(codeField).not.toBeNull();
    expect(codeField).toContainElement(screen.getByLabelText("Verification code digit 1"));
    const codeDigits = screen.getAllByLabelText(/Verification code digit/);
    await user.type(codeDigits[0], "123456");
    await user.click(screen.getByRole("button", { name: "Verify and enter console" }));

    await waitFor(() =>
      expect(verifyMfaLoginMock).toHaveBeenCalledWith({
        mfa_token: "pending-token",
        code: "123456"
      })
    );
    expect(await screen.findByText("Terminal route")).toBeInTheDocument();
  });

  it("verifies MFA with an uppercased recovery code", async () => {
    loginMock.mockResolvedValue({
      status: "mfa_required",
      mfa_token: "pending-token",
      methods: ["totp", "recovery_code"],
      expires_at: "2026-05-08T12:05:00Z"
    });
    verifyMfaLoginMock.mockResolvedValue(userResponse);

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(await screen.findByLabelText("Email or username"), "tester@example.com");
    await user.type(screen.getAllByLabelText("Password")[0], "secret-password");
    await user.click(screen.getByRole("button", { name: "Log in to console" }));
    await user.click(await screen.findByRole("button", { name: "Use recovery code" }));
    await user.type(screen.getByLabelText("Recovery code"), "abcd-efgh");
    await user.click(screen.getByRole("button", { name: "Verify and enter console" }));

    await waitFor(() =>
      expect(verifyMfaLoginMock).toHaveBeenCalledWith({
        mfa_token: "pending-token",
        recovery_code: "ABCD-EFGH"
      })
    );
  });

  it("blocks registration when the password confirmation does not match", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Register" }));
    await user.type(screen.getByLabelText("Username"), "Tester");
    await user.type(screen.getByLabelText("Email"), "tester@example.com");
    await user.type(screen.getAllByLabelText("Password")[0], "secret-password");
    await user.type(screen.getAllByLabelText("Confirm password")[0], "different-password");
    await user.type(screen.getAllByLabelText(/Verification code digit/)[0], "123456");
    await user.click(screen.getByRole("button", { name: "Register and enter console" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("uses compact accessible password reveal controls", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    const passwordInput = (await screen.findByLabelText("Password")) as HTMLInputElement;
    const revealButton = screen.getByRole("button", { name: "Show password" });

    expect(revealButton).toHaveClass("auth-password-toggle");
    expect(passwordInput.type).toBe("password");
    await user.click(revealButton);
    expect(passwordInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("shows the login error returned by the API", async () => {
    loginMock.mockRejectedValue(new Error("invalid credentials"));

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(await screen.findByLabelText("Email or username"), "tester@example.com");
    await user.type(screen.getAllByLabelText("Password")[0], "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in to console" }));

    expect(await screen.findByText("invalid credentials")).toBeInTheDocument();
    expect(screen.queryByText("Terminal route")).not.toBeInTheDocument();
  });

  it("shows a localized friendly message when a registration email is outside the whitelist", async () => {
    sendEmailVerificationCodeMock.mockRejectedValue(
      new HttpError(403, { code: "EMAIL_NOT_ALLOWED", message: "email is not allowed" })
    );

    const user = userEvent.setup();
    renderLoginPage();

    await user.click(await screen.findByRole("button", { name: "Register" }));
    await user.type(screen.getByLabelText("Email"), "blocked@gmail.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(
      await screen.findByText("This email is not allowed for new registration. Use an approved email or contact an administrator.")
    ).toBeInTheDocument();
    expect(screen.queryByText("email is not allowed")).not.toBeInTheDocument();
  });
});
