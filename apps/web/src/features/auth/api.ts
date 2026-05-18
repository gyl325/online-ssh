import { HttpError, isAuthInvalidatedError, request } from "../../shared/api/http";
import type { ApiErrorPayload } from "../../shared/api/types";
import type {
  AuthConfigResponse,
  AuthUserResponse,
  EmailCodeLoginInput,
  LoginResponse,
  LoginInput,
  RegisterInput,
  SendEmailVerificationCodeInput,
  VerifyMfaLoginInput
} from "./types";

type ErrorMessageTranslator = (key: string) => string;

const apiErrorMessageKeys: Record<string, string> = {
  ACCOUNT_DISABLED: "apiError.accountDisabled",
  BOOTSTRAP_SETUP_TOKEN_REQUIRED: "apiError.bootstrapSetupTokenRequired",
  EMAIL_ALREADY_EXISTS: "apiError.emailAlreadyExists",
  EMAIL_NOT_ALLOWED: "apiError.emailNotAllowed",
  EMAIL_SENDER_UNAVAILABLE: "apiError.emailSenderUnavailable",
  INVALID_CURRENT_PASSWORD: "apiError.invalidCurrentPassword",
  LAST_ADMIN_ACCESS: "apiError.lastAdminAccess",
  LLM_INVALID_RESPONSE: "apiError.llmInvalidResponse",
  LLM_NOT_CONFIGURED: "apiError.llmNotConfigured",
  LLM_PROVIDER_UNAVAILABLE: "apiError.llmProviderUnavailable",
  MFA_CODE_INVALID: "apiError.mfaCodeInvalid",
  MFA_RATE_LIMITED: "apiError.mfaRateLimited",
  PASSWORD_UNCHANGED: "apiError.passwordUnchanged",
  FORBIDDEN: "apiError.permissionRequired",
  REGISTRATION_DISABLED: "apiError.registrationDisabled",
  TERMINAL_SHARE_ACCESS_LIMIT: "apiError.terminalShareAccessLimit",
  TERMINAL_SHARE_NOT_AVAILABLE: "apiError.terminalShareNotAvailable",
  TERMINAL_SHARE_PASSWORD_INVALID: "apiError.terminalSharePasswordInvalid",
  USERNAME_ALREADY_EXISTS: "apiError.usernameAlreadyExists",
  VERIFICATION_CODE_INVALID: "apiError.verificationCodeInvalid",
  VERIFICATION_CODE_RATE_LIMITED: "apiError.verificationCodeRateLimited"
};

export async function register(input: RegisterInput) {
  return request<AuthUserResponse>({
    method: "POST",
    path: "/api/auth/register",
    body: input
  });
}

export function getAuthConfig() {
  return request<AuthConfigResponse>({
    path: "/api/auth/config"
  });
}

export async function login(input: LoginInput) {
  return request<LoginResponse>({
    method: "POST",
    path: "/api/auth/login",
    body: input,
    skipAuthRefresh: true
  });
}

export async function loginWithEmailCode(input: EmailCodeLoginInput) {
  return request<LoginResponse>({
    method: "POST",
    path: "/api/auth/login/email-code",
    body: input,
    skipAuthRefresh: true
  });
}

export async function verifyMfaLogin(input: VerifyMfaLoginInput) {
  return request<AuthUserResponse>({
    method: "POST",
    path: "/api/auth/2fa/verify",
    body: input,
    skipAuthRefresh: true
  });
}

export async function sendEmailVerificationCode(input: SendEmailVerificationCodeInput) {
  return request<{ sent: boolean }>({
    method: "POST",
    path: "/api/auth/email-code/send",
    body: input
  });
}

export async function logout() {
  return request<void>({
    method: "POST",
    path: "/api/auth/logout",
    skipAuthRefresh: true,
    responseType: "void"
  });
}

export async function refreshAuthSession() {
  return request<AuthUserResponse>({
    method: "POST",
    path: "/api/auth/refresh",
    skipAuthRefresh: true
  });
}

export function getCurrentUser(input?: { skipAuthRefresh?: boolean }) {
  return request<AuthUserResponse>({
    path: "/api/auth/me",
    skipAuthRefresh: input?.skipAuthRefresh
  });
}

function shouldUseFallbackForHttpError(error: HttpError) {
  const code = error.code.toUpperCase();
  const message = error.message.trim();

  if (!message) {
    return true;
  }

  if (error.status >= 500) {
    return true;
  }

  if (code === "FORBIDDEN" && /^(admin access required|forbidden|permission required)$/i.test(message)) {
    return false;
  }

  if (code === "BAD_REQUEST" || code === "UNAUTHORIZED" || code === "NOT_FOUND" || code.endsWith("_FAILED")) {
    return true;
  }

  return /^(invalid .* request|invalid request body|request failed|login required)$/i.test(message) ||
    /(?:^|\s)(failed|not found)$/i.test(message);
}

function localizedApiErrorMessage(error: HttpError, translate?: ErrorMessageTranslator) {
  if (!translate) {
    return null;
  }

  const code = error.code.toUpperCase();
  let key = apiErrorMessageKeys[code];
  if (!key && code === "UNAUTHORIZED") {
    const message = error.message.trim();
    if (/^invalid email, username, or verification code$/i.test(message)) {
      key = "apiError.invalidLoginIdentifier";
    } else if (/^invalid (email or (password|verification code)|email, username, or password)$/i.test(message)) {
      key = "apiError.invalidCredentials";
    }
  }
  if (!key) {
    return null;
  }

  const message = translate(key);
  return message === key ? null : message;
}

export function getApiErrorMessage(error: unknown, fallback: string, translate?: ErrorMessageTranslator) {
  if (isAuthInvalidatedError(error)) {
    return "";
  }

  if (error instanceof HttpError) {
    const localizedMessage = localizedApiErrorMessage(error, translate);
    if (localizedMessage) {
      return localizedMessage;
    }
    if (shouldUseFallbackForHttpError(error)) {
      return fallback;
    }
    return error.message || fallback;
  }

  const maybePayload = error as Partial<ApiErrorPayload> | undefined;
  if (maybePayload?.message) {
    return maybePayload.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
