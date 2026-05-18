import type { AuthSession, AuthUser } from "../auth/types";

export type ChangeAccountPasswordInput = {
  current_password: string;
  new_password: string;
};

export type ChangeAccountPasswordResponse = {
  revoked_session_count: number;
};

export type AccountEmailCodeStage = "current" | "new";

export type SendAccountEmailCodeInput = {
  email?: string;
  stage: AccountEmailCodeStage;
};

export type ChangeAccountEmailInput = {
  current_email_code: string;
  new_email: string;
  new_email_code: string;
};

export type ChangeAccountEmailResponse = {
  session?: AuthSession;
  user: AuthUser;
};

export type DeleteAccountInput = {
  current_password: string;
};

export type MfaStatusResponse = {
  enabled: boolean;
  last_used_at?: string | null;
  confirmed_at?: string | null;
  recovery_code_count: number;
};

export type SetupMfaResponse = {
  otpauth_url: string;
  manual_secret: string;
  qr_code: string;
};

export type SetupMfaInput = {
  password: string;
};

export type ConfirmMfaSetupInput = {
  code: string;
};

export type MfaRecoveryCodesResponse = {
  enabled: boolean;
  recovery_codes: string[];
};

export type VerifyMfaWithPasswordInput = {
  password: string;
  code?: string;
  recovery_code?: string;
};
