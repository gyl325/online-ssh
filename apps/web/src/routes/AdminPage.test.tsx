import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminPage } from "./AdminPage";
import { PreferencesProvider } from "../features/preferences/PreferencesContext";
import { ToastProvider } from "../features/ui/ToastContext";
import { ConfirmDialogProvider } from "../features/ui/ConfirmDialogContext";
import stylesCss from "../styles.css?raw";
import * as adminApi from "../features/admin/api";
import type { AdminGeneralSettings } from "../features/admin/types";
import { selectInputOption } from "../test/selectInput";
import * as downloadLib from "../shared/lib/download";

vi.mock("../features/auth/AuthContext", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      id: "user-1",
      display_name: "Admin User",
      email: "admin@example.com",
      preferred_locale: "en-US",
      theme: "dark",
      status: "active",
      role: "admin",
      permissions: [
        "admin.access",
        "admin.users.manage",
        "admin.sessions.manage",
        "admin.roles.manage",
        "admin.database.manage"
      ],
      auth_type: "password",
      created_at: "2026-04-18T00:00:00Z"
    }
  })
}));

vi.mock("../features/admin/api", () => ({
  listAdminUsers: vi.fn(),
  listAdminSessions: vi.fn(),
  listAdminRoles: vi.fn(),
  createAdminRole: vi.fn(),
  updateAdminRole: vi.fn(),
  deleteAdminRole: vi.fn(),
  revokeAdminSession: vi.fn(),
  revokeAdminUserSessions: vi.fn(),
  getAdminUserMfa: vi.fn(),
  resetAdminUserMfa: vi.fn(),
  deleteAdminUser: vi.fn(),
  updateAdminUserRole: vi.fn(),
  updateAdminUserStatus: vi.fn(),
  getAdminGeneralSettings: vi.fn(),
  updateAdminGeneralSettings: vi.fn(),
  sendAdminGeneralSettingsTestEmail: vi.fn(),
  testAdminGeneralSettingsLlm: vi.fn(),
  exportAdminDatabase: vi.fn(),
  importAdminDatabase: vi.fn()
}));

vi.mock("../shared/lib/download", () => ({
  saveBlobAsFile: vi.fn()
}));

const listAdminUsersMock = vi.mocked(adminApi.listAdminUsers);
const listAdminSessionsMock = vi.mocked(adminApi.listAdminSessions);
const listAdminRolesMock = vi.mocked(adminApi.listAdminRoles);
const getAdminGeneralSettingsMock = vi.mocked(adminApi.getAdminGeneralSettings);
const updateAdminGeneralSettingsMock = vi.mocked(adminApi.updateAdminGeneralSettings);
const sendAdminGeneralSettingsTestEmailMock = vi.mocked(adminApi.sendAdminGeneralSettingsTestEmail);
const testAdminGeneralSettingsLlmMock = vi.mocked(adminApi.testAdminGeneralSettingsLlm);
const exportAdminDatabaseMock = vi.mocked(adminApi.exportAdminDatabase);
const importAdminDatabaseMock = vi.mocked(adminApi.importAdminDatabase);
const saveBlobAsFileMock = vi.mocked(downloadLib.saveBlobAsFile);
const resetAdminUserMfaMock = vi.mocked(adminApi.resetAdminUserMfa);

const adminGeneralSettings: AdminGeneralSettings = {
  allow_user_registration: true,
  session_idle_timeout_minutes: 120,
  refresh_token_ttl_hours: 168,
  terminal_max_sessions_per_user: 16,
  terminal_max_sessions_total: 16,
  terminal_keep_alive_hours: 24,
  file_sftp_idle_ttl_minutes: 5,
  host_connectivity_poll_interval_seconds: 30,
  smtp_host: "smtp.example.com",
  smtp_port: 465,
  smtp_from: "noreply@example.com",
  smtp_from_name: "Online SSH",
  smtp_username: "smtp-user",
  smtp_password: "",
  smtp_password_configured: true,
  smtp_use_ssl: true,
  auth_allowed_emails: "admin@example.com",
  auth_allowed_email_domains: "example.com",
  auth_email_code_length: 6,
  auth_email_code_ttl_minutes: 5,
  auth_email_code_max_attempts: 5,
  auth_email_code_resend_cooldown_seconds: 60,
  auth_email_code_email_window_minutes: 15,
  auth_email_code_email_window_max_sends: 5,
  auth_email_code_ip_window_minutes: 15,
  auth_email_code_ip_window_max_sends: 10,
  llm_enabled: true,
  llm_protocol: "openai",
  llm_base_url: "https://llm.example.com/v1",
  llm_model: "mimo-v2.5-pro",
  llm_auth_header: "api_key",
  llm_api_key: "",
  llm_api_key_configured: true,
  llm_timeout_seconds: 30,
  llm_max_tokens: 1024
};

const adminUsers = [
  {
    id: "user-1",
    display_name: "Admin User",
    email: "admin@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "admin",
    permissions: ["admin.access"],
    auth_type: "password",
    active_session_count: 2,
    mfa_enabled: false,
    last_login_at: "2026-05-04T08:00:00Z",
    created_at: "2026-04-18T00:00:00Z"
  },
  {
    id: "user-2",
    display_name: "Ops User",
    email: "ops@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "operator",
    permissions: ["hosts.manage"],
    auth_type: "password",
    active_session_count: 1,
    mfa_enabled: true,
    last_login_at: "2026-05-03T08:00:00Z",
    created_at: "2026-04-19T00:00:00Z"
  },
  {
    id: "user-7",
    display_name: "Security Admin",
    email: "security-admin@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "admin",
    permissions: ["admin.access"],
    auth_type: "password",
    active_session_count: 0,
    mfa_enabled: true,
    last_login_at: "2026-05-03T10:00:00Z",
    created_at: "2026-04-19T10:00:00Z"
  },
  {
    id: "user-3",
    display_name: "Disabled User",
    email: "disabled@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "disabled",
    role: "user",
    permissions: [],
    auth_type: "password",
    active_session_count: 0,
    mfa_enabled: false,
    last_login_at: null,
    created_at: "2026-04-20T00:00:00Z"
  },
  {
    id: "user-4",
    display_name: "File User",
    email: "files@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "user",
    permissions: ["files.manage"],
    auth_type: "password",
    active_session_count: 0,
    mfa_enabled: false,
    last_login_at: "2026-05-02T08:00:00Z",
    created_at: "2026-04-21T00:00:00Z"
  },
  {
    id: "user-5",
    display_name: "Terminal User",
    email: "term@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "user",
    permissions: ["terminal.connect"],
    auth_type: "password",
    active_session_count: 0,
    mfa_enabled: false,
    last_login_at: "2026-05-01T08:00:00Z",
    created_at: "2026-04-22T00:00:00Z"
  },
  {
    id: "user-6",
    display_name: "Audit User",
    email: "audit@example.com",
    preferred_locale: "en-US",
    theme: "dark",
    status: "active",
    role: "auditor",
    permissions: ["audit.read"],
    auth_type: "password",
    active_session_count: 0,
    mfa_enabled: false,
    last_login_at: "2026-04-30T08:00:00Z",
    created_at: "2026-04-23T00:00:00Z"
  }
] satisfies Awaited<ReturnType<typeof listAdminUsersMock>>["items"];

function renderAdminPage(options: { visible?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <PreferencesProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <AdminPage visible={options.visible} />
          </ConfirmDialogProvider>
        </ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>
  );
}

describe("AdminPage", () => {
  beforeEach(() => {
    listAdminUsersMock.mockResolvedValue({ items: adminUsers });
    listAdminSessionsMock.mockResolvedValue({
      items: [
        {
          id: "session-1",
          user_id: "user-1",
          user_email: "admin@example.com",
          user_display_name: "Admin User",
          user_role: "admin",
          client_ip: "127.0.0.1",
          user_agent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
          device_label: null,
          login_method: "password",
          last_seen_at: "2026-05-04T08:00:00Z",
          expires_at: "2026-05-04T10:00:00Z",
          created_at: "2026-05-04T07:00:00Z"
        },
        {
          id: "session-2",
          user_id: "user-2",
          user_email: "ops@example.com",
          user_display_name: "Ops User",
          user_role: "operator",
          client_ip: "10.0.0.2",
          user_agent: "CustomClient/1.0",
          device_label: "Office laptop",
          login_method: "email_code",
          last_seen_at: "2026-05-04T07:55:00Z",
          expires_at: "2026-05-04T09:55:00Z",
          created_at: "2026-05-04T07:10:00Z"
        }
      ]
    });
    listAdminRolesMock.mockResolvedValue({
      items: [
        {
          key: "admin",
          name: "Admin",
          description: "Full access",
          is_system: true,
          is_active: true,
          user_count: 1,
          permissions: ["admin.access"],
          created_at: "2026-04-18T00:00:00Z",
          updated_at: "2026-04-18T00:00:00Z"
        },
        {
          key: "auditor",
          name: "Auditor",
          description: "Audit access",
          is_system: false,
          is_active: true,
          user_count: 3,
          permissions: ["audit.read"],
          created_at: "2026-04-18T00:00:00Z",
          updated_at: "2026-04-18T00:00:00Z"
        },
        {
          key: "operator",
          name: "Operator",
          description: "Operate resources",
          is_system: false,
          is_active: true,
          user_count: 1,
          permissions: ["hosts.manage", "credentials.manage", "files.manage", "terminal.connect"],
          created_at: "2026-04-18T00:00:00Z",
          updated_at: "2026-04-18T00:00:00Z"
        }
      ],
      permissions: [
        { key: "admin.access", label: "Admin settings", description: "Open admin settings" },
        { key: "admin.users.manage", label: "Manage users", description: "Disable users and update roles" },
        { key: "admin.roles.manage", label: "Manage roles", description: "Create and edit roles" },
        { key: "hosts.manage", label: "Manage hosts", description: "Create and edit hosts" },
        { key: "credentials.manage", label: "Manage credentials", description: "Create and edit credentials" },
        { key: "files.manage", label: "Manage files", description: "Use the file manager" },
        { key: "terminal.connect", label: "Connect terminals", description: "Open terminal sessions" },
        { key: "audit.read", label: "Audit", description: "Read audit logs" }
      ]
    });
    getAdminGeneralSettingsMock.mockResolvedValue({ settings: adminGeneralSettings });
    updateAdminGeneralSettingsMock.mockImplementation(async (settings) => ({ settings }));
    sendAdminGeneralSettingsTestEmailMock.mockResolvedValue({ sent: true });
    testAdminGeneralSettingsLlmMock.mockResolvedValue({ ok: true, protocol: "openai", model: "mimo-v2.5-pro" });
    exportAdminDatabaseMock.mockResolvedValue(new Blob([JSON.stringify({ schema_version: 1 })], { type: "application/json" }));
    importAdminDatabaseMock.mockResolvedValue({
      host_groups_imported: 1,
      host_groups_skipped: 1,
      credentials_imported: 2,
      credentials_skipped: 0,
      hosts_imported: 3,
      hosts_skipped: 1
    });
    saveBlobAsFileMock.mockReset();
    resetAdminUserMfaMock.mockResolvedValue(undefined);
  });

  it("renders the admin console shell", async () => {
    renderAdminPage();

    expect(await screen.findByText("Admin settings")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Admin settings navigation" })).toBeInTheDocument();
    expect(await screen.findByText("Account and sessions")).toBeInTheDocument();
    expect(screen.getByText("120 minutes")).toBeInTheDocument();
    expect(screen.queryByText("Manage users, sessions, roles, database backups, and global runtime configuration.")).not.toBeInTheDocument();
    expect(screen.queryByText("Configure global login, session, terminal, file, SMTP, and email verification rules.")).not.toBeInTheDocument();
  });

  it("does not auto-load admin datasets while hidden by AppShell keepalive", async () => {
    renderAdminPage({ visible: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listAdminUsersMock).not.toHaveBeenCalled();
    expect(listAdminSessionsMock).not.toHaveBeenCalled();
    expect(listAdminRolesMock).not.toHaveBeenCalled();
    expect(getAdminGeneralSettingsMock).not.toHaveBeenCalled();
  });

  it("renders general settings as readonly summary cards by default", async () => {
    renderAdminPage();

    const accountCard = (await screen.findByText("Account and sessions")).closest(".admin-general-card");
    expect(accountCard).not.toBeNull();
    expect(within(accountCard as HTMLElement).getByText("Allow user registration")).toBeInTheDocument();
    expect(within(accountCard as HTMLElement).getByText("Enabled")).toBeInTheDocument();
    expect(within(accountCard as HTMLElement).getByText("120 minutes")).toBeInTheDocument();
    expect(within(accountCard as HTMLElement).getByText("168 hours")).toBeInTheDocument();
    expect(within(accountCard as HTMLElement).getByRole("button", { name: "Edit Account and sessions" })).toHaveClass("ui-icon-button");
    expect(within(accountCard as HTMLElement).queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.getAllByText("16 items").length).toBeGreaterThan(0);
    expect(screen.getByText("smtp.example.com")).toBeInTheDocument();
    expect(screen.getByText("noreply@example.com")).toBeInTheDocument();
    const smtpCard = screen.getByText("SMTP email").closest(".admin-general-card");
    expect(smtpCard).not.toBeNull();
    expect(within(smtpCard as HTMLElement).getByText("smtp-user")).toBeInTheDocument();
    expect(within(smtpCard as HTMLElement).getByText("SMTP password")).toBeInTheDocument();
    expect(within(smtpCard as HTMLElement).getByText("Configured")).toHaveClass("ui-badge-success");
    expect(within(smtpCard as HTMLElement).queryByText("Provided by backend environment variables")).not.toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("6 digits")).toBeInTheDocument();
    expect(screen.getByText("Email whitelist")).toBeInTheDocument();
    expect(screen.getByText("Email verification rules")).toBeInTheDocument();
    const llmCard = screen.getByText("AI command generation").closest(".admin-general-card");
    expect(llmCard).not.toBeNull();
    expect(within(llmCard as HTMLElement).getByText("OpenAI-compatible")).toBeInTheDocument();
    expect(within(llmCard as HTMLElement).getByText("mimo-v2.5-pro")).toBeInTheDocument();
    expect(within(llmCard as HTMLElement).getByTitle("https://llm.example.com/v1")).toHaveClass("admin-general-summary-single-line");
    expect(stylesCss).toMatch(/\.admin-general-summary-single-line\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/s);
    expect(within(llmCard as HTMLElement).getByText("Configured")).toBeInTheDocument();
    expect(within(llmCard as HTMLElement).getByRole("button", { name: "Edit AI command generation" })).toHaveClass("ui-icon-button");
    expect(within(llmCard as HTMLElement).queryByLabelText("API key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Session idle timeout")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
    expect(screen.queryByText("No unsaved changes")).not.toBeInTheDocument();
  });

  it("edits and saves one general settings card at a time", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const accountCard = (await screen.findByText("Account and sessions")).closest(".admin-general-card");
    expect(accountCard).not.toBeNull();
    const terminalCard = screen.getByText("Terminal and files").closest(".admin-general-card");
    expect(terminalCard).not.toBeNull();

    await user.click(within(accountCard as HTMLElement).getByRole("button", { name: "Edit Account and sessions" }));
    const editingAccountCard = screen.getByText("Account and sessions").closest(".admin-general-card");
    expect(editingAccountCard).not.toBeNull();
    const readonlyTerminalCard = screen.getByText("Terminal and files").closest(".admin-general-card");
    expect(readonlyTerminalCard).not.toBeNull();
    expect(editingAccountCard as HTMLElement).toHaveClass("admin-general-card-open");
    expect((editingAccountCard as HTMLElement).querySelector(".admin-general-card-body")).not.toBeNull();
    expect((editingAccountCard as HTMLElement).querySelector(".admin-general-account-edit-grid")?.children).toHaveLength(3);
    expect(within(editingAccountCard as HTMLElement).getByLabelText("Allow user registration")).toBeChecked();
    expect(within(editingAccountCard as HTMLElement).getByLabelText("Session idle timeout")).toHaveValue(120);
    expect(within(editingAccountCard as HTMLElement).getByRole("button", { name: "Cancel Account and sessions" })).toBeInTheDocument();
    expect(within(readonlyTerminalCard as HTMLElement).queryByLabelText("Terminal sessions per user")).not.toBeInTheDocument();
    expect(within(readonlyTerminalCard as HTMLElement).getByRole("button", { name: "Edit Terminal and files" })).toBeDisabled();

    await user.clear(within(editingAccountCard as HTMLElement).getByLabelText("Session idle timeout"));
    await user.type(within(editingAccountCard as HTMLElement).getByLabelText("Session idle timeout"), "90");
    await user.click(within(editingAccountCard as HTMLElement).getByRole("button", { name: "Save" }));

    expect(updateAdminGeneralSettingsMock).toHaveBeenCalledWith({
      ...adminGeneralSettings,
      session_idle_timeout_minutes: 90
    });
    expect(await screen.findByText("General settings saved.")).toBeInTheDocument();
    const savedAccountCard = screen.getByText("Account and sessions").closest(".admin-general-card");
    expect(savedAccountCard).not.toBeNull();
    expect(within(savedAccountCard as HTMLElement).queryByLabelText("Session idle timeout")).not.toBeInTheDocument();
    expect(within(savedAccountCard as HTMLElement).getByText("90 minutes")).toBeInTheDocument();
  });

  it("cancels a general settings card draft without changing the summary", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const terminalCard = (await screen.findByText("Terminal and files")).closest(".admin-general-card");
    expect(terminalCard).not.toBeNull();

    await user.click(within(terminalCard as HTMLElement).getByRole("button", { name: "Edit Terminal and files" }));
    const editingTerminalCard = screen.getByText("Terminal and files").closest(".admin-general-card");
    expect(editingTerminalCard).not.toBeNull();
    await user.clear(within(editingTerminalCard as HTMLElement).getByLabelText("Host connectivity poll interval"));
    await user.type(within(editingTerminalCard as HTMLElement).getByLabelText("Host connectivity poll interval"), "45");
    await user.click(within(editingTerminalCard as HTMLElement).getByRole("button", { name: "Cancel" }));

    expect(updateAdminGeneralSettingsMock).not.toHaveBeenCalled();
    const canceledTerminalCard = screen.getByText("Terminal and files").closest(".admin-general-card");
    expect(canceledTerminalCard).not.toBeNull();
    expect(within(canceledTerminalCard as HTMLElement).queryByLabelText("Host connectivity poll interval")).not.toBeInTheDocument();
    expect(within(canceledTerminalCard as HTMLElement).getByText("30 seconds")).toBeInTheDocument();
  });

  it("sends an SMTP test email from the general settings card", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const smtpCard = (await screen.findByText("SMTP email")).closest(".admin-general-card");
    expect(smtpCard).not.toBeNull();
    await user.type(within(smtpCard as HTMLElement).getByLabelText("Test email recipient"), "ops@example.com");
    await user.click(within(smtpCard as HTMLElement).getByRole("button", { name: "Send test email" }));

    expect(sendAdminGeneralSettingsTestEmailMock).toHaveBeenCalledWith("ops@example.com", expect.objectContaining({
      smtp_host: "smtp.example.com",
      smtp_port: 465,
      smtp_from: "noreply@example.com",
      smtp_from_name: "Online SSH",
      smtp_username: "smtp-user",
      smtp_use_ssl: true
    }));
    expect(sendAdminGeneralSettingsTestEmailMock.mock.lastCall?.[1]).not.toHaveProperty("smtp_password");
    expect(await screen.findByText("Test email sent.")).toBeInTheDocument();
  });

  it("tests SMTP email with the current unsaved SMTP draft", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const smtpCard = (await screen.findByText("SMTP email")).closest(".admin-general-card");
    expect(smtpCard).not.toBeNull();
    await user.click(within(smtpCard as HTMLElement).getByRole("button", { name: "Edit SMTP email" }));

    const editingSmtpCard = screen.getByText("SMTP email").closest(".admin-general-card");
    expect(editingSmtpCard).not.toBeNull();
    await user.clear(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP host"));
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP host"), "smtp.next.example.com");
    await user.clear(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP port"));
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP port"), "465");
    await user.clear(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP from"));
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP from"), "next@example.com");
    await user.clear(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP username"));
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP username"), "next-user");
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP password"), "next-secret");
    await user.click(within(editingSmtpCard as HTMLElement).getByLabelText("Use SSL"));
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("Test email recipient"), "ops@example.com");
    await user.click(within(editingSmtpCard as HTMLElement).getByRole("button", { name: "Send test email" }));

    expect(sendAdminGeneralSettingsTestEmailMock).toHaveBeenCalledWith("ops@example.com", expect.objectContaining({
      smtp_host: "smtp.next.example.com",
      smtp_port: 465,
      smtp_from: "next@example.com",
      smtp_username: "next-user",
      smtp_password: "next-secret",
      smtp_use_ssl: false
    }));
    expect(updateAdminGeneralSettingsMock).not.toHaveBeenCalled();
  });

  it("edits and tests the LLM command generation card without saving", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const llmCard = (await screen.findByText("AI command generation")).closest(".admin-general-card");
    expect(llmCard).not.toBeNull();
    await user.click(within(llmCard as HTMLElement).getByRole("button", { name: "Edit AI command generation" }));

    const editingLlmCard = screen.getByText("AI command generation").closest(".admin-general-card");
    expect(editingLlmCard).not.toBeNull();
    expect(within(editingLlmCard as HTMLElement).getByLabelText("Enable command generation")).toBeChecked();
    expect(within(editingLlmCard as HTMLElement).getByLabelText("API key")).toHaveValue("");
    const enabledToggle = within(editingLlmCard as HTMLElement)
      .getByLabelText("Enable command generation")
      .closest(".admin-general-llm-footer-toggle");
    expect(enabledToggle).not.toBeNull();
    expect((editingLlmCard as HTMLElement).querySelector(".admin-general-toggle-field")).toBeNull();
    const apiKeyField = within(editingLlmCard as HTMLElement)
      .getByLabelText("API key")
      .closest(".admin-general-llm-api-key-field");
    expect(apiKeyField).not.toBeNull();
    const apiKeyHelp = "Saved key will be kept when this is blank. Use clear to remove it.";
    expect(within(apiKeyField as HTMLElement).getByText(apiKeyHelp)).toHaveAttribute("title", apiKeyHelp);
    expect(stylesCss).toMatch(/\.admin-general-llm-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/s);
    expect(stylesCss).toMatch(/\.admin-general-llm-api-key-field\s*\{[^}]*grid-column:\s*span 2;/s);
    expect(stylesCss).toMatch(/\.admin-general-llm-api-key-description\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/s);

    await selectInputOption(user, within(editingLlmCard as HTMLElement).getByLabelText("Protocol"), "anthropic");
    await user.clear(within(editingLlmCard as HTMLElement).getByLabelText("Base URL"));
    await user.type(within(editingLlmCard as HTMLElement).getByLabelText("Base URL"), "https://llm.example.com/anthropic");
    await user.click(within(editingLlmCard as HTMLElement).getByLabelText("Enable command generation"));
    await user.click(within(editingLlmCard as HTMLElement).getByRole("button", { name: "Test connection" }));

    expect(testAdminGeneralSettingsLlmMock).toHaveBeenCalledWith(expect.objectContaining({
      llm_enabled: false,
      llm_protocol: "anthropic",
      llm_base_url: "https://llm.example.com/anthropic",
      llm_auth_header: "api_key",
      llm_model: "mimo-v2.5-pro",
      llm_timeout_seconds: 30,
      llm_max_tokens: 1024
    }));
    const llmTestPayload = testAdminGeneralSettingsLlmMock.mock.lastCall?.[0] ?? {};
    expect(llmTestPayload).not.toHaveProperty("allow_user_registration");
    expect(llmTestPayload).not.toHaveProperty("llm_api_key");
    expect(llmTestPayload).not.toHaveProperty("llm_api_key_configured");
    expect(llmTestPayload).not.toHaveProperty("llm_api_key_clear");
    expect(updateAdminGeneralSettingsMock).not.toHaveBeenCalled();
    expect(await screen.findByText("LLM connection test passed.")).toBeInTheDocument();
  });

  it("saves the LLM card with blank key retention and explicit clear", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const llmCard = (await screen.findByText("AI command generation")).closest(".admin-general-card");
    expect(llmCard).not.toBeNull();
    await user.click(within(llmCard as HTMLElement).getByRole("button", { name: "Edit AI command generation" }));
    const editingLlmCard = screen.getByText("AI command generation").closest(".admin-general-card");
    expect(editingLlmCard).not.toBeNull();

    await user.clear(within(editingLlmCard as HTMLElement).getByLabelText("Model"));
    await user.type(within(editingLlmCard as HTMLElement).getByLabelText("Model"), "mimo-v2.5-pro-latest");
    await user.click(within(editingLlmCard as HTMLElement).getByRole("button", { name: "Save" }));

    expect(updateAdminGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      llm_model: "mimo-v2.5-pro-latest",
      llm_api_key: ""
    }));
    expect(updateAdminGeneralSettingsMock.mock.lastCall?.[0]).not.toHaveProperty("llm_api_key_clear");

    await screen.findByText("General settings saved.");
    const savedCard = screen.getByText("AI command generation").closest(".admin-general-card");
    expect(savedCard).not.toBeNull();
    await user.click(within(savedCard as HTMLElement).getByRole("button", { name: "Edit AI command generation" }));
    const editingAgainCard = screen.getByText("AI command generation").closest(".admin-general-card");
    expect(editingAgainCard).not.toBeNull();
    await user.click(within(editingAgainCard as HTMLElement).getByRole("button", { name: "Clear saved key" }));
    await user.click(within(editingAgainCard as HTMLElement).getByRole("button", { name: "Save" }));

    expect(updateAdminGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      llm_api_key: "",
      llm_api_key_clear: true
    }));
  });

  it("keeps SMTP edit controls in one responsive grid row", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const smtpCard = (await screen.findByText("SMTP email")).closest(".admin-general-card");
    expect(smtpCard).not.toBeNull();
    await user.click(within(smtpCard as HTMLElement).getByRole("button", { name: "Edit SMTP email" }));

    const editingSmtpCard = screen.getByText("SMTP email").closest(".admin-general-card");
    expect(editingSmtpCard).not.toBeNull();
    const smtpGrid = (editingSmtpCard as HTMLElement).querySelector(".admin-general-smtp-grid");
    expect(smtpGrid).not.toBeNull();
    expect(smtpGrid?.children).toHaveLength(7);
    expect(smtpGrid).toContainElement(within(editingSmtpCard as HTMLElement).getByLabelText("Use SSL"));
    expect(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP username")).toHaveValue("smtp-user");
    expect(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP password")).toHaveValue("");
    const passwordToggle = within(editingSmtpCard as HTMLElement).getByRole("button", { name: "Show password" });
    expect(passwordToggle).toHaveClass("auth-password-toggle");
    expect(passwordToggle).toHaveTextContent("");
    expect(passwordToggle.querySelector(".lucide-eye")).not.toBeNull();
  });

  it("uses shared eye-icon controls for stored secret inputs", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const llmCard = (await screen.findByText("AI command generation")).closest(".admin-general-card");
    expect(llmCard).not.toBeNull();
    await user.click(within(llmCard as HTMLElement).getByRole("button", { name: "Edit AI command generation" }));

    const editingLlmCard = screen.getByText("AI command generation").closest(".admin-general-card");
    expect(editingLlmCard).not.toBeNull();
    const apiKeyInput = within(editingLlmCard as HTMLElement).getByLabelText("API key") as HTMLInputElement;
    const apiKeyToggle = within(editingLlmCard as HTMLElement).getByRole("button", { name: "Show password" });

    expect(apiKeyInput.type).toBe("password");
    expect(apiKeyToggle).toHaveClass("auth-password-toggle");
    expect(apiKeyToggle).toHaveTextContent("");
    expect(apiKeyToggle.querySelector(".lucide-eye")).not.toBeNull();

    await user.click(apiKeyToggle);

    expect(apiKeyInput.type).toBe("text");
    expect(within(editingLlmCard as HTMLElement).getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("saves SMTP username and password with blank retention and explicit clear", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    const smtpCard = (await screen.findByText("SMTP email")).closest(".admin-general-card");
    expect(smtpCard).not.toBeNull();
    await user.click(within(smtpCard as HTMLElement).getByRole("button", { name: "Edit SMTP email" }));
    const editingSmtpCard = screen.getByText("SMTP email").closest(".admin-general-card");
    expect(editingSmtpCard).not.toBeNull();

    await user.clear(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP username"));
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP username"), "smtp-next");
    await user.type(within(editingSmtpCard as HTMLElement).getByLabelText("SMTP password"), "smtp-next-secret");
    await user.click(within(editingSmtpCard as HTMLElement).getByRole("button", { name: "Save" }));

    expect(updateAdminGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      smtp_username: "smtp-next",
      smtp_password: "smtp-next-secret"
    }));
    expect(updateAdminGeneralSettingsMock.mock.lastCall?.[0]).not.toHaveProperty("smtp_password_clear");

    await screen.findByText("General settings saved.");
    const savedCard = screen.getByText("SMTP email").closest(".admin-general-card");
    expect(savedCard).not.toBeNull();
    await user.click(within(savedCard as HTMLElement).getByRole("button", { name: "Edit SMTP email" }));
    const editingAgainCard = screen.getByText("SMTP email").closest(".admin-general-card");
    expect(editingAgainCard).not.toBeNull();
    await user.click(within(editingAgainCard as HTMLElement).getByRole("button", { name: "Clear saved SMTP password" }));
    await user.click(within(editingAgainCard as HTMLElement).getByRole("button", { name: "Save" }));

    expect(updateAdminGeneralSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      smtp_password: "",
      smtp_password_clear: true
    }));
  });

  it("renders custom roles in the role management tab", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Roles" }));

    expect(await screen.findByText("Auditor")).toBeInTheDocument();
    const auditorCard = screen.getByText("Auditor").closest("article");
    expect(auditorCard).not.toBeNull();
    expect(within(auditorCard as HTMLElement).getByText("1 permissions")).toBeInTheDocument();
    expect(within(auditorCard as HTMLElement).getByText("Audit permissions 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create role" })).toBeInTheDocument();
  });

  it("renders user management as a searchable, filterable, paginated table", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Users" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("This section will later hold disable/enable and user status actions.")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "User / email" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status / sessions" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "2FA" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Created / last login" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Change role" })).not.toBeInTheDocument();
    const expectedUsersColumns =
      "minmax(190px, 1.25fr) minmax(118px, 0.7fr) minmax(108px, 0.62fr) minmax(82px, 0.46fr) minmax(176px, 0.95fr) minmax(178px, 0.82fr)";
    const usersHeaderRow = screen.getByRole("columnheader", { name: "Actions" }).closest("[role='row']");
    const adminUserRow = screen.getByText("Admin User").closest("[role='row']");
    expect(usersHeaderRow).toHaveStyle({ gridTemplateColumns: expectedUsersColumns });
    expect(adminUserRow).toHaveStyle({ gridTemplateColumns: expectedUsersColumns });
    expect(stylesCss).toMatch(/\.admin-users-table \.admin-table-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);

    await user.type(screen.getByRole("searchbox", { name: "Search users" }), "ops");
    expect(screen.getByText("Ops User")).toBeInTheDocument();
    expect(screen.queryByText("Disabled User")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search users" }));
    await selectInputOption(user, screen.getByRole("combobox", { name: "Status filter" }), "online");
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("Ops User")).toBeInTheDocument();
    expect(screen.queryByText("File User")).not.toBeInTheDocument();

    await selectInputOption(user, screen.getByRole("combobox", { name: "Status filter" }), "all");
    expect(screen.queryByText("Audit User")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Audit User")).toBeInTheDocument();
  });

  it("shows and resets a user MFA status", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Users" }));
    const opsRow = screen.getByText("Ops User").closest("[role='row']");
    expect(opsRow).not.toBeNull();
    expect(within(opsRow as HTMLElement).getByText("Enabled")).toBeInTheDocument();
    expect(within(opsRow as HTMLElement).getByRole("button", { name: "Reset 2FA" })).toHaveTextContent("");
    const securityAdminRow = screen.getByText("Security Admin").closest("[role='row']");
    expect(securityAdminRow).not.toBeNull();
    expect(within(securityAdminRow as HTMLElement).queryByRole("button", { name: "Reset 2FA" })).not.toBeInTheDocument();
    expect(within(securityAdminRow as HTMLElement).getByRole("button", { name: "Demote administrators before deleting them" })).toBeDisabled();

    await user.click(within(opsRow as HTMLElement).getByRole("button", { name: "Reset 2FA" }));
    await user.click(await screen.findByRole("button", { name: "Confirm reset" }));

    expect(resetAdminUserMfaMock).toHaveBeenCalledWith("user-2");
    expect(await screen.findByText("2FA reset.")).toBeInTheDocument();
  });

  it("derives session device labels from user agent when device labels are missing", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Sessions" }));

    const adminSession = await screen.findByLabelText("Session Admin User admin@example.com");
    expect(screen.queryByText("This section will later hold the session list and revoke actions.")).not.toBeInTheDocument();
    expect(adminSession.querySelector(".admin-session-grid")).not.toBeNull();
    expect(adminSession.querySelectorAll(".admin-session-cell")).toHaveLength(7);
    expect(adminSession.querySelector(".admin-row-title")).toBeNull();
    expect(adminSession.querySelector(".admin-row-meta")).toBeNull();
    expect(within(adminSession).getByText("User")).toBeInTheDocument();
    expect(within(adminSession).getByText("Role")).toBeInTheDocument();
    expect(within(adminSession).getByText("Admin User")).toBeInTheDocument();
    expect(within(adminSession).getByText("Admin")).toBeInTheDocument();
    expect(within(adminSession).queryByText("admin@example.com")).not.toBeInTheDocument();
    expect(within(adminSession).getByTitle(/Edg\/147\.0\.0\.0/)).toHaveTextContent("Edge on macOS");
    expect(within(adminSession).queryByText("Unknown device")).not.toBeInTheDocument();
    expect(within(adminSession).queryByRole("button", { name: "View User Agent" })).not.toBeInTheDocument();
    expect(within(adminSession).queryByText(/Mozilla\/5\.0/)).not.toBeInTheDocument();
    expect(within(adminSession).getByText("IP")).toBeInTheDocument();
    expect(within(adminSession).getByText("127.0.0.1")).toBeInTheDocument();
    expect(within(adminSession).getByText("Login method")).toBeInTheDocument();
    expect(within(adminSession).getByText("Password")).toBeInTheDocument();
    expect(within(adminSession).getByText("Last active")).toBeInTheDocument();
    expect(within(adminSession).getByText("Expires")).toBeInTheDocument();
    expect(stylesCss).toContain("grid-template-columns: minmax(120px, 0.9fr) minmax(82px, 0.52fr) minmax(140px, 0.9fr) minmax(92px, 0.56fr) minmax(104px, 0.62fr) minmax(96px, 0.62fr) minmax(150px, 0.95fr);");

    const opsSession = screen.getByLabelText("Session Ops User ops@example.com");
    expect(within(opsSession).getByTitle("CustomClient/1.0")).toHaveTextContent("Office laptop");
    expect(within(opsSession).queryByText("CustomClient/1.0")).not.toBeInTheDocument();
  });

  it("groups role permissions and keeps system roles protected", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Roles" }));

    expect(await screen.findByText("Operator")).toBeInTheDocument();
    expect(screen.queryByText("This section will later hold role changes and permission boundaries.")).not.toBeInTheDocument();
    const operatorCard = screen.getByText("Operator").closest("article");
    expect(operatorCard).not.toBeNull();
    expect(within(operatorCard as HTMLElement).getByText("operator")).toBeInTheDocument();
    expect(within(operatorCard as HTMLElement).getByText("4 permissions")).toBeInTheDocument();
    expect(within(operatorCard as HTMLElement).getByText("Resource permissions 3")).toBeInTheDocument();
    expect(within(operatorCard as HTMLElement).getByText("Terminal and transfers 1")).toBeInTheDocument();
    expect(within(operatorCard as HTMLElement).queryByText("Manage credentials")).not.toBeInTheDocument();
    expect(within(operatorCard as HTMLElement).getByRole("button", { name: "Role details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System roles cannot be deleted" })).toBeDisabled();
  });

  it("opens a readonly role details dialog with complete grouped permissions", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Roles" }));
    const operatorCard = (await screen.findByText("Operator")).closest("article");
    expect(operatorCard).not.toBeNull();
    await user.click(within(operatorCard as HTMLElement).getByRole("button", { name: "Role details" }));

    const dialog = await screen.findByRole("dialog", { name: "Role details" });
    expect(within(dialog).getByText("Operator")).toBeInTheDocument();
    expect(within(dialog).getByText("operator")).toBeInTheDocument();
    expect(within(dialog).getByText("Resource permissions")).toBeInTheDocument();
    expect(within(dialog).getByText("Manage credentials")).toBeInTheDocument();
    expect(within(dialog).getByText("credentials.manage")).toBeInTheDocument();
    expect(within(dialog).getByText("Allows creating, editing, and deleting credential resources.")).toBeInTheDocument();
    expect(within(dialog).getByText("Terminal and transfers")).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(2);
  });

  it("opens a grouped role editor dialog with fixed actions", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Roles" }));
    await user.click(await screen.findByRole("button", { name: "Create role" }));

    const dialog = await screen.findByRole("dialog", { name: "Create role" });
    expect(within(dialog).getByLabelText("Role key")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByText("Admin permissions")).toBeInTheDocument();
    expect(within(dialog).getByText("Resource permissions")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Select all Admin permissions" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Manage users/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Enable this role" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Enabled roles can be assigned and used in permission checks.")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create role" })).toBeInTheDocument();
  });

  it("exports and imports host, host group, and credential database JSON", async () => {
    const user = userEvent.setup();
    renderAdminPage();

    await user.click(await screen.findByRole("button", { name: "Database" }));

    expect(await screen.findByText("Host, host group, and credential backup")).toBeInTheDocument();
    expect(screen.queryByText("Export and import JSON backups for host groups, hosts, and credentials.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(exportAdminDatabaseMock).toHaveBeenCalledTimes(1);
    expect(saveBlobAsFileMock).toHaveBeenCalledTimes(1);
    expect(saveBlobAsFileMock.mock.calls[0][1]).toMatch(/^online-ssh-database-.*\.json$/);

    const file = new File([JSON.stringify({ schema_version: 1, host_groups: [], credentials: [], hosts: [] })], "backup.json", {
      type: "application/json"
    });
    await user.upload(screen.getByLabelText("Import JSON backup"), file);

    expect(importAdminDatabaseMock).toHaveBeenCalledWith(file);
    expect(await screen.findByText("Import completed: 1 host groups imported, 2 credentials imported, 3 hosts imported; 1 host groups skipped, 0 credentials skipped, 1 hosts skipped.")).toBeInTheDocument();
  });
});
