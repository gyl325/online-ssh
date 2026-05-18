import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserCenterPage } from "./UserCenterPage";
import { PreferencesProvider } from "../features/preferences/PreferencesContext";
import { ConfirmDialogProvider } from "../features/ui/ConfirmDialogContext";
import { ToastProvider } from "../features/ui/ToastContext";
import * as accountApi from "../features/account/api";
import { HttpError } from "../shared/api/http";
import { selectInputOption } from "../test/selectInput";
import stylesCss from "../styles.css?raw";

const authState = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  signOut: vi.fn(),
  user: {
    id: "user-1",
    email: "long.user@example.com",
    display_name: "demo-user",
    preferred_locale: "zh-CN",
    theme: "system",
    status: "active",
    role: "admin",
    auth_type: "password",
    permissions: ["admin.access"],
    created_at: "2026-05-01T00:00:00Z"
  },
  session: {
    id: "session-1",
    client_ip: "203.0.113.10",
    created_at: "2026-05-05T08:00:00Z",
    device_label: "Chrome on macOS",
    expires_at: "2026-05-05T10:00:00Z",
    last_seen_at: "2026-05-05T08:30:00Z",
    login_method: "email_code",
    user_agent: "Mozilla/5.0"
  }
}));

vi.mock("../features/auth/AuthContext", () => ({
  useAuth: () => ({
    bootError: null,
    isAuthenticated: true,
    refreshSession: authState.refreshSession,
    session: authState.session,
    signOut: authState.signOut,
    status: "authenticated",
    user: authState.user
  })
}));

vi.mock("../features/account/api", () => ({
  changeAccountEmail: vi.fn(),
  changeAccountPassword: vi.fn(),
  deleteAccount: vi.fn(),
  disableMfa: vi.fn(),
  getMfaStatus: vi.fn(),
  regenerateMfaRecoveryCodes: vi.fn(),
  setupMfa: vi.fn(),
  confirmMfaSetup: vi.fn(),
  sendAccountEmailCode: vi.fn()
}));

const changeAccountEmailMock = vi.mocked(accountApi.changeAccountEmail);
const changeAccountPasswordMock = vi.mocked(accountApi.changeAccountPassword);
const deleteAccountMock = vi.mocked(accountApi.deleteAccount);
const disableMfaMock = vi.mocked(accountApi.disableMfa);
const getMfaStatusMock = vi.mocked(accountApi.getMfaStatus);
const regenerateMfaRecoveryCodesMock = vi.mocked(accountApi.regenerateMfaRecoveryCodes);
const setupMfaMock = vi.mocked(accountApi.setupMfa);
const confirmMfaSetupMock = vi.mocked(accountApi.confirmMfaSetup);
const sendAccountEmailCodeMock = vi.mocked(accountApi.sendAccountEmailCode);

function renderPage() {
  return render(
    <PreferencesProvider>
      <ToastProvider>
        <ConfirmDialogProvider>
          <UserCenterPage />
        </ConfirmDialogProvider>
      </ToastProvider>
    </PreferencesProvider>
  );
}

describe("UserCenterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    changeAccountEmailMock.mockResolvedValue({ user: authState.user });
    changeAccountPasswordMock.mockResolvedValue({ revoked_session_count: 0 });
    deleteAccountMock.mockResolvedValue(undefined);
    disableMfaMock.mockResolvedValue(undefined);
    getMfaStatusMock.mockResolvedValue({ enabled: false, recovery_code_count: 0 });
    regenerateMfaRecoveryCodesMock.mockResolvedValue({ enabled: true, recovery_codes: ["ABCD-EFGH", "JKLM-NPQR"] });
    setupMfaMock.mockResolvedValue({
      otpauth_url: "otpauth://totp/OnlineSSH:user@example.com",
      manual_secret: "JBSWY3DPEHPK3PXP",
      qr_code: "data:image/png;base64,AAAA"
    });
    confirmMfaSetupMock.mockResolvedValue({ enabled: true, recovery_codes: ["ABCD-EFGH", "JKLM-NPQR"] });
    sendAccountEmailCodeMock.mockResolvedValue({ sent: true });
    authState.user.created_at = "2026-05-01T00:00:00Z";
    authState.session.last_seen_at = "2026-05-05T08:30:00Z";
    authState.session.expires_at = "2026-05-05T10:00:00Z";
  });

  it("renders account, appearance, and security tabs with current user information", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "用户中心" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "用户中心导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "账号" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "外观" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安全设置" })).toBeInTheDocument();
    expect(screen.getByText("demo-user")).toBeInTheDocument();
    expect(screen.getByText("long.user@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    const accountCard = screen.getByRole("heading", { name: "账号信息" }).closest(".user-center-card");
    expect(accountCard).not.toBeNull();
    expect(within(accountCard as HTMLElement).queryByText("角色")).not.toBeInTheDocument();
    expect(within(accountCard as HTMLElement).getAllByRole("term")).toHaveLength(5);
  });

  it("shows current session device, ip, and login method on the account tab", () => {
    renderPage();

    expect(screen.getByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("邮箱验证码")).toBeInTheDocument();
  });

  it("keeps invalid account and session dates visible", () => {
    authState.user.created_at = "not-a-date";
    authState.session.last_seen_at = "still-not-a-date";
    authState.session.expires_at = "bad-expiry";

    renderPage();

    const accountCard = screen.getByRole("heading", { name: "账号信息" }).closest(".user-center-card");
    const sessionCard = screen.getByRole("heading", { name: "当前会话" }).closest(".user-center-card");
    expect(accountCard).not.toBeNull();
    expect(sessionCard).not.toBeNull();
    expect(within(accountCard as HTMLElement).getByText("not-a-date")).toBeInTheDocument();
    expect(within(sessionCard as HTMLElement).getByText("still-not-a-date")).toBeInTheDocument();
    expect(within(sessionCard as HTMLElement).getByText("bad-expiry")).toBeInTheDocument();
  });

  it("updates terminal font size from the appearance tab", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "外观" }));
    const fontInput = screen.getByRole("spinbutton", { name: "终端字体大小" });

    fireEvent.change(fontInput, { target: { value: "16" } });

    expect(window.localStorage.getItem("online-ssh-terminal-font-size")).toBe("16");
  });

  it("updates terminal theme and reflects it in the preview", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "外观" }));
    const previewPanel = screen.getByText("示例终端").closest(".user-center-terminal-preview-panel");
    expect(previewPanel).not.toBeNull();
    const sampleTerminalTitle = within(previewPanel as HTMLElement).getByText("示例终端");
    const terminalPreview = within(previewPanel as HTMLElement).getByLabelText("终端预览");
    const terminalViewNote = screen.getByText("终端字体大小、主题和关键词高亮会实时应用到示例终端、当前终端和历史回放。");
    expect(sampleTerminalTitle.compareDocumentPosition(terminalPreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(terminalPreview.compareDocumentPosition(terminalViewNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(terminalViewNote.closest(".user-center-terminal-preview-panel")).toBe(previewPanel);
    expect(screen.queryByText("会影响当前终端和终端历史回放。")).not.toBeInTheDocument();
    expect(screen.queryByText("成熟生态主题会实时应用到示例终端、当前终端和历史回放。")).not.toBeInTheDocument();
    await selectInputOption(user, screen.getByRole("combobox", { name: "终端主题方案" }), "dracula");

    expect(window.localStorage.getItem("online-ssh-terminal-theme")).toBe("dracula");
    expect(screen.getByLabelText("终端预览")).toHaveStyle({
      backgroundColor: "#1e1f29",
      color: "#f8f8f2"
    });
  });

  it("manages terminal keyword highlight settings from the appearance tab", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "外观" }));
    const highlightToggle = screen.getByRole("checkbox", { name: "启用关键词高亮" });
    expect(highlightToggle).toBeChecked();
    const configureHighlightButton = screen.getByRole("button", { name: "配置规则" });
    expect(configureHighlightButton).toHaveClass("ui-icon-button");
    expect(configureHighlightButton.closest(".user-center-highlight-preference")).toHaveClass("user-center-highlight-preference");
    expect(screen.queryByText("配置规则")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Error 背景色")).not.toBeInTheDocument();
    expect(screen.getByText("error")).toHaveStyle({ backgroundColor: "transparent" });
    expect(screen.getByText("192.168.1.20")).toHaveStyle({ backgroundColor: "transparent" });

    await user.click(highlightToggle);
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      version: 1,
      enabled: false
    });
    expect(screen.queryByText("error")).not.toBeInTheDocument();

    await user.click(configureHighlightButton);
    const rulesDialog = screen.getByRole("dialog", { name: "关键词高亮规则" });
    expect(within(rulesDialog).getByText("error, failed, exception, fatal, denied, refused")).toHaveAttribute(
      "title",
      "error, failed, exception, fatal, denied, refused"
    );
    const errorBackground = screen.getByLabelText("Error 背景色");
    expect(within(rulesDialog).getByRole("button", { name: "Error 背景色设为透明" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(errorBackground, { target: { value: "#4c0519" } });
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      builtinRules: {
        error: {
          backgroundColor: "#4c0519"
        }
      }
    });
    await user.click(within(rulesDialog).getByRole("button", { name: "Error 背景色设为透明" }));
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      builtinRules: {
        error: {
          backgroundColor: "transparent"
        }
      }
    });

    const addHighlightRuleButton = within(rulesDialog).getByRole("button", { name: "新增高亮规则" });
    expect(addHighlightRuleButton).toHaveClass("user-center-highlight-add-rule-button");
    await user.click(addHighlightRuleButton);
    const highlightRuleForm = within(rulesDialog).getByRole("group", { name: "高亮规则表单" });
    const primaryFields = screen.getByLabelText("规则名称").closest(".user-center-highlight-primary-fields");
    expect(primaryFields).not.toBeNull();
    expect(within(primaryFields as HTMLElement).getByRole("combobox", { name: "匹配类型" })).toBeInTheDocument();
    expect(within(primaryFields as HTMLElement).getByLabelText("匹配内容")).toBeInTheDocument();
    expect(within(primaryFields as HTMLElement).getByLabelText("规则优先级")).toBeInTheDocument();
    expect(within(highlightRuleForm).getByRole("button", { name: "背景色设为透明" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("规则名称"), "Trace ID");
    await selectInputOption(user, within(rulesDialog).getByRole("combobox", { name: "匹配类型" }), "regex");
    fireEvent.change(screen.getByLabelText("匹配内容"), { target: { value: "trace-[0-9]+" } });
    fireEvent.change(screen.getByLabelText("规则优先级"), { target: { value: "55" } });
    await user.click(within(rulesDialog).getByRole("button", { name: "保存规则" }));

    expect(screen.getByText("Trace ID")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      customRules: [
        {
          name: "Trace ID",
          matchType: "regex",
          pattern: "trace-[0-9]+",
          backgroundColor: "transparent",
          priority: 55
        }
      ]
    });

    await user.click(within(rulesDialog).getByRole("button", { name: "删除 Trace ID" }));
    expect(screen.queryByText("Trace ID")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("online-ssh-terminal-highlighting") || "{}")).toMatchObject({
      customRules: []
    });
  });

  it("submits password changes after validating confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const passwordSection = screen.getByRole("region", { name: "修改密码" });

    expect(within(passwordSection).getByText("验证当前密码")).toBeInTheDocument();
    expect(within(passwordSection).getByText("设置新密码")).toBeInTheDocument();
    await user.type(within(passwordSection).getByLabelText("当前密码"), "current-pass");
    await user.click(within(passwordSection).getByRole("button", { name: "下一步" }));
    await user.type(within(passwordSection).getByLabelText("新密码"), "next-password");
    await user.type(within(passwordSection).getByLabelText("确认新密码"), "next-password");
    await user.click(within(passwordSection).getByRole("button", { name: "保存密码" }));

    await waitFor(() =>
      expect(changeAccountPasswordMock).toHaveBeenCalledWith({
        current_password: "current-pass",
        new_password: "next-password"
      })
    );
  });

  it("enables MFA from the security tab and requires saving recovery codes", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const mfaSection = await screen.findByRole("region", { name: "双因素认证" });
    expect(within(mfaSection).getByText("未启用")).toBeInTheDocument();

    await user.click(within(mfaSection).getByRole("button", { name: "启用 2FA" }));
    const dialog = await screen.findByRole("dialog", { name: "启用双因素认证" });
    expect(within(dialog).getByText("密码验证")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("当前密码"), "current-pass");
    await user.click(within(dialog).getByRole("button", { name: "继续" }));

    await waitFor(() => expect(setupMfaMock).toHaveBeenCalledWith({ password: "current-pass" }));
    expect(await within(dialog).findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "复制密钥" })).toBeInTheDocument();
    expect(stylesCss).toMatch(
      /\.user-center-mfa-copy-row\s*\{[^}]*display:\s*inline-flex;[^}]*justify-content:\s*center;[^}]*width:\s*fit-content;/s
    );
    await user.click(within(dialog).getByRole("button", { name: "下一步" }));

    const codeField = within(dialog).getByText("验证码").closest(".auth-code-field");
    expect(codeField).not.toBeNull();
    expect(codeField).toContainElement(within(dialog).getByLabelText("验证码第 1"));
    const codeDigits = within(dialog).getAllByLabelText(/验证码第/);
    await user.type(codeDigits[0], "123456");
    await user.click(within(dialog).getByRole("button", { name: "确认启用" }));

    expect(await within(dialog).findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "复制恢复码" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "我已保存恢复码" })).toBeInTheDocument();
  });

  it("keeps the MFA setup dialog open when password verification fails", async () => {
    setupMfaMock.mockRejectedValueOnce(
      new HttpError(401, { code: "INVALID_CURRENT_PASSWORD", message: "current password is incorrect" })
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const mfaSection = await screen.findByRole("region", { name: "双因素认证" });
    await user.click(within(mfaSection).getByRole("button", { name: "启用 2FA" }));
    const dialog = await screen.findByRole("dialog", { name: "启用双因素认证" });
    await user.type(within(dialog).getByLabelText("当前密码"), "wrong-pass");
    await user.click(within(dialog).getByRole("button", { name: "继续" }));

    expect(await screen.findByText("当前密码不正确。")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "启用双因素认证" })).toBeInTheDocument();
    expect(authState.signOut).not.toHaveBeenCalled();
  });

  it("moves enabled MFA verification into dedicated action dialogs", async () => {
    getMfaStatusMock.mockResolvedValue({
      enabled: true,
      recovery_code_count: 8,
      last_used_at: null,
      confirmed_at: "2026-05-08T08:00:00Z"
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const mfaSection = await screen.findByRole("region", { name: "双因素认证" });
    expect(within(mfaSection).getByText("尚未使用")).toBeInTheDocument();
    expect(within(mfaSection).getByText("8 个可用")).toBeInTheDocument();
    expect(within(mfaSection).queryByLabelText("当前密码")).not.toBeInTheDocument();
    expect(within(mfaSection).queryByLabelText("恢复码")).not.toBeInTheDocument();

    await user.click(within(mfaSection).getByRole("button", { name: "重新生成恢复码" }));
    const regenerateDialog = await screen.findByRole("dialog", { name: "重新生成恢复码" });
    await user.type(within(regenerateDialog).getByLabelText("当前密码"), "current-pass");
    const codeDigits = within(regenerateDialog).getAllByLabelText(/验证码第/);
    await user.type(codeDigits[0], "123456");
    await user.click(within(regenerateDialog).getByRole("button", { name: "重新生成恢复码" }));

    await waitFor(() =>
      expect(regenerateMfaRecoveryCodesMock).toHaveBeenCalledWith({
        password: "current-pass",
        code: "123456"
      })
    );
    const recoveryDialog = await screen.findByRole("dialog", { name: "恢复码" });
    expect(recoveryDialog).toBeInTheDocument();
    expect(within(recoveryDialog).queryByText("密码验证")).not.toBeInTheDocument();
    expect(within(recoveryDialog).queryByText("显示信息")).not.toBeInTheDocument();
    expect(within(recoveryDialog).queryByText("输入验证码")).not.toBeInTheDocument();
  });

  it("uses the first recovery code when a saved recovery code list is pasted", async () => {
    getMfaStatusMock.mockResolvedValue({
      enabled: true,
      recovery_code_count: 8,
      last_used_at: null,
      confirmed_at: "2026-05-08T08:00:00Z"
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const mfaSection = await screen.findByRole("region", { name: "双因素认证" });
    await user.click(within(mfaSection).getByRole("button", { name: "关闭 2FA" }));
    const disableDialog = await screen.findByRole("dialog", { name: "关闭 2FA" });
    await user.type(within(disableDialog).getByLabelText("当前密码"), "current-pass");
    await user.click(within(disableDialog).getByRole("button", { name: "恢复码" }));
    fireEvent.change(within(disableDialog).getByLabelText("恢复码"), {
      target: { value: "ABCD-EFGH\nJKLM-NPQR\nSTUV-WXYZ" }
    });
    await user.click(within(disableDialog).getByRole("button", { name: "关闭 2FA" }));

    await waitFor(() =>
      expect(disableMfaMock).toHaveBeenCalledWith({
        password: "current-pass",
        recovery_code: "ABCD-EFGH"
      })
    );
  });

  it("rejects saving a password that matches the current password", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const passwordSection = screen.getByRole("region", { name: "修改密码" });

    await user.type(within(passwordSection).getByLabelText("当前密码"), "same-password");
    await user.click(within(passwordSection).getByRole("button", { name: "下一步" }));
    await user.type(within(passwordSection).getByLabelText("新密码"), "same-password");
    await user.type(within(passwordSection).getByLabelText("确认新密码"), "same-password");
    await user.click(within(passwordSection).getByRole("button", { name: "保存密码" }));

    expect(await screen.findByText("新密码不能与当前密码相同。")).toBeInTheDocument();
    expect(changeAccountPasswordMock).not.toHaveBeenCalled();
  });

  it("localizes account security API errors instead of showing backend text", async () => {
    changeAccountPasswordMock.mockRejectedValueOnce(
      new HttpError(401, { code: "INVALID_CURRENT_PASSWORD", message: "current password is incorrect" })
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const passwordSection = screen.getByRole("region", { name: "修改密码" });

    await user.type(within(passwordSection).getByLabelText("当前密码"), "wrong-pass");
    await user.click(within(passwordSection).getByRole("button", { name: "下一步" }));
    await user.type(within(passwordSection).getByLabelText("新密码"), "next-password");
    await user.type(within(passwordSection).getByLabelText("确认新密码"), "next-password");
    await user.click(within(passwordSection).getByRole("button", { name: "保存密码" }));

    expect(await screen.findByText("当前密码不正确。")).toBeInTheDocument();
    expect(screen.queryByText("current password is incorrect")).not.toBeInTheDocument();
  });

  it("changes email through current and new email verification codes", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "安全设置" }));
    const emailSection = screen.getByRole("region", { name: "修改邮箱" });

    expect(within(emailSection).getByText("验证旧邮箱")).toBeInTheDocument();
    expect(within(emailSection).getByText("验证新邮箱")).toBeInTheDocument();
    await user.click(within(emailSection).getByRole("button", { name: "发送旧邮箱验证码" }));
    await user.type(within(emailSection).getByLabelText("旧邮箱验证码"), "111111");
    await user.click(within(emailSection).getByRole("button", { name: "下一步" }));
    await user.type(within(emailSection).getByLabelText("新邮箱"), "new@example.com");
    await user.click(within(emailSection).getByRole("button", { name: "发送新邮箱验证码" }));
    await user.type(within(emailSection).getByLabelText("新邮箱验证码"), "222222");
    await user.click(within(emailSection).getByRole("button", { name: "换绑邮箱" }));

    expect(sendAccountEmailCodeMock).toHaveBeenNthCalledWith(1, { stage: "current" });
    expect(sendAccountEmailCodeMock).toHaveBeenNthCalledWith(2, { email: "new@example.com", stage: "new" });
    await waitFor(() =>
      expect(changeAccountEmailMock).toHaveBeenCalledWith({
        current_email_code: "111111",
        new_email: "new@example.com",
        new_email_code: "222222"
      })
    );
    expect(authState.refreshSession).toHaveBeenCalled();
  });

  it("keeps account deletion disabled until the current password is entered", async () => {
    const user = userEvent.setup();
    renderPage();

    const deleteForm = screen.getByRole("form", { name: "删除账号" });
    const deleteButton = within(deleteForm).getByRole("button", { name: "删除账号" });

    expect(deleteButton).toBeDisabled();

    await user.type(within(deleteForm).getByLabelText("当前密码"), "current-pass");

    expect(deleteButton).toBeEnabled();
  });
});
