import type { AuthUser } from "../auth/types";

export type AdminUser = AuthUser & {
  active_session_count: number;
  last_login_method?: string | null;
  mfa_enabled?: boolean;
};

export type AdminSession = {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string;
  user_role: string;
  client_ip?: string | null;
  user_agent?: string | null;
  device_label?: string | null;
  login_method: string;
  last_seen_at: string;
  expires_at: string;
  created_at: string;
};

export type AdminUsersResponse = {
  items: AdminUser[];
};

export type AdminSessionsResponse = {
  items: AdminSession[];
};

export type AdminPermissionDefinition = {
  key: string;
  label: string;
  description: string;
};

export type AdminRole = {
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  is_active: boolean;
  user_count: number;
  permissions: string[];
  created_at: string;
  updated_at: string;
};

export type AdminRolesResponse = {
  items: AdminRole[];
  permissions: AdminPermissionDefinition[];
};

export type AdminRoleResponse = {
  role: AdminRole;
};

export type AdminUserStatusResult = {
  user: AuthUser;
  revoked_session_count: number;
};

export type AdminUserRoleResponse = {
  user: AuthUser;
};

export type AdminRevokedSessionsResponse = {
  revoked_session_count: number;
};

export type AdminDeleteUserResponse = void;

export type AdminUserMfaStatus = {
  user_id: string;
  totp_enabled: boolean;
  confirmed_at?: string | null;
  last_used_at?: string | null;
  recovery_code_count: number;
};

export type AdminGeneralSettings = {
  allow_user_registration: boolean;
  session_idle_timeout_minutes: number;
  refresh_token_ttl_hours: number;
  terminal_max_sessions_per_user: number;
  terminal_max_sessions_total: number;
  terminal_keep_alive_hours: number;
  file_sftp_idle_ttl_minutes: number;
  host_connectivity_poll_interval_seconds: number;
  smtp_host: string;
  smtp_port: number;
  smtp_from: string;
  smtp_from_name: string;
  smtp_username: string;
  smtp_password?: string;
  smtp_password_configured?: boolean;
  smtp_use_ssl: boolean;
  auth_allowed_emails: string;
  auth_allowed_email_domains: string;
  auth_email_code_length: number;
  auth_email_code_ttl_minutes: number;
  auth_email_code_max_attempts: number;
  auth_email_code_resend_cooldown_seconds: number;
  auth_email_code_email_window_minutes: number;
  auth_email_code_email_window_max_sends: number;
  auth_email_code_ip_window_minutes: number;
  auth_email_code_ip_window_max_sends: number;
  llm_enabled: boolean;
  llm_protocol: "openai" | "anthropic";
  llm_base_url: string;
  llm_model: string;
  llm_auth_header: "api_key" | "bearer";
  llm_api_key?: string;
  llm_api_key_configured?: boolean;
  llm_timeout_seconds: number;
  llm_max_tokens: number;
};

export type AdminGeneralSettingsUpdate = AdminGeneralSettings & {
  llm_api_key_clear?: boolean;
  smtp_password_clear?: boolean;
};

export type AdminGeneralSettingsResponse = {
  settings: AdminGeneralSettings;
};

export type AdminGeneralSettingsTestEmailResponse = {
  sent: boolean;
};

export type AdminGeneralSettingsLlmTestResponse = {
  ok: boolean;
  model: string;
  protocol: "openai" | "anthropic";
};

export type AdminDatabaseImportResult = {
  host_groups_imported: number;
  host_groups_skipped: number;
  credentials_imported: number;
  credentials_skipped: number;
  hosts_imported: number;
  hosts_skipped: number;
};
