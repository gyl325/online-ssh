export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  preferred_locale: string;
  theme: string;
  status: string;
  role: string;
  auth_type: string;
  permissions: string[];
  last_login_at?: string | null;
  created_at: string;
};

export type AuthSession = {
  id: string;
  client_ip?: string | null;
  user_agent?: string | null;
  device_label?: string | null;
  login_method: "password" | "email_code" | string;
  last_seen_at: string;
  expires_at: string;
  created_at: string;
};

export type AuthUserResponse = {
  user: AuthUser;
  session?: AuthSession;
};

export type MfaRequiredLoginResponse = {
  status: "mfa_required";
  mfa_token: string;
  methods: Array<"totp" | "recovery_code" | string>;
  expires_at: string;
};

export type LoginResponse = AuthUserResponse | MfaRequiredLoginResponse;

export type AuthConfigResponse = {
  allow_registration: boolean;
  host_connectivity_poll_interval_seconds?: number;
  email_code_length?: number;
};

export type LoginInput = {
  identifier: string;
  password: string;
};

export type EmailCodeLoginInput = {
  identifier: string;
  verification_code: string;
};

export type VerifyMfaLoginInput = {
  mfa_token: string;
  code?: string;
  recovery_code?: string;
};

export type EmailVerificationPurpose = "register" | "login";

export type SendEmailVerificationCodeInput = {
  email: string;
  purpose: "register";
} | {
  identifier: string;
  purpose: "login";
};

export type RegisterInput = {
  email: string;
  password: string;
  password_confirm: string;
  display_name: string;
  verification_code: string;
};
