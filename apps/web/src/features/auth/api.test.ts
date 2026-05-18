import { describe, expect, it } from "vitest";

import { HttpError } from "../../shared/api/http";
import { getApiErrorMessage, loginWithEmailCode, register, sendEmailVerificationCode, verifyMfaLogin } from "./api";

describe("getApiErrorMessage", () => {
  const t = (key: string) => ({
    "apiError.emailNotAllowed": "该邮箱不在允许注册范围内，请联系管理员确认白名单设置。",
    "apiError.emailAlreadyExists": "该邮箱已被使用。",
    "apiError.usernameAlreadyExists": "该用户名已被使用。",
    "apiError.invalidCredentials": "邮箱或密码不正确。",
    "apiError.invalidLoginIdentifier": "邮箱或用户名不存在，无法发送验证码。",
    "apiError.accountDisabled": "该账号已被禁用，请联系管理员。",
    "apiError.bootstrapSetupTokenRequired": "初始化令牌不正确。",
    "apiError.permissionRequired": "当前账号没有执行该操作的权限。",
    "apiError.invalidCurrentPassword": "当前密码不正确。",
    "apiError.verificationCodeInvalid": "验证码不正确或已过期。",
    "apiError.verificationCodeRateLimited": "验证码发送过于频繁，请稍后再试。",
    "apiError.mfaCodeInvalid": "验证码无效或已过期。",
    "apiError.mfaRateLimited": "验证次数过多，请稍后再试。",
    "apiError.registrationDisabled": "当前服务已关闭新用户注册。",
    "apiError.emailSenderUnavailable": "邮件服务暂不可用，请联系管理员检查 SMTP 配置。",
    "apiError.lastAdminAccess": "不能删除最后一个管理员账号。",
    "apiError.llmNotConfigured": "大模型命令生成尚未配置，请检查 Base URL、模型和 API key。",
    "apiError.llmProviderUnavailable": "大模型服务暂不可用，请检查网络、鉴权方式和服务端状态。",
    "apiError.llmInvalidResponse": "大模型返回内容无法解析，请检查协议、模型和提示词兼容性。"
  })[key] || key;

  it("uses the localized fallback for generic backend failures", () => {
    expect(
      getApiErrorMessage(
        new HttpError(500, { code: "TERMINAL_FAILED", message: "terminal request failed" }),
        "Terminal connection failed."
      )
    ).toBe("Terminal connection failed.");

    expect(
      getApiErrorMessage(
        new HttpError(400, { code: "BAD_REQUEST", message: "invalid file request" }),
        "Preview failed."
      )
    ).toBe("Preview failed.");
  });

  it("keeps actionable backend messages and local errors", () => {
    expect(
      getApiErrorMessage(
        new HttpError(409, { code: "EMAIL_ALREADY_EXISTS", message: "email already exists" }),
        "Register failed."
      )
    ).toBe("email already exists");

    expect(getApiErrorMessage(new Error("clipboard denied"), "Copy failed.")).toBe("clipboard denied");
  });

  it("maps common auth and account API error codes to localized friendly messages", () => {
    expect(
      getApiErrorMessage(
        new HttpError(403, { code: "EMAIL_NOT_ALLOWED", message: "email is not allowed" }),
        "Register failed.",
        t
      )
    ).toBe("该邮箱不在允许注册范围内，请联系管理员确认白名单设置。");

    expect(
      getApiErrorMessage(
        new HttpError(409, { code: "EMAIL_ALREADY_EXISTS", message: "email already exists" }),
        "Email failed.",
        t
      )
    ).toBe("该邮箱已被使用。");

    expect(
      getApiErrorMessage(
        new HttpError(409, { code: "USERNAME_ALREADY_EXISTS", message: "username already exists" }),
        "Register failed.",
        t
      )
    ).toBe("该用户名已被使用。");

    expect(
      getApiErrorMessage(
        new HttpError(401, { code: "INVALID_CURRENT_PASSWORD", message: "current password is incorrect" }),
        "Password failed.",
        t
      )
    ).toBe("当前密码不正确。");

    expect(
      getApiErrorMessage(
        new HttpError(429, { code: "VERIFICATION_CODE_RATE_LIMITED", message: "too many verification code requests" }),
        "Send failed.",
        t
      )
    ).toBe("验证码发送过于频繁，请稍后再试。");

    expect(
      getApiErrorMessage(
        new HttpError(401, { code: "MFA_CODE_INVALID", message: "verification code is invalid or expired" }),
        "Verify failed.",
        t
      )
    ).toBe("验证码无效或已过期。");

    expect(
      getApiErrorMessage(
        new HttpError(401, { code: "UNAUTHORIZED", message: "invalid email or password" }),
        "Login failed.",
        t
      )
    ).toBe("邮箱或密码不正确。");

    expect(
      getApiErrorMessage(
        new HttpError(401, { code: "UNAUTHORIZED", message: "invalid email, username, or verification code" }),
        "Send failed.",
        t
      )
    ).toBe("邮箱或用户名不存在，无法发送验证码。");

    expect(
      getApiErrorMessage(
        new HttpError(403, { code: "ACCOUNT_DISABLED", message: "account is disabled" }),
        "Login failed.",
        t
      )
    ).toBe("该账号已被禁用，请联系管理员。");

    expect(
      getApiErrorMessage(
        new HttpError(403, { code: "BOOTSTRAP_SETUP_TOKEN_REQUIRED", message: "bootstrap setup token required" }),
        "管理员创建失败。",
        t
      )
    ).toBe("初始化令牌不正确。");

    expect(
      getApiErrorMessage(
        new HttpError(403, { code: "FORBIDDEN", message: "permission required" }),
        "加载失败。",
        t
      )
    ).toBe("当前账号没有执行该操作的权限。");

    expect(
      getApiErrorMessage(
        new HttpError(502, { code: "LLM_PROVIDER_UNAVAILABLE", message: "llm provider is unavailable" }),
        "LLM test failed.",
        t
      )
    ).toBe("大模型服务暂不可用，请检查网络、鉴权方式和服务端状态。");
  });

  it("suppresses page-level fallback messages for invalidated auth sessions", () => {
    expect(
      getApiErrorMessage(
        new HttpError(401, { code: "AUTH_SESSION_REVOKED", message: "session revoked" }),
        "Failed to load host details."
      )
    ).toBe("");
  });

  it("keeps backend permission reasons when a legacy caller has no translator", () => {
    expect(
      getApiErrorMessage(
        new HttpError(403, { code: "FORBIDDEN", message: "permission required" }),
        "Failed to load credentials."
      )
    ).toBe("permission required");
  });

  it("exposes the email verification code endpoints", () => {
    expect(typeof sendEmailVerificationCode).toBe("function");
    expect(typeof loginWithEmailCode).toBe("function");
    expect(typeof register).toBe("function");
    expect(typeof verifyMfaLogin).toBe("function");
  });
});
