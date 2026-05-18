import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import {
  Ban,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  Download,
  Edit3,
  FileUp,
  Info,
  LogOut,
  RefreshCw,
  Send,
  Shield,
  SquareAsterisk,
  Sparkles,
  Trash2,
  Users
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { useAuth } from "../features/auth/AuthContext";
import { getApiErrorMessage } from "../features/auth/api";
import {
  createAdminRole,
  deleteAdminRole,
  deleteAdminUser,
  exportAdminDatabase,
  getAdminGeneralSettings,
  importAdminDatabase,
  listAdminRoles,
  listAdminSessions,
  listAdminUsers,
  revokeAdminSession,
  revokeAdminUserSessions,
  resetAdminUserMfa,
  sendAdminGeneralSettingsTestEmail,
  testAdminGeneralSettingsLlm,
  updateAdminGeneralSettings,
  updateAdminRole,
  updateAdminUserRole,
  updateAdminUserStatus
} from "../features/admin/api";
import type { AdminGeneralSettings, AdminGeneralSettingsUpdate, AdminPermissionDefinition, AdminRole, AdminSession, AdminUser } from "../features/admin/types";
import { parseUserAgent } from "../features/admin/userAgent";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useConfirmDialog } from "../features/ui/ConfirmDialogContext";
import { useToast } from "../features/ui/ToastContext";
import { formatDateTime } from "../shared/lib/date";
import { saveBlobAsFile } from "../shared/lib/download";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  Pagination,
  PasswordInput,
  SelectInput,
  SegmentedControl,
  TextareaInput,
  TextInput,
  Tooltip
} from "../shared/ui";

type AdminTabKey = "general" | "users" | "sessions" | "roles" | "database";
type RoleDialogMode = "create" | "edit";
type UserStatusFilter = "all" | "active" | "disabled" | "online";
type GeneralSectionKey = "account" | "terminalFiles" | "llm" | "smtp" | "whitelist" | "emailCode";

const adminTabs: Array<{ key: AdminTabKey; icon: ReactNode; labelKey: string }> = [
  { key: "general", icon: <Shield aria-hidden="true" />, labelKey: "admin.tabs.general" },
  { key: "users", icon: <Users aria-hidden="true" />, labelKey: "admin.tabs.users" },
  { key: "sessions", icon: <Clock3 aria-hidden="true" />, labelKey: "admin.tabs.sessions" },
  { key: "roles", icon: <SquareAsterisk aria-hidden="true" />, labelKey: "admin.tabs.roles" },
  { key: "database", icon: <Shield aria-hidden="true" />, labelKey: "admin.tabs.database" }
];

const userPageSizeOptions = [5, 10, 20];

const defaultGeneralSettings: AdminGeneralSettings = {
  allow_user_registration: true,
  session_idle_timeout_minutes: 120,
  refresh_token_ttl_hours: 168,
  terminal_max_sessions_per_user: 16,
  terminal_max_sessions_total: 16,
  terminal_keep_alive_hours: 24,
  file_sftp_idle_ttl_minutes: 5,
  host_connectivity_poll_interval_seconds: 30,
  smtp_host: "",
  smtp_port: 587,
  smtp_from: "",
  smtp_from_name: "Online SSH",
  smtp_username: "",
  smtp_password: "",
  smtp_password_configured: false,
  smtp_use_ssl: false,
  auth_allowed_emails: "",
  auth_allowed_email_domains: "",
  auth_email_code_length: 6,
  auth_email_code_ttl_minutes: 5,
  auth_email_code_max_attempts: 5,
  auth_email_code_resend_cooldown_seconds: 60,
  auth_email_code_email_window_minutes: 15,
  auth_email_code_email_window_max_sends: 5,
  auth_email_code_ip_window_minutes: 15,
  auth_email_code_ip_window_max_sends: 10,
  llm_enabled: false,
  llm_protocol: "openai",
  llm_base_url: "",
  llm_model: "mimo-v2.5-pro",
  llm_auth_header: "api_key",
  llm_api_key: "",
  llm_api_key_configured: false,
  llm_timeout_seconds: 30,
  llm_max_tokens: 1024
};

type GeneralNumberField = {
  key: keyof AdminGeneralSettings;
  labelKey: string;
  max: number;
  min: number;
  unitKey: string;
};

const generalNumberFields: Record<string, GeneralNumberField> = {
  sessionIdleTimeout: {
    key: "session_idle_timeout_minutes",
    labelKey: "admin.general.fields.sessionIdleTimeout",
    min: 5,
    max: 1440,
    unitKey: "admin.general.units.minutes"
  },
  refreshTokenTTL: {
    key: "refresh_token_ttl_hours",
    labelKey: "admin.general.fields.refreshTokenTTL",
    min: 1,
    max: 720,
    unitKey: "admin.general.units.hours"
  },
  terminalMaxSessionsPerUser: {
    key: "terminal_max_sessions_per_user",
    labelKey: "admin.general.fields.terminalMaxSessionsPerUser",
    min: 1,
    max: 20,
    unitKey: "admin.general.units.items"
  },
  terminalMaxSessionsTotal: {
    key: "terminal_max_sessions_total",
    labelKey: "admin.general.fields.terminalMaxSessionsTotal",
    min: 1,
    max: 200,
    unitKey: "admin.general.units.items"
  },
  terminalKeepAlive: {
    key: "terminal_keep_alive_hours",
    labelKey: "admin.general.fields.terminalKeepAlive",
    min: 1,
    max: 72,
    unitKey: "admin.general.units.hours"
  },
  fileSFTPIdleTTL: {
    key: "file_sftp_idle_ttl_minutes",
    labelKey: "admin.general.fields.fileSFTPIdleTTL",
    min: 1,
    max: 60,
    unitKey: "admin.general.units.minutes"
  },
  hostConnectivityPollInterval: {
    key: "host_connectivity_poll_interval_seconds",
    labelKey: "admin.general.fields.hostConnectivityPollInterval",
    min: 10,
    max: 3600,
    unitKey: "admin.general.units.seconds"
  },
  llmTimeout: {
    key: "llm_timeout_seconds",
    labelKey: "admin.general.fields.llmTimeout",
    min: 5,
    max: 120,
    unitKey: "admin.general.units.seconds"
  },
  llmMaxTokens: {
    key: "llm_max_tokens",
    labelKey: "admin.general.fields.llmMaxTokens",
    min: 256,
    max: 4096,
    unitKey: "admin.general.units.tokens"
  },
  authEmailCodeLength: {
    key: "auth_email_code_length",
    labelKey: "admin.general.fields.authEmailCodeLength",
    min: 4,
    max: 8,
    unitKey: "admin.general.units.digits"
  },
  authEmailCodeTTL: {
    key: "auth_email_code_ttl_minutes",
    labelKey: "admin.general.fields.authEmailCodeTTL",
    min: 1,
    max: 30,
    unitKey: "admin.general.units.minutes"
  },
  authEmailCodeMaxAttempts: {
    key: "auth_email_code_max_attempts",
    labelKey: "admin.general.fields.authEmailCodeMaxAttempts",
    min: 1,
    max: 10,
    unitKey: "admin.general.units.attempts"
  },
  authEmailCodeResendCooldown: {
    key: "auth_email_code_resend_cooldown_seconds",
    labelKey: "admin.general.fields.authEmailCodeResendCooldown",
    min: 30,
    max: 300,
    unitKey: "admin.general.units.seconds"
  },
  authEmailCodeEmailWindow: {
    key: "auth_email_code_email_window_minutes",
    labelKey: "admin.general.fields.authEmailCodeEmailWindow",
    min: 1,
    max: 60,
    unitKey: "admin.general.units.minutes"
  },
  authEmailCodeEmailWindowMaxSends: {
    key: "auth_email_code_email_window_max_sends",
    labelKey: "admin.general.fields.authEmailCodeEmailWindowMaxSends",
    min: 1,
    max: 100,
    unitKey: "admin.general.units.times"
  },
  authEmailCodeIPWindow: {
    key: "auth_email_code_ip_window_minutes",
    labelKey: "admin.general.fields.authEmailCodeIPWindow",
    min: 1,
    max: 60,
    unitKey: "admin.general.units.minutes"
  },
  authEmailCodeIPWindowMaxSends: {
    key: "auth_email_code_ip_window_max_sends",
    labelKey: "admin.general.fields.authEmailCodeIPWindowMaxSends",
    min: 1,
    max: 100,
    unitKey: "admin.general.units.times"
  }
};

const allGeneralNumberFields = Object.values(generalNumberFields);
const accountGeneralFields = [generalNumberFields.sessionIdleTimeout, generalNumberFields.refreshTokenTTL];
const terminalFileGeneralFields = [
  generalNumberFields.terminalMaxSessionsPerUser,
  generalNumberFields.terminalMaxSessionsTotal,
  generalNumberFields.terminalKeepAlive,
  generalNumberFields.fileSFTPIdleTTL,
  generalNumberFields.hostConnectivityPollInterval
];
const emailCodeBaseGeneralFields = [
  generalNumberFields.authEmailCodeLength,
  generalNumberFields.authEmailCodeTTL,
  generalNumberFields.authEmailCodeMaxAttempts,
  generalNumberFields.authEmailCodeResendCooldown
];
const emailCodeRateGeneralFields = [
  generalNumberFields.authEmailCodeEmailWindow,
  generalNumberFields.authEmailCodeEmailWindowMaxSends,
  generalNumberFields.authEmailCodeIPWindow,
  generalNumberFields.authEmailCodeIPWindowMaxSends
];
const llmGeneralFields = [generalNumberFields.llmTimeout, generalNumberFields.llmMaxTokens];

const generalSectionFields: Record<GeneralSectionKey, Array<keyof AdminGeneralSettings>> = {
  account: ["allow_user_registration", "session_idle_timeout_minutes", "refresh_token_ttl_hours"],
  terminalFiles: [
    "terminal_max_sessions_per_user",
    "terminal_max_sessions_total",
    "terminal_keep_alive_hours",
    "file_sftp_idle_ttl_minutes",
    "host_connectivity_poll_interval_seconds"
  ],
  smtp: ["smtp_host", "smtp_port", "smtp_from", "smtp_from_name", "smtp_username", "smtp_password", "smtp_use_ssl"],
  llm: [
    "llm_enabled",
    "llm_protocol",
    "llm_base_url",
    "llm_model",
    "llm_auth_header",
    "llm_api_key",
    "llm_api_key_configured",
    "llm_timeout_seconds",
    "llm_max_tokens"
  ],
  whitelist: ["auth_allowed_emails", "auth_allowed_email_domains"],
  emailCode: [
    "auth_email_code_length",
    "auth_email_code_ttl_minutes",
    "auth_email_code_max_attempts",
    "auth_email_code_resend_cooldown_seconds",
    "auth_email_code_email_window_minutes",
    "auth_email_code_email_window_max_sends",
    "auth_email_code_ip_window_minutes",
    "auth_email_code_ip_window_max_sends"
  ]
};

const permissionGroupConfigs = [
  {
    key: "admin",
    titleKey: "admin.permissions.groups.admin",
    permissionKeys: [
      "admin.access",
      "admin.users.manage",
      "admin.sessions.manage",
      "admin.roles.manage",
      "admin.database.manage"
    ]
  },
  {
    key: "resources",
    titleKey: "admin.permissions.groups.resources",
    permissionKeys: ["hosts.manage", "credentials.manage", "files.manage"]
  },
  {
    key: "terminal",
    titleKey: "admin.permissions.groups.terminal",
    permissionKeys: ["terminal.connect", "transfers.manage"]
  },
  {
    key: "audit",
    titleKey: "admin.permissions.groups.audit",
    permissionKeys: ["audit.read"]
  }
];

const knownPermissionKeys = new Set<string>(permissionGroupConfigs.flatMap((group) => group.permissionKeys));

function formatRelativeTime(value: string, locale: string) {
  const target = new Date(value).getTime();
  const now = Date.now();
  const diffSeconds = Math.round((target - now) / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const [unit, unitSeconds] = units.find(([, seconds]) => absoluteSeconds >= seconds) || units[units.length - 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(diffSeconds / unitSeconds), unit);
}

function getSessionDeviceLabel(session: AdminSession, unknownDeviceLabel: string) {
  if (session.device_label?.trim()) {
    return session.device_label.trim();
  }
  const parsed = parseUserAgent(session.user_agent);
  return parsed.browser === "Unknown browser" && parsed.os === "Unknown OS" ? unknownDeviceLabel : parsed.label;
}

function getSessionUserDisplayName(session: AdminSession) {
  const displayName = session.user_display_name?.trim();
  if (displayName) {
    return displayName;
  }
  const email = session.user_email?.trim();
  if (email) {
    return email;
  }
  return session.user_id.length > 12 ? `${session.user_id.slice(0, 8)}...` : session.user_id;
}

function roleTone(role: string) {
  return role === "admin" ? "info" : "neutral";
}

function loginMethodLabel(method: string | null | undefined, t: (key: string) => string) {
  if (!method) {
    return t("common.unknown");
  }
  const key = `profile.account.loginMethod.${method}`;
  const translated = t(key);
  return translated === key ? method : translated;
}

function statusTone(status: string) {
  return status === "active" ? "success" : "danger";
}

function roleLabel(role: string, t: (key: string) => string) {
  if (role === "admin") {
    return t("admin.users.role.admin");
  }
  if (role === "user") {
    return t("admin.users.role.user");
  }
  return role;
}

function userHasAdminAccess(user: Pick<AdminUser, "permissions" | "role">) {
  return user.role === "admin" || user.permissions.includes("admin.access");
}

function getTranslationOrFallback(key: string, fallback: string, t: (key: string) => string) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function defaultRoleForm(): AdminRole {
  return {
    key: "",
    name: "",
    description: "",
    is_system: false,
    is_active: true,
    user_count: 0,
    permissions: [],
    created_at: "",
    updated_at: ""
  };
}

function databaseExportFileName() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  return `online-ssh-database-${stamp}.json`;
}

function numberInputValue(value: AdminGeneralSettings[keyof AdminGeneralSettings]) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function isGeneralNumberFieldValid(settings: AdminGeneralSettings, field: GeneralNumberField) {
  const value = settings[field.key];
  return typeof value === "number" && Number.isFinite(value) && value >= field.min && value <= field.max;
}

function isGeneralSectionValid(settings: AdminGeneralSettings, section: GeneralSectionKey) {
  const sectionKeys = new Set<keyof AdminGeneralSettings>(generalSectionFields[section]);
  const numberFieldsValid = allGeneralNumberFields
    .filter((field) => sectionKeys.has(field.key))
    .every((field) => isGeneralNumberFieldValid(settings, field));
  if (!numberFieldsValid) {
    return false;
  }
  if (section === "smtp") {
    return typeof settings.smtp_port === "number" && Number.isFinite(settings.smtp_port) && settings.smtp_port >= 1 && settings.smtp_port <= 65535;
  }
  return true;
}

function formatGeneralValue(value: number, unit: string) {
  return `${value} ${unit}`;
}

function splitGeneralList(raw: string) {
  return raw
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function GeneralSectionCard({
  actions,
  children,
  copy,
  defaultOpen = true,
  forceOpen = false,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  copy: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  return (
    <section className={["admin-general-card", open ? "admin-general-card-open" : ""].filter(Boolean).join(" ")}>
      <button
        aria-expanded={open}
        className="admin-general-card-summary"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>
          <h5>{title}</h5>
          <p>{copy}</p>
        </span>
      </button>
      {actions ? <div className="admin-general-card-actions">{actions}</div> : null}
      {open ? (
        <div className="admin-general-card-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

type AdminPageProps = {
  visible?: boolean;
};

export function AdminPage({ visible = true }: AdminPageProps = {}) {
  const auth = useAuth();
  const { language, t } = usePreferences();
  const confirmDialog = useConfirmDialog();
  const toast = useToast();
  const [tab, setTab] = useState<AdminTabKey>("general");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [definitions, setDefinitions] = useState<AdminPermissionDefinition[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [loadingGeneralSettings, setLoadingGeneralSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [busyRoleKey, setBusyRoleKey] = useState<string | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleDialogMode, setRoleDialogMode] = useState<RoleDialogMode>("create");
  const [activeRoleKey, setActiveRoleKey] = useState("");
  const [roleForm, setRoleForm] = useState<AdminRole>(defaultRoleForm());
  const [roleDetailsDialogRole, setRoleDetailsDialogRole] = useState<AdminRole | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatusFilter>("all");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(userPageSizeOptions[0]);
  const [userRoleDialogUser, setUserRoleDialogUser] = useState<AdminUser | null>(null);
  const [userRoleValue, setUserRoleValue] = useState("");
  const [databaseBusy, setDatabaseBusy] = useState<"export" | "import" | null>(null);
  const [generalForm, setGeneralForm] = useState<AdminGeneralSettings>(defaultGeneralSettings);
  const [editingGeneralSection, setEditingGeneralSection] = useState<GeneralSectionKey | null>(null);
  const [generalDraft, setGeneralDraft] = useState<AdminGeneralSettings>(defaultGeneralSettings);
  const [savingGeneralSection, setSavingGeneralSection] = useState<GeneralSectionKey | null>(null);
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [sendingSmtpTestEmail, setSendingSmtpTestEmail] = useState(false);
  const [testingLlmSettings, setTestingLlmSettings] = useState(false);
  const [clearSmtpPassword, setClearSmtpPassword] = useState(false);
  const [clearLlmApiKey, setClearLlmApiKey] = useState(false);

  const tabItems = useMemo(
    () => adminTabs.map((item) => ({ label: t(item.labelKey), value: item.key })),
    [t]
  );
  const roleNameByKey = useMemo(
    () => new Map(roles.map((role) => [role.key, role.name])),
    [roles]
  );
  const currentUserPermissions = auth.user?.permissions || [];
  const canManageUsers = currentUserPermissions.includes("admin.users.manage");
  const canManageSessions = currentUserPermissions.includes("admin.sessions.manage");
  const canManageRoles = currentUserPermissions.includes("admin.roles.manage");
  const canManageDatabase = currentUserPermissions.includes("admin.database.manage");

  const permissionDefinitionsByKey = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions]
  );
  const roleOptions = useMemo(() => roles.map((role) => ({ label: role.name, value: role.key })), [roles]);
  const userRoleOptions = useMemo(() => {
    if (!userRoleDialogUser || roles.some((role) => role.key === userRoleDialogUser.role)) {
      return roleOptions;
    }
    return [
      { label: roleNameByKey.get(userRoleDialogUser.role) || roleLabel(userRoleDialogUser.role, t), value: userRoleDialogUser.role },
      ...roleOptions
    ];
  }, [roleNameByKey, roleOptions, roles, t, userRoleDialogUser]);
  const filteredUsers = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        search.length === 0 ||
        user.display_name.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search);
      const matchesStatus =
        userStatusFilter === "all" ||
        (userStatusFilter === "online" ? user.active_session_count > 0 : user.status === userStatusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [userSearch, userStatusFilter, users]);
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const paginatedUsers = useMemo(() => {
    const start = (Math.min(userPage, userTotalPages) - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [filteredUsers, userPage, userPageSize, userTotalPages]);
  useEffect(() => {
    setUserPage(1);
  }, [userSearch, userStatusFilter, userPageSize]);

  useEffect(() => {
    if (userPage > userTotalPages) {
      setUserPage(userTotalPages);
    }
  }, [userPage, userTotalPages]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setErrorMessage(null);
    try {
      const response = await listAdminUsers();
      setUsers(response.items);
    } catch (error) {
      const message = getApiErrorMessage(error, t("admin.users.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingUsers(false);
    }
  }, [t, toast]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    setErrorMessage(null);
    try {
      const response = await listAdminSessions();
      setSessions(response.items);
    } catch (error) {
      const message = getApiErrorMessage(error, t("admin.sessions.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingSessions(false);
    }
  }, [t, toast]);

  const loadRoles = useCallback(async () => {
    setLoadingRoles(true);
    setErrorMessage(null);
    try {
      const response = await listAdminRoles();
      setRoles(response.items);
      setDefinitions(response.permissions);
    } catch (error) {
      const message = getApiErrorMessage(error, t("admin.roles.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingRoles(false);
    }
  }, [t, toast]);

  const loadGeneralSettings = useCallback(async () => {
    setLoadingGeneralSettings(true);
    setErrorMessage(null);
    try {
      const response = await getAdminGeneralSettings();
      setGeneralForm(response.settings);
      setGeneralDraft(response.settings);
      setEditingGeneralSection(null);
      setClearSmtpPassword(false);
      setClearLlmApiKey(false);
    } catch (error) {
      const message = getApiErrorMessage(error, t("admin.general.loadFailed"), t);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingGeneralSettings(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    void loadUsers();
    void loadSessions();
    void loadRoles();
    void loadGeneralSettings();
  }, [loadGeneralSettings, loadRoles, loadSessions, loadUsers, visible]);

  if (!auth.user?.permissions?.includes("admin.access")) {
    return <Navigate replace to="/dashboard" />;
  }

  const refreshCurrentTab = () => {
    setErrorMessage(null);
    if (tab === "sessions") {
      void loadSessions();
      return;
    }
    if (tab === "users") {
      void loadUsers();
      return;
    }
    if (tab === "roles") {
      void loadRoles();
      return;
    }
    if (tab === "general") {
      void loadGeneralSettings();
      return;
    }
    void Promise.all([loadUsers(), loadSessions(), loadRoles(), loadGeneralSettings()]);
  };

  const openCreateRole = () => {
    setRoleDialogMode("create");
    setActiveRoleKey("");
    setRoleForm(defaultRoleForm());
    setRoleDialogOpen(true);
  };

  const openEditRole = (role: AdminRole) => {
    setRoleDialogMode("edit");
    setActiveRoleKey(role.key);
    setRoleForm(role);
    setRoleDialogOpen(true);
  };

  const openRoleDetails = (role: AdminRole) => {
    setRoleDetailsDialogRole(role);
  };

  const openUserRoleDialog = (user: AdminUser) => {
    setUserRoleDialogUser(user);
    setUserRoleValue(user.role);
  };

  const closeUserRoleDialog = () => {
    setUserRoleDialogUser(null);
    setUserRoleValue("");
  };

  const closeRoleDialog = () => {
    setRoleDialogOpen(false);
    setRoleDialogMode("create");
    setActiveRoleKey("");
    setRoleForm(defaultRoleForm());
  };

  const closeRoleDetailsDialog = () => {
    setRoleDetailsDialogRole(null);
  };

  const handleToggleUserStatus = async (user: AdminUser) => {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    const confirmed = await confirmDialog.requestConfirmation({
      title: nextStatus === "disabled" ? t("admin.users.disableTitle") : t("admin.users.enableTitle"),
      message:
        nextStatus === "disabled"
          ? t("admin.users.disableMessage", { name: user.display_name })
          : t("admin.users.enableMessage", { name: user.display_name }),
      confirmLabel: nextStatus === "disabled" ? t("admin.users.disableConfirm") : t("admin.users.enableConfirm"),
      tone: nextStatus === "disabled" ? "danger" : "default"
    });
    if (!confirmed) {
      return;
    }

    setBusyUserId(user.id);
    try {
      await updateAdminUserStatus(user.id, nextStatus);
      toast.success(nextStatus === "disabled" ? t("admin.users.disabled") : t("admin.users.enabled"));
      await Promise.all([loadUsers(), loadSessions()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.users.updateFailed"), t));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleChangeUserRole = async (user: AdminUser, nextRole: string) => {
    if (nextRole === user.role) {
      return true;
    }
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("admin.roles.changeTitle"),
      message: t("admin.roles.changeMessage", { name: user.display_name, role: roleNameByKey.get(nextRole) || roleLabel(nextRole, t) }),
      confirmLabel: t("admin.roles.changeConfirm"),
      tone: "default"
    });
    if (!confirmed) {
      return false;
    }

    setBusyUserId(user.id);
    try {
      await updateAdminUserRole(user.id, nextRole);
      toast.success(t("admin.roles.changed"));
      await Promise.all([loadUsers(), loadSessions()]);
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.roles.updateFailed"), t));
      return false;
    } finally {
      setBusyUserId(null);
    }
  };

  const handleSubmitUserRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userRoleDialogUser) {
      return;
    }
    const changed = await handleChangeUserRole(userRoleDialogUser, userRoleValue);
    if (changed) {
      closeUserRoleDialog();
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("admin.users.deleteTitle"),
      message: t("admin.users.deleteMessage", { name: user.display_name }),
      confirmLabel: t("admin.users.deleteConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setBusyUserId(user.id);
    try {
      await deleteAdminUser(user.id);
      toast.success(t("admin.users.deleted"));
      await Promise.all([loadUsers(), loadSessions()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.users.deleteFailed"), t));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevokeUserSessions = async (user: AdminUser) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("admin.sessions.revokeUserTitle"),
      message: t("admin.sessions.revokeUserMessage", { name: user.display_name }),
      confirmLabel: t("admin.sessions.revokeConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setBusyUserId(user.id);
    try {
      const response = await revokeAdminUserSessions(user.id);
      toast.success(t("admin.sessions.revokedUser", { count: response.revoked_session_count }));
      await Promise.all([loadUsers(), loadSessions()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.sessions.revokeFailed"), t));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetUserMfa = async (user: AdminUser) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("admin.users.resetMfaTitle"),
      message: t("admin.users.resetMfaMessage", { name: user.display_name }),
      confirmLabel: t("admin.users.resetMfaConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setBusyUserId(user.id);
    try {
      await resetAdminUserMfa(user.id);
      toast.success(t("admin.users.resetMfaSuccess"));
      await loadUsers();
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.users.resetMfaFailed"), t));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRevokeSession = async (session: AdminSession) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("admin.sessions.revokeSessionTitle"),
      message: t("admin.sessions.revokeSessionMessage", { name: session.user_display_name }),
      confirmLabel: t("admin.sessions.revokeConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setBusySessionId(session.id);
    try {
      await revokeAdminSession(session.id);
      toast.success(t("admin.sessions.revokedSession"));
      await Promise.all([loadUsers(), loadSessions()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.sessions.revokeFailed"), t));
    } finally {
      setBusySessionId(null);
    }
  };

  const handleToggleRolePermission = (permission: string) => {
    setRoleForm((current) => {
      const nextPermissions = current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission];
      return { ...current, permissions: nextPermissions };
    });
  };

  const handleTogglePermissionGroup = (permissionKeys: string[]) => {
    setRoleForm((current) => {
      const selectedKeys = new Set(current.permissions);
      const allSelected = permissionKeys.every((permission) => selectedKeys.has(permission));
      if (allSelected) {
        permissionKeys.forEach((permission) => selectedKeys.delete(permission));
      } else {
        permissionKeys.forEach((permission) => selectedKeys.add(permission));
      }
      return { ...current, permissions: [...selectedKeys] };
    });
  };

  const handleSubmitRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!roleForm.key.trim() || !roleForm.name.trim()) {
      return;
    }

    setBusyRoleKey(roleForm.key.trim());
    try {
      if (roleDialogMode === "create") {
        await createAdminRole(roleForm);
        toast.success(t("admin.roles.created"));
      } else {
        await updateAdminRole(activeRoleKey, roleForm);
        toast.success(t("admin.roles.saved"));
      }
      closeRoleDialog();
      await Promise.all([loadRoles(), loadUsers(), loadSessions()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.roles.updateFailed"), t));
    } finally {
      setBusyRoleKey(null);
    }
  };

  const handleDeleteRole = async (role: AdminRole) => {
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("admin.roles.deleteTitle"),
      message: t("admin.roles.deleteMessage", { name: role.name }),
      confirmLabel: t("admin.roles.deleteConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setBusyRoleKey(role.key);
    try {
      await deleteAdminRole(role.key);
      toast.success(t("admin.roles.deleted"));
      await Promise.all([loadRoles(), loadUsers()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.roles.deleteFailed"), t));
    } finally {
      setBusyRoleKey(null);
    }
  };

  const updateGeneralNumberField = (key: keyof AdminGeneralSettings, value: string) => {
    setGeneralDraft((current) => ({
      ...current,
      [key]: value.trim() === "" ? Number.NaN : Number(value)
    }));
  };

  const updateGeneralTextField = (key: keyof AdminGeneralSettings, value: string) => {
    setGeneralDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const updateGeneralProtocolField = (value: string) => {
    setGeneralDraft((current) => ({
      ...current,
      llm_protocol: value === "anthropic" ? "anthropic" : "openai"
    }));
  };

  const updateGeneralAuthHeaderField = (value: string) => {
    setGeneralDraft((current) => ({
      ...current,
      llm_auth_header: value === "bearer" ? "bearer" : "api_key"
    }));
  };

  const updateGeneralBooleanField = (key: keyof AdminGeneralSettings, value: boolean) => {
    setGeneralDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const startEditGeneralSection = (section: GeneralSectionKey) => {
    if (editingGeneralSection && editingGeneralSection !== section) {
      toast.info(t("admin.general.finishCurrentEdit"));
      return;
    }
    setGeneralDraft(generalForm);
    setClearSmtpPassword(false);
    setClearLlmApiKey(false);
    setEditingGeneralSection(section);
  };

  const cancelGeneralSectionEdit = () => {
    setGeneralDraft(generalForm);
    setClearSmtpPassword(false);
    setClearLlmApiKey(false);
    setEditingGeneralSection(null);
  };

  const saveGeneralSection = async (section: GeneralSectionKey) => {
    setSavingGeneralSection(section);
    try {
      if (!isGeneralSectionValid(generalDraft, section)) {
        toast.error(t("admin.general.saveFailed"));
        return;
      }
      const patch = generalSectionFields[section].reduce<Partial<AdminGeneralSettings>>((result, key) => {
        result[key] = generalDraft[key] as never;
        return result;
      }, {});
      const nextSettings = {
        ...generalForm,
        ...patch,
        ...(section === "smtp" && clearSmtpPassword ? { smtp_password_clear: true } : {}),
        ...(section === "llm" && clearLlmApiKey ? { llm_api_key_clear: true } : {})
      };
      const response = await updateAdminGeneralSettings(nextSettings);
      setGeneralForm(response.settings);
      setGeneralDraft(response.settings);
      setClearSmtpPassword(false);
      setClearLlmApiKey(false);
      setEditingGeneralSection(null);
      toast.success(t("admin.general.saved"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.general.saveFailed"), t));
    } finally {
      setSavingGeneralSection(null);
    }
  };

  const handleSendSmtpTestEmail = async () => {
    const recipient = smtpTestEmail.trim();
    if (recipient === "") {
      return;
    }
    setSendingSmtpTestEmail(true);
    try {
      const payload: Partial<AdminGeneralSettingsUpdate> = {
        smtp_host: generalDraft.smtp_host,
        smtp_port: generalDraft.smtp_port,
        smtp_from: generalDraft.smtp_from,
        smtp_from_name: generalDraft.smtp_from_name,
        smtp_username: generalDraft.smtp_username,
        smtp_use_ssl: generalDraft.smtp_use_ssl
      };
      if ((generalDraft.smtp_password || "").trim() !== "") {
        payload.smtp_password = generalDraft.smtp_password;
      }
      if (clearSmtpPassword) {
        payload.smtp_password_clear = true;
      }
      await sendAdminGeneralSettingsTestEmail(recipient, payload);
      toast.success(t("admin.general.testEmailSent"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.general.testEmailFailed"), t));
    } finally {
      setSendingSmtpTestEmail(false);
    }
  };

  const handleTestLlmSettings = async () => {
    setTestingLlmSettings(true);
    try {
      const payload: Partial<AdminGeneralSettingsUpdate> = {
        llm_enabled: generalDraft.llm_enabled,
        llm_protocol: generalDraft.llm_protocol,
        llm_base_url: generalDraft.llm_base_url,
        llm_model: generalDraft.llm_model,
        llm_auth_header: generalDraft.llm_auth_header,
        llm_timeout_seconds: generalDraft.llm_timeout_seconds,
        llm_max_tokens: generalDraft.llm_max_tokens
      };
      if ((generalDraft.llm_api_key || "").trim() !== "") {
        payload.llm_api_key = generalDraft.llm_api_key;
      }
      if (clearLlmApiKey) {
        payload.llm_api_key_clear = true;
      }
      await testAdminGeneralSettingsLlm(payload);
      toast.success(t("admin.general.testLlmPassed"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.general.testLlmFailed"), t));
    } finally {
      setTestingLlmSettings(false);
    }
  };

  const handleExportDatabase = async () => {
    setDatabaseBusy("export");
    try {
      const blob = await exportAdminDatabase();
      saveBlobAsFile(blob, databaseExportFileName());
      toast.success(t("admin.database.exportStarted"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.database.exportFailed"), t));
    } finally {
      setDatabaseBusy(null);
    }
  };

  const handleImportDatabase = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setDatabaseBusy("import");
    try {
      const result = await importAdminDatabase(file);
      toast.success(
        t("admin.database.importCompleted", {
          hostGroupsImported: result.host_groups_imported,
          hostGroupsSkipped: result.host_groups_skipped,
          credentialsImported: result.credentials_imported,
          credentialsSkipped: result.credentials_skipped,
          hostsImported: result.hosts_imported,
          hostsSkipped: result.hosts_skipped
        })
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("admin.database.importFailed"), t));
    } finally {
      setDatabaseBusy(null);
    }
  };

  const summaryCards = [
    {
      icon: <Users aria-hidden="true" />,
      label: t("admin.summary.users"),
      value: loadingUsers ? t("common.loading") : String(users.length)
    },
    {
      icon: <Clock3 aria-hidden="true" />,
      label: t("admin.summary.sessions"),
      value: loadingSessions ? t("common.loading") : String(sessions.length)
    },
    {
      icon: <Shield aria-hidden="true" />,
      label: t("admin.summary.roleModel"),
      value: loadingRoles ? t("common.loading") : String(roles.length)
    }
  ];

  const getPermissionLabel = (permissionKey: string) =>
    getTranslationOrFallback(`admin.permissions.${permissionKey}.label`, permissionDefinitionsByKey.get(permissionKey)?.label || permissionKey, t);

  const getPermissionDescription = (permissionKey: string) =>
    getTranslationOrFallback(
      `admin.permissions.${permissionKey}.description`,
      permissionDefinitionsByKey.get(permissionKey)?.description || permissionKey,
      t
    );

  const getPermissionGroups = (permissionKeys: string[]) => {
    const selectedPermissions = new Set(permissionKeys);
    const configuredGroups = permissionGroupConfigs.map((group) => ({
      key: group.key,
      title: t(group.titleKey),
      permissions: group.permissionKeys.filter((permission) => selectedPermissions.has(permission))
    }));
    const otherPermissions = permissionKeys.filter((permission) => !knownPermissionKeys.has(permission));
    return otherPermissions.length > 0
      ? [...configuredGroups, { key: "other", title: t("admin.permissions.groups.other"), permissions: otherPermissions }]
      : configuredGroups;
  };

  const getDefinitionGroups = () => {
    const availablePermissions = new Set(definitions.map((definition) => definition.key));
    const configuredGroups = permissionGroupConfigs.map((group) => ({
      key: group.key,
      title: t(group.titleKey),
      permissions: group.permissionKeys.filter((permission) => availablePermissions.has(permission))
    }));
    const otherDefinitions = definitions
      .map((definition) => definition.key)
      .filter((permission) => !knownPermissionKeys.has(permission));
    return otherDefinitions.length > 0
      ? [...configuredGroups, { key: "other", title: t("admin.permissions.groups.other"), permissions: otherDefinitions }]
      : configuredGroups;
  };

  const renderPermissionSummary = (role: AdminRole) => {
    const groups = getPermissionGroups(role.permissions).filter((group) => group.permissions.length > 0);
    if (groups.length === 0) {
      return <p className="admin-role-permissions-empty">{t("common.none")}</p>;
    }

    return (
      <div className="admin-permission-summary">
        <span className="admin-permission-total">{t("admin.roles.permissionCount", { count: role.permissions.length })}</span>
        <div className="admin-permission-group-counts">
          {groups.map((group) => (
            <span key={group.key}>{t("admin.roles.permissionGroupCount", { group: group.title, count: group.permissions.length })}</span>
          ))}
        </div>
      </div>
    );
  };

  const renderRoleDetailsDialog = () => {
    const role = roleDetailsDialogRole;
    const groups = role ? getPermissionGroups(role.permissions).filter((group) => group.permissions.length > 0) : [];
    return (
      <Dialog
        closeLabel={t("common.close")}
        contentClassName="admin-role-detail-dialog"
        footer={(
          <div className="admin-role-detail-footer">
            <Button onClick={closeRoleDetailsDialog} variant="secondary">{t("common.close")}</Button>
          </div>
        )}
        onOpenChange={(open) => {
          if (!open) {
            closeRoleDetailsDialog();
          }
        }}
        open={Boolean(role)}
        size="lg"
        title={t("admin.roles.detailsTitle")}
      >
        {role ? (
          <div className="admin-role-detail-content">
            <section className="admin-role-detail-section">
              <h5>{t("admin.roles.basicInfo")}</h5>
              <dl className="admin-role-detail-grid">
                <div>
                  <dt>{t("common.name")}</dt>
                  <dd>{role.name}</dd>
                </div>
                <div>
                  <dt>{t("admin.roles.key")}</dt>
                  <dd><code>{role.key}</code></dd>
                </div>
                <div>
                  <dt>{t("admin.roles.description")}</dt>
                  <dd>{role.description || t("common.none")}</dd>
                </div>
                <div>
                  <dt>{t("common.status")}</dt>
                  <dd>{role.is_active ? t("admin.roles.active") : t("admin.roles.inactive")}</dd>
                </div>
                <div>
                  <dt>{t("admin.roles.type")}</dt>
                  <dd>{role.is_system ? t("admin.roles.system") : t("admin.roles.custom")}</dd>
                </div>
                <div>
                  <dt>{t("admin.roles.userCount")}</dt>
                  <dd>{t("admin.roles.users", { count: role.user_count })}</dd>
                </div>
              </dl>
            </section>
            <section className="admin-role-detail-section">
              <h5>{t("admin.roles.permissionDetails")}</h5>
              {groups.length === 0 ? <p className="admin-role-permissions-empty">{t("common.none")}</p> : null}
              <div className="admin-role-detail-permission-groups">
                {groups.map((group) => (
                  <section className="admin-role-detail-permission-group" key={group.key}>
                    <div className="admin-role-detail-permission-head">
                      <strong>{group.title}</strong>
                      <span>{t("admin.roles.permissionCount", { count: group.permissions.length })}</span>
                    </div>
                    <div className="admin-role-detail-permission-list">
                      {group.permissions.map((permission) => (
                        <article className="admin-role-detail-permission-item" key={permission}>
                          <strong>{getPermissionLabel(permission)}</strong>
                          <code>{permission}</code>
                          <p>{getPermissionDescription(permission)}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </Dialog>
    );
  };

  const userColumns: Array<ColumnDef<AdminUser>> = [
    {
      accessorKey: "display_name",
      header: t("admin.users.columns.user"),
      cell: ({ row }) => (
        <div className="admin-table-user">
          <strong>{row.original.display_name}</strong>
          <span>{row.original.email}</span>
          <small>{loginMethodLabel(row.original.last_login_method || row.original.auth_type, t)}</small>
        </div>
      )
    },
    {
      id: "status_sessions",
      header: t("admin.users.columns.statusSessions"),
      cell: ({ row }) => (
        <div className="admin-table-stack">
          <Badge tone={statusTone(row.original.status)}>{t(`admin.users.status.${row.original.status}`)}</Badge>
          <span className="admin-table-muted">
            {t("admin.users.sessions", { count: row.original.active_session_count })}
          </span>
        </div>
      )
    },
    {
      accessorKey: "role",
      header: t("admin.users.columns.role"),
      cell: ({ row }) => (
        <Badge tone={roleTone(row.original.role)}>
          {roleNameByKey.get(row.original.role) || roleLabel(row.original.role, t)}
        </Badge>
      )
    },
    {
      accessorKey: "mfa_enabled",
      header: t("admin.users.columns.mfa"),
      cell: ({ row }) => (
        <Badge tone={row.original.mfa_enabled ? "success" : "neutral"}>
          {row.original.mfa_enabled ? t("admin.users.mfaEnabled") : t("admin.users.mfaDisabled")}
        </Badge>
      )
    },
    {
      id: "activity",
      header: t("admin.users.columns.createdLastLogin"),
      cell: ({ row }) => (
        <div className="admin-table-stack">
          <span className="admin-table-muted">{formatDateTime(row.original.created_at, language, row.original.created_at)}</span>
          <span className="admin-table-muted">
            {row.original.last_login_at ? formatDateTime(row.original.last_login_at, language, row.original.last_login_at) : t("common.notRecorded")}
          </span>
        </div>
      )
    },
    {
      id: "actions",
      header: t("admin.users.columns.actions"),
      cell: ({ row }) => {
        const user = row.original;
        const isBusy = busyUserId === user.id;
        const isSelf = user.id === auth.user?.id;
        const isAdminUser = userHasAdminAccess(user);
        return (
          <div className="admin-table-actions">
            <Tooltip content={t("admin.roles.change")}>
              <IconButton
                disabled={isBusy || !canManageUsers || isSelf}
                label={t("admin.roles.change")}
                onClick={() => openUserRoleDialog(user)}
                variant="neutral"
              >
                <Edit3 aria-hidden="true" />
              </IconButton>
            </Tooltip>
            <Tooltip content={user.status === "active" ? t("admin.users.disable") : t("admin.users.enable")}>
              <IconButton
                disabled={isBusy || !canManageUsers || isSelf}
                label={user.status === "active" ? t("admin.users.disable") : t("admin.users.enable")}
                onClick={() => void handleToggleUserStatus(user)}
                variant={user.status === "active" ? "danger" : "neutral"}
              >
                {user.status === "active" ? <Ban aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              </IconButton>
            </Tooltip>
            <Tooltip content={t("admin.sessions.revokeUser")}>
              <IconButton
                disabled={isBusy || !canManageSessions}
                label={t("admin.sessions.revokeUser")}
                onClick={() => void handleRevokeUserSessions(user)}
                variant="neutral"
              >
                <LogOut aria-hidden="true" />
              </IconButton>
            </Tooltip>
            {user.mfa_enabled && !isSelf && !isAdminUser ? (
              <Tooltip content={t("admin.users.resetMfa")}>
                <IconButton
                  disabled={isBusy || !canManageUsers}
                  label={t("admin.users.resetMfa")}
                  onClick={() => void handleResetUserMfa(user)}
                  variant="neutral"
                >
                  <Shield aria-hidden="true" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip content={isSelf ? t("admin.users.deleteSelfBlocked") : isAdminUser ? t("admin.users.deleteAdminBlocked") : t("common.delete")}>
              <IconButton
                disabled={isBusy || !canManageUsers || isSelf || isAdminUser}
                label={isSelf ? t("admin.users.deleteSelfBlocked") : isAdminUser ? t("admin.users.deleteAdminBlocked") : t("common.delete")}
                onClick={() => void handleDeleteUser(user)}
                variant="danger"
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            </Tooltip>
          </div>
        );
      }
    }
  ];

  const renderGeneralNumberField = (field: GeneralNumberField, className = "") => (
    <FormField
      className={className}
      description={t("admin.general.rangeHint", { min: field.min, max: field.max, unit: t(field.unitKey) })}
      key={field.key}
      label={t(field.labelKey)}
    >
      {(id) => (
        <div className="admin-general-number-control">
          <TextInput
            id={id}
            max={field.max}
            min={field.min}
            onChange={(event) => updateGeneralNumberField(field.key, event.target.value)}
            required
            type="number"
            value={numberInputValue(generalDraft[field.key])}
          />
          <span className="admin-general-unit">{t(field.unitKey)}</span>
        </div>
      )}
    </FormField>
  );

  const renderGeneralNumberFields = (fields: GeneralNumberField[], className = "") => (
    <div className={["admin-general-field-grid admin-general-number-grid", className].filter(Boolean).join(" ")}>
      {fields.map((field) => renderGeneralNumberField(field))}
    </div>
  );

  const renderGeneralSectionCard = (
    section: GeneralSectionKey,
    titleKey: string,
    copyKey: string,
    children: ReactNode,
    options: { defaultOpen?: boolean } = {}
  ) => (
    editingGeneralSection === section ? (
      <GeneralSectionCard
        actions={(
          <Tooltip content={t("admin.general.cancelSection", { section: t(titleKey) })}>
            <IconButton
              disabled={savingGeneralSection === section}
              label={t("admin.general.cancelSection", { section: t(titleKey) })}
              onClick={(event) => {
                event.stopPropagation();
                cancelGeneralSectionEdit();
              }}
              variant="neutral"
            >
              <Ban aria-hidden="true" />
            </IconButton>
          </Tooltip>
        )}
        copy={t(copyKey)}
        defaultOpen={options.defaultOpen ?? true}
        forceOpen
        key={`${section}-editing`}
        title={t(titleKey)}
      >
        {children}
      </GeneralSectionCard>
    ) : (
      <GeneralSectionCard
        actions={(
          <Tooltip content={t("admin.general.editSection", { section: t(titleKey) })}>
            <IconButton
              disabled={Boolean(editingGeneralSection && editingGeneralSection !== section)}
              label={t("admin.general.editSection", { section: t(titleKey) })}
              onClick={(event) => {
                event.stopPropagation();
                startEditGeneralSection(section);
              }}
              variant="neutral"
            >
              <Edit3 aria-hidden="true" />
            </IconButton>
          </Tooltip>
        )}
        copy={t(copyKey)}
        defaultOpen={options.defaultOpen ?? true}
        key={`${section}-readonly`}
        title={t(titleKey)}
      >
        {children}
      </GeneralSectionCard>
    )
  );

  const renderGeneralSummaryItems = (
    items: Array<{ label: string; value: ReactNode; badgeTone?: "neutral" | "success" | "warning" | "danger" | "info" }>
  ) => (
    <div className="admin-general-summary-grid">
      {items.map((item) => (
        <div className="admin-general-summary-item" key={item.label}>
          <span>{item.label}</span>
          {item.badgeTone ? <Badge tone={item.badgeTone}>{item.value}</Badge> : <strong>{item.value}</strong>}
        </div>
      ))}
    </div>
  );

  const renderGeneralListSummary = (raw: string) => {
    const items = splitGeneralList(raw);
    if (items.length === 0) {
      return <Badge tone="info">{t("admin.general.unrestricted")}</Badge>;
    }
    return (
      <div className="admin-general-chip-list">
        {items.slice(0, 5).map((item) => <Badge key={item} tone="neutral">{item}</Badge>)}
        {items.length > 5 ? <Badge tone="info">{t("admin.general.moreItems", { count: items.length - 5 })}</Badge> : null}
      </div>
    );
  };

  const renderGeneralSectionFooter = (section: GeneralSectionKey) => {
    if (editingGeneralSection !== section) {
      return null;
    }
    const saving = savingGeneralSection === section;
    return (
      <div className="admin-general-card-footer">
        <p>{t("admin.general.cardEditHint")}</p>
        <div className="admin-general-action-buttons">
          <Button disabled={saving} onClick={cancelGeneralSectionEdit} variant="secondary">
            {t("common.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void saveGeneralSection(section)} variant="primary">
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </div>
    );
  };

  const renderAccountGeneralContent = () => editingGeneralSection === "account" ? (
    <>
      <div className="admin-general-account-edit-grid">
        <div className="admin-general-toggle-field">
          <span className="ui-field-label">{t("admin.general.fields.allowUserRegistration")}</span>
          <label className="admin-general-inline-toggle">
            <input
              aria-label={t("admin.general.fields.allowUserRegistration")}
              checked={generalDraft.allow_user_registration}
              onChange={(event) => updateGeneralBooleanField("allow_user_registration", event.target.checked)}
              type="checkbox"
            />
            <span>{generalDraft.allow_user_registration ? t("admin.general.enabled") : t("admin.general.disabled")}</span>
          </label>
          <p className="ui-field-description">{t("admin.general.fields.allowUserRegistrationCopy")}</p>
        </div>
        {accountGeneralFields.map((field) => renderGeneralNumberField(field))}
      </div>
      {renderGeneralSectionFooter("account")}
    </>
  ) : renderGeneralSummaryItems([
    {
      label: t("admin.general.fields.allowUserRegistration"),
      value: generalForm.allow_user_registration ? t("admin.general.enabled") : t("admin.general.disabled"),
      badgeTone: generalForm.allow_user_registration ? "success" : "warning"
    },
    {
      label: t("admin.general.fields.sessionIdleTimeout"),
      value: formatGeneralValue(generalForm.session_idle_timeout_minutes, t("admin.general.units.minutes"))
    },
    {
      label: t("admin.general.fields.refreshTokenTTL"),
      value: formatGeneralValue(generalForm.refresh_token_ttl_hours, t("admin.general.units.hours"))
    }
  ]);

  const renderTerminalFilesGeneralContent = () => editingGeneralSection === "terminalFiles" ? (
    <>
      {renderGeneralNumberFields(terminalFileGeneralFields)}
      {renderGeneralSectionFooter("terminalFiles")}
    </>
  ) : renderGeneralSummaryItems([
    {
      label: t("admin.general.fields.terminalMaxSessionsPerUser"),
      value: formatGeneralValue(generalForm.terminal_max_sessions_per_user, t("admin.general.units.items"))
    },
    {
      label: t("admin.general.fields.terminalMaxSessionsTotal"),
      value: formatGeneralValue(generalForm.terminal_max_sessions_total, t("admin.general.units.items"))
    },
    {
      label: t("admin.general.fields.terminalKeepAlive"),
      value: formatGeneralValue(generalForm.terminal_keep_alive_hours, t("admin.general.units.hours"))
    },
    {
      label: t("admin.general.fields.fileSFTPIdleTTL"),
      value: formatGeneralValue(generalForm.file_sftp_idle_ttl_minutes, t("admin.general.units.minutes"))
    },
    {
      label: t("admin.general.fields.hostConnectivityPollInterval"),
      value: formatGeneralValue(generalForm.host_connectivity_poll_interval_seconds, t("admin.general.units.seconds"))
    }
  ]);

  const renderSmtpGeneralContent = () => {
    const editing = editingGeneralSection === "smtp";
    return (
      <div className="admin-general-smtp-content">
        {editing ? (
          <>
            <div className="admin-general-field-grid admin-general-smtp-grid">
              <FormField className="admin-general-text-field" label={t("admin.general.fields.smtpHost")}>
                {(id) => (
                  <TextInput
                    id={id}
                    onChange={(event) => updateGeneralTextField("smtp_host", event.target.value)}
                    value={generalDraft.smtp_host}
                  />
                )}
              </FormField>
              <FormField className="admin-general-smtp-port-field" label={t("admin.general.fields.smtpPort")}>
                {(id) => (
                  <div className="admin-general-number-control">
                    <TextInput
                      id={id}
                      max={65535}
                      min={1}
                      onChange={(event) => updateGeneralNumberField("smtp_port", event.target.value)}
                      required
                      type="number"
                      value={numberInputValue(generalDraft.smtp_port)}
                    />
                  </div>
                )}
              </FormField>
              <FormField className="admin-general-text-field" label={t("admin.general.fields.smtpFrom")}>
                {(id) => (
                  <TextInput
                    id={id}
                    onChange={(event) => updateGeneralTextField("smtp_from", event.target.value)}
                    value={generalDraft.smtp_from}
                  />
                )}
              </FormField>
              <FormField className="admin-general-text-field" label={t("admin.general.fields.smtpFromName")}>
                {(id) => (
                  <TextInput
                    id={id}
                    onChange={(event) => updateGeneralTextField("smtp_from_name", event.target.value)}
                    value={generalDraft.smtp_from_name}
                  />
                )}
              </FormField>
              <FormField className="admin-general-text-field" label={t("admin.general.fields.smtpUsername")}>
                {(id) => (
                  <TextInput
                    autoComplete="username"
                    id={id}
                    onChange={(event) => updateGeneralTextField("smtp_username", event.target.value)}
                    value={generalDraft.smtp_username}
                  />
                )}
              </FormField>
              <FormField
                className="admin-general-smtp-password-field"
                description={t("admin.general.fields.smtpPasswordDescription")}
                label={t("admin.general.fields.smtpPassword")}
              >
                {(id) => (
                  <PasswordInput
                    autoComplete="new-password"
                    hideLabel={t("auth.hidePassword")}
                    id={id}
                    label={t("admin.general.fields.smtpPassword")}
                    onChange={(event) => {
                      setClearSmtpPassword(false);
                      updateGeneralTextField("smtp_password", event.target.value);
                    }}
                    showLabel={t("auth.showPassword")}
                    value={generalDraft.smtp_password || ""}
                  />
                )}
              </FormField>
              <div className="admin-general-toggle-field admin-general-smtp-ssl-field">
                <span className="ui-field-label">{t("admin.general.fields.smtpUseSSL")}</span>
                <label className="admin-general-inline-toggle">
                  <input
                    aria-label={t("admin.general.fields.smtpUseSSL")}
                    checked={generalDraft.smtp_use_ssl}
                    onChange={(event) => updateGeneralBooleanField("smtp_use_ssl", event.target.checked)}
                    type="checkbox"
                  />
                  <span>{generalDraft.smtp_use_ssl ? t("admin.general.enabled") : t("admin.general.disabled")}</span>
                </label>
              </div>
            </div>
            <div className="admin-general-smexample-api-key-note">
              <span>{t("admin.general.fields.smtpPasswordStatus")}</span>
              <Badge tone={clearSmtpPassword ? "warning" : generalForm.smtp_password_configured ? "success" : "info"}>
                {clearSmtpPassword ? t("admin.general.smtp.passwordWillClear") : generalForm.smtp_password_configured ? t("admin.general.smtp.passwordConfigured") : t("admin.general.notConfigured")}
              </Badge>
              <Button
                disabled={!generalForm.smtp_password_configured}
                onClick={() => {
                  setClearSmtpPassword(true);
                  updateGeneralTextField("smtp_password", "");
                }}
                size="sm"
                variant="secondary"
              >
                {t("admin.general.fields.smtpClearPassword")}
              </Button>
            </div>
          </>
        ) : (
          renderGeneralSummaryItems([
            { label: t("admin.general.fields.smtpHost"), value: generalForm.smtp_host || t("admin.general.notConfigured") },
            { label: t("admin.general.fields.smtpPort"), value: generalForm.smtp_port },
            { label: t("admin.general.fields.smtpFrom"), value: generalForm.smtp_from || t("admin.general.notConfigured") },
            { label: t("admin.general.fields.smtpFromName"), value: generalForm.smtp_from_name || t("admin.general.notConfigured") },
            { label: t("admin.general.fields.smtpUsername"), value: generalForm.smtp_username || t("admin.general.notConfigured") },
            {
              label: t("admin.general.fields.smtpPassword"),
              value: generalForm.smtp_password_configured ? t("admin.general.smtp.passwordConfigured") : t("admin.general.notConfigured"),
              badgeTone: generalForm.smtp_password_configured ? "success" : "warning"
            },
            {
              label: t("admin.general.fields.smtpUseSSL"),
              value: generalForm.smtp_use_ssl ? t("admin.general.enabled") : t("admin.general.disabled"),
              badgeTone: generalForm.smtp_use_ssl ? "success" : "warning"
            }
          ])
        )}
        <div className="admin-general-test-row">
          <FormField className="admin-general-test-recipient" label={t("admin.general.fields.smtpTestRecipient")}>
            {(id) => (
              <TextInput
                id={id}
                onChange={(event) => setSmtpTestEmail(event.target.value)}
                placeholder="ops@example.com"
                type="email"
                value={smtpTestEmail}
              />
            )}
          </FormField>
          <Button
            disabled={sendingSmtpTestEmail || smtpTestEmail.trim() === ""}
            leadingIcon={<Send aria-hidden="true" />}
            onClick={() => void handleSendSmtpTestEmail()}
            variant="secondary"
          >
            {sendingSmtpTestEmail ? t("common.loading") : t("admin.general.fields.smtpTestEmail")}
          </Button>
        </div>
        {renderGeneralSectionFooter("smtp")}
      </div>
    );
  };

  const llmProtocolLabel = (protocol: AdminGeneralSettings["llm_protocol"]) => (
    protocol === "anthropic" ? t("admin.general.llm.protocolAnthropic") : t("admin.general.llm.protocolOpenAI")
  );

  const llmAuthHeaderLabel = (authHeader: AdminGeneralSettings["llm_auth_header"]) => (
    authHeader === "bearer" ? t("admin.general.llm.authBearer") : t("admin.general.llm.authApiKey")
  );

  const renderSingleLineSummaryValue = (value: string) => (
    <span className="admin-general-summary-single-line" title={value}>
      {value}
    </span>
  );

  const renderLlmGeneralContent = () => {
    const editing = editingGeneralSection === "llm";
    const apiKeyDescription = t("admin.general.fields.llmApiKeyDescription");
    if (!editing) {
      return renderGeneralSummaryItems([
        {
          label: t("admin.general.fields.llmEnabled"),
          value: generalForm.llm_enabled ? t("admin.general.enabled") : t("admin.general.disabled"),
          badgeTone: generalForm.llm_enabled ? "success" : "warning"
        },
        {
          label: t("admin.general.fields.llmProtocol"),
          value: llmProtocolLabel(generalForm.llm_protocol)
        },
        {
          label: t("admin.general.fields.llmModel"),
          value: generalForm.llm_model || t("admin.general.notConfigured")
        },
        {
          label: t("admin.general.fields.llmBaseURL"),
          value: generalForm.llm_base_url
            ? renderSingleLineSummaryValue(generalForm.llm_base_url)
            : t("admin.general.notConfigured")
        },
        {
          label: t("admin.general.fields.llmApiKey"),
          value: generalForm.llm_api_key_configured ? t("admin.general.llm.keyConfigured") : t("admin.general.notConfigured"),
          badgeTone: generalForm.llm_api_key_configured ? "success" : "warning"
        }
      ]);
    }
    return (
      <div className="admin-general-llm-content">
        <div className="admin-general-field-grid admin-general-llm-grid">
          <FormField label={t("admin.general.fields.llmProtocol")}>
            {(id) => (
              <SelectInput
                aria-label={t("admin.general.fields.llmProtocol")}
                id={id}
                onChange={(event) => updateGeneralProtocolField(event.target.value)}
                value={generalDraft.llm_protocol}
              >
                <option value="openai">{t("admin.general.llm.protocolOpenAI")}</option>
                <option value="anthropic">{t("admin.general.llm.protocolAnthropic")}</option>
              </SelectInput>
            )}
          </FormField>
          <FormField label={t("admin.general.fields.llmAuthHeader")}>
            {(id) => (
              <SelectInput
                aria-label={t("admin.general.fields.llmAuthHeader")}
                id={id}
                onChange={(event) => updateGeneralAuthHeaderField(event.target.value)}
                value={generalDraft.llm_auth_header}
              >
                <option value="api_key">{t("admin.general.llm.authApiKey")}</option>
                <option value="bearer">{t("admin.general.llm.authBearer")}</option>
              </SelectInput>
            )}
          </FormField>
          <FormField label={t("admin.general.fields.llmBaseURL")}>
            {(id) => (
              <TextInput
                id={id}
                onChange={(event) => updateGeneralTextField("llm_base_url", event.target.value)}
                placeholder="https://api.openai.com/v1"
                value={generalDraft.llm_base_url}
              />
            )}
          </FormField>
          <FormField label={t("admin.general.fields.llmModel")}>
            {(id) => (
              <TextInput
                id={id}
                onChange={(event) => updateGeneralTextField("llm_model", event.target.value)}
                value={generalDraft.llm_model}
              />
            )}
          </FormField>
          <FormField
            className="admin-general-llm-api-key-field"
            description={(
              <span className="admin-general-llm-api-key-description" title={apiKeyDescription}>
                {apiKeyDescription}
              </span>
            )}
            label={t("admin.general.fields.llmApiKey")}
          >
            {(id) => (
              <PasswordInput
                autoComplete="new-password"
                hideLabel={t("auth.hidePassword")}
                id={id}
                label={t("admin.general.fields.llmApiKey")}
                onChange={(event) => {
                  setClearLlmApiKey(false);
                  updateGeneralTextField("llm_api_key", event.target.value);
                }}
                showLabel={t("auth.showPassword")}
                value={generalDraft.llm_api_key || ""}
              />
            )}
          </FormField>
          {llmGeneralFields.map((field) => renderGeneralNumberField(field, "admin-general-llm-limit-field"))}
        </div>
        <div className="admin-general-llm-key-row">
          <span>{t("admin.general.fields.llmApiKeyStatus")}</span>
          <Badge tone={clearLlmApiKey ? "warning" : generalForm.llm_api_key_configured ? "success" : "info"}>
            {clearLlmApiKey ? t("admin.general.llm.keyWillClear") : generalForm.llm_api_key_configured ? t("admin.general.llm.keyConfigured") : t("admin.general.notConfigured")}
          </Badge>
          <Button
            disabled={!generalForm.llm_api_key_configured}
            onClick={() => {
              setClearLlmApiKey(true);
              updateGeneralTextField("llm_api_key", "");
            }}
            size="sm"
            variant="secondary"
          >
            {t("admin.general.fields.llmClearApiKey")}
          </Button>
        </div>
        <div className="admin-general-card-footer admin-general-llm-footer">
          <p>{t("admin.general.cardEditHint")}</p>
          <div className="admin-general-llm-footer-actions">
            <label className="admin-general-inline-toggle admin-general-llm-footer-toggle" title={t("admin.general.fields.llmEnabledCopy")}>
              <input
                aria-label={t("admin.general.fields.llmEnabled")}
                checked={generalDraft.llm_enabled}
                onChange={(event) => updateGeneralBooleanField("llm_enabled", event.target.checked)}
                type="checkbox"
              />
              <span>{generalDraft.llm_enabled ? t("admin.general.enabled") : t("admin.general.disabled")}</span>
            </label>
            <div className="admin-general-action-buttons">
              <Button disabled={testingLlmSettings || savingGeneralSection === "llm"} onClick={() => void handleTestLlmSettings()} variant="secondary">
                {testingLlmSettings ? t("common.loading") : t("admin.general.fields.llmTestConnection")}
              </Button>
              <Button disabled={savingGeneralSection === "llm"} onClick={cancelGeneralSectionEdit} variant="secondary">
                {t("common.cancel")}
              </Button>
              <Button disabled={savingGeneralSection === "llm"} onClick={() => void saveGeneralSection("llm")} variant="primary">
                {savingGeneralSection === "llm" ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWhitelistGeneralContent = () => editingGeneralSection === "whitelist" ? (
    <>
      <div className="admin-general-field-grid admin-general-whitelist-grid">
        <FormField
          className="admin-general-long-field"
          description={t("admin.general.fields.allowedEmailsDescription")}
          label={t("admin.general.fields.allowedEmails")}
        >
          {(id) => (
            <TextareaInput
              className="admin-general-compact-textarea"
              id={id}
              onChange={(event) => updateGeneralTextField("auth_allowed_emails", event.target.value)}
              rows={3}
              value={generalDraft.auth_allowed_emails}
            />
          )}
        </FormField>
        <FormField
          className="admin-general-long-field"
          description={t("admin.general.fields.allowedEmailDomainsDescription")}
          label={t("admin.general.fields.allowedEmailDomains")}
        >
          {(id) => (
            <TextareaInput
              className="admin-general-compact-textarea"
              id={id}
              onChange={(event) => updateGeneralTextField("auth_allowed_email_domains", event.target.value)}
              rows={3}
              value={generalDraft.auth_allowed_email_domains}
            />
          )}
        </FormField>
      </div>
      {renderGeneralSectionFooter("whitelist")}
    </>
  ) : (
    <div className="admin-general-summary-grid admin-general-list-summary-grid">
      <div className="admin-general-summary-item">
        <span>{t("admin.general.fields.allowedEmails")}</span>
        {renderGeneralListSummary(generalForm.auth_allowed_emails)}
      </div>
      <div className="admin-general-summary-item">
        <span>{t("admin.general.fields.allowedEmailDomains")}</span>
        {renderGeneralListSummary(generalForm.auth_allowed_email_domains)}
      </div>
    </div>
  );

  const renderEmailCodeGeneralContent = () => editingGeneralSection === "emailCode" ? (
    <>
      <div className="admin-general-subgroup">
        <h6>{t("admin.general.sections.emailCodeBase")}</h6>
        {renderGeneralNumberFields(emailCodeBaseGeneralFields)}
      </div>
      <div className="admin-general-subgroup">
        <h6>{t("admin.general.sections.emailCodeRate")}</h6>
        {renderGeneralNumberFields(emailCodeRateGeneralFields)}
      </div>
      {renderGeneralSectionFooter("emailCode")}
    </>
  ) : (
    <>
      <div className="admin-general-subgroup">
        <h6>{t("admin.general.sections.emailCodeBase")}</h6>
        {renderGeneralSummaryItems([
          {
            label: t("admin.general.fields.authEmailCodeLength"),
            value: formatGeneralValue(generalForm.auth_email_code_length, t("admin.general.units.digits"))
          },
          {
            label: t("admin.general.fields.authEmailCodeTTL"),
            value: formatGeneralValue(generalForm.auth_email_code_ttl_minutes, t("admin.general.units.minutes"))
          },
          {
            label: t("admin.general.fields.authEmailCodeMaxAttempts"),
            value: formatGeneralValue(generalForm.auth_email_code_max_attempts, t("admin.general.units.attempts"))
          },
          {
            label: t("admin.general.fields.authEmailCodeResendCooldown"),
            value: formatGeneralValue(generalForm.auth_email_code_resend_cooldown_seconds, t("admin.general.units.seconds"))
          }
        ])}
      </div>
      <div className="admin-general-subgroup">
        <h6>{t("admin.general.sections.emailCodeRate")}</h6>
        {renderGeneralSummaryItems([
          {
            label: t("admin.general.fields.authEmailCodeEmailWindow"),
            value: formatGeneralValue(generalForm.auth_email_code_email_window_minutes, t("admin.general.units.minutes"))
          },
          {
            label: t("admin.general.fields.authEmailCodeEmailWindowMaxSends"),
            value: formatGeneralValue(generalForm.auth_email_code_email_window_max_sends, t("admin.general.units.times"))
          },
          {
            label: t("admin.general.fields.authEmailCodeIPWindow"),
            value: formatGeneralValue(generalForm.auth_email_code_ip_window_minutes, t("admin.general.units.minutes"))
          },
          {
            label: t("admin.general.fields.authEmailCodeIPWindowMaxSends"),
            value: formatGeneralValue(generalForm.auth_email_code_ip_window_max_sends, t("admin.general.units.times"))
          }
        ])}
      </div>
    </>
  );

  const renderGeneralSection = () => (
    <section className="content-card admin-panel-section">
      <div className="section-header">
        <div className="admin-section-heading">
          <span className="admin-section-icon"><Shield aria-hidden="true" /></span>
          <div>
            <h4>{t("admin.tabs.general.title")}</h4>
          </div>
        </div>
        <Button leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => void loadGeneralSettings()} size="sm" variant="secondary">
          {t("common.refresh")}
        </Button>
      </div>

      {loadingGeneralSettings ? <p className="admin-panel-state">{t("common.loading")}</p> : null}
      <div className="admin-general-form">
        <div className="admin-general-grid">
          {renderGeneralSectionCard(
            "account",
            "admin.general.sections.account",
            "admin.general.sections.accountCopy",
            renderAccountGeneralContent()
          )}

          {renderGeneralSectionCard(
            "terminalFiles",
            "admin.general.sections.terminalFiles",
            "admin.general.sections.terminalFilesCopy",
            renderTerminalFilesGeneralContent()
          )}

          {renderGeneralSectionCard(
            "llm",
            "admin.general.sections.llm",
            "admin.general.sections.llmCopy",
            renderLlmGeneralContent()
          )}

          {renderGeneralSectionCard(
            "smtp",
            "admin.general.sections.smtp",
            "admin.general.sections.smtpCopy",
            renderSmtpGeneralContent()
          )}

          {renderGeneralSectionCard(
            "whitelist",
            "admin.general.sections.whitelist",
            "admin.general.sections.whitelistCopy",
            renderWhitelistGeneralContent()
          )}

          {renderGeneralSectionCard(
            "emailCode",
            "admin.general.sections.emailCode",
            "admin.general.sections.emailCodeCopy",
            renderEmailCodeGeneralContent()
          )}
        </div>
      </div>
    </section>
  );

  const renderUsersSection = () => (
    <section className="content-card admin-panel-section">
      <div className="section-header">
        <div className="admin-section-heading">
          <span className="admin-section-icon"><Users aria-hidden="true" /></span>
          <div>
            <h4>{t("admin.tabs.users.title")}</h4>
          </div>
        </div>
        <Button leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => void loadUsers()} size="sm" variant="secondary">
          {t("common.refresh")}
        </Button>
      </div>

      {loadingUsers ? <p className="admin-panel-state">{t("common.loading")}</p> : null}
      <div className="admin-users-toolbar">
        <TextInput
          aria-label={t("admin.users.search")}
          onChange={(event) => setUserSearch(event.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          type="search"
          value={userSearch}
        />
        <FormField className="admin-users-filter" label={t("admin.users.statusFilter")}>
          {(id) => (
            <SelectInput
              aria-label={t("admin.users.statusFilter")}
              id={id}
              onChange={(event) => setUserStatusFilter(event.target.value as UserStatusFilter)}
              value={userStatusFilter}
            >
              <option value="all">{t("common.all")}</option>
              <option value="active">{t("admin.users.status.active")}</option>
              <option value="disabled">{t("admin.users.status.disabled")}</option>
              <option value="online">{t("admin.users.status.online")}</option>
            </SelectInput>
          )}
        </FormField>
      </div>

      {users.length === 0 && !loadingUsers ? (
        <EmptyState className="admin-panel-empty" description={t("admin.users.emptyCopy")} title={t("admin.users.emptyTitle")}>
          <Button onClick={() => void loadUsers()} size="sm" variant="secondary">
            {t("common.refresh")}
          </Button>
        </EmptyState>
      ) : null}

      {users.length > 0 ? (
        <>
          <DataTable
            className="admin-users-table"
            columns={userColumns}
            columnsTemplate="minmax(190px, 1.25fr) minmax(118px, 0.7fr) minmax(108px, 0.62fr) minmax(82px, 0.46fr) minmax(176px, 0.95fr) minmax(178px, 0.82fr)"
            data={paginatedUsers}
            emptyMessage={t("admin.users.noResults")}
            getRowId={(user) => user.id}
          />
          <div className="admin-pagination-row">
            <span>{t("pagination.summary", { page: Math.min(userPage, userTotalPages), totalPages: userTotalPages, total: filteredUsers.length })}</span>
            <Pagination
              firstLabel={t("pagination.first")}
              label={t("admin.users.pagination")}
              lastLabel={t("pagination.last")}
              nextLabel={t("pagination.next")}
              onPageChange={setUserPage}
              onPageSizeChange={setUserPageSize}
              page={userPage}
              pageSize={userPageSize}
              pageSizeLabel={t("pagination.pageSize")}
              pageSizeOptions={userPageSizeOptions}
              previousLabel={t("pagination.previous")}
              totalPages={userTotalPages}
            />
          </div>
        </>
      ) : null}
    </section>
  );

  const renderSessionsSection = () => (
    <section className="content-card admin-panel-section">
      <div className="section-header">
        <div className="admin-section-heading">
          <span className="admin-section-icon"><Clock3 aria-hidden="true" /></span>
          <div>
            <h4>{t("admin.tabs.sessions.title")}</h4>
          </div>
        </div>
        <Button leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => void loadSessions()} size="sm" variant="secondary">
          {t("common.refresh")}
        </Button>
      </div>

      {loadingSessions ? <p className="admin-panel-state">{t("common.loading")}</p> : null}
      {sessions.length === 0 && !loadingSessions ? (
        <EmptyState className="admin-panel-empty" description={t("admin.sessions.emptyCopy")} title={t("admin.sessions.emptyTitle")} />
      ) : null}

      <div className="admin-table">
        {sessions.map((session) => {
          const deviceLabel = getSessionDeviceLabel(session, t("admin.sessions.deviceUnknown"));
          const userDisplayName = getSessionUserDisplayName(session);
          const userAgentDetail = session.user_agent?.trim() || t("admin.sessions.userAgentEmpty");
          const roleDisplayName = roleNameByKey.get(session.user_role) || roleLabel(session.user_role, t);
          return (
            <article
              aria-label={t("admin.sessions.sessionLabel", { name: userDisplayName, email: session.user_email })}
              className="admin-row admin-session-row"
              key={session.id}
            >
              <div className="admin-session-grid">
                <div className="admin-session-cell admin-session-user" title={session.user_email || undefined}>
                  <span>{t("admin.sessions.user")}</span>
                  <strong>{userDisplayName}</strong>
                </div>
                <div className="admin-session-cell admin-session-role">
                  <span>{t("admin.sessions.role")}</span>
                  <Badge tone={roleTone(session.user_role)}>{roleDisplayName}</Badge>
                </div>
                <div className="admin-session-cell admin-session-device">
                  <span>{t("admin.sessions.device")}</span>
                  <Tooltip content={<span className="admin-session-ua-tooltip">{userAgentDetail}</span>}>
                    <strong className="admin-session-device-label" title={userAgentDetail}>{deviceLabel}</strong>
                  </Tooltip>
                </div>
                <div className="admin-session-cell">
                  <span>{t("admin.sessions.ip")}</span>
                  <strong>{session.client_ip || t("common.unknown")}</strong>
                </div>
                <div className="admin-session-cell">
                  <span>{t("admin.sessions.loginMethod")}</span>
                  <strong>{loginMethodLabel(session.login_method, t)}</strong>
                </div>
                <div className="admin-session-cell">
                  <span>{t("admin.sessions.lastActive")}</span>
                  <strong title={formatDateTime(session.last_seen_at, language, session.last_seen_at)}>{formatRelativeTime(session.last_seen_at, language)}</strong>
                </div>
                <div className="admin-session-cell">
                  <span>{t("admin.sessions.expires")}</span>
                  <strong title={formatDateTime(session.expires_at, language, session.expires_at)}>{formatDateTime(session.expires_at, language, session.expires_at)}</strong>
                </div>
              </div>
              <div className="admin-row-actions">
                <Button
                  disabled={busySessionId === session.id || !canManageSessions}
                  onClick={() => void handleRevokeSession(session)}
                  size="sm"
                  variant="danger"
                >
                  {t("admin.sessions.revokeSession")}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const renderRolesSection = () => (
    <section className="content-card admin-panel-section">
      <div className="section-header">
        <div className="admin-section-heading">
          <span className="admin-section-icon"><SquareAsterisk aria-hidden="true" /></span>
          <div>
            <h4>{t("admin.tabs.roles.title")}</h4>
          </div>
        </div>
        <div className="admin-role-toolbar">
          <Button leadingIcon={<RefreshCw aria-hidden="true" />} onClick={() => void loadRoles()} size="sm" variant="secondary">
            {t("common.refresh")}
          </Button>
          <Button disabled={!canManageRoles} onClick={openCreateRole} size="sm" variant="primary">
            {t("admin.roles.create")}
          </Button>
        </div>
      </div>

      {loadingRoles ? <p className="admin-panel-state">{t("common.loading")}</p> : null}
      {roles.length === 0 && !loadingRoles ? (
        <EmptyState className="admin-panel-empty" description={t("admin.roles.emptyCopy")} title={t("admin.roles.emptyTitle")} />
      ) : null}

      <div className="admin-role-list">
        {roles.map((role) => {
          const isBusy = busyRoleKey === role.key;
          return (
            <article className="admin-role-card" key={role.key}>
              <div className="admin-role-card-head">
                <div className="admin-role-title-block">
                  <div className="admin-role-title-row">
                    <strong>{role.name}</strong>
                    <code>{role.key}</code>
                  </div>
                  <p className="admin-role-description">{role.description || t("common.none")}</p>
                </div>
                <div className="admin-role-card-actions">
                  <Tooltip content={t("admin.roles.details")}>
                    <IconButton label={t("admin.roles.details")} onClick={() => openRoleDetails(role)} variant="neutral">
                      <Info aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content={t("common.edit")}>
                    <IconButton disabled={isBusy || !canManageRoles} label={t("common.edit")} onClick={() => openEditRole(role)} variant="neutral">
                      <Edit3 aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                  {role.is_system ? (
                    <Tooltip content={t("admin.roles.systemDeleteBlocked")}>
                      <IconButton disabled label={t("admin.roles.systemDeleteBlocked")} variant="danger">
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Tooltip content={t("common.delete")}>
                      <IconButton disabled={isBusy || !canManageRoles} label={t("common.delete")} onClick={() => void handleDeleteRole(role)} variant="danger">
                        <Trash2 aria-hidden="true" />
                      </IconButton>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div className="admin-role-card-body">
                <div className="admin-role-meta">
                  <Badge tone={role.is_active ? "success" : "neutral"}>{role.is_active ? t("admin.roles.active") : t("admin.roles.inactive")}</Badge>
                  <Badge tone={role.is_system ? "info" : "neutral"}>{role.is_system ? t("admin.roles.system") : t("admin.roles.custom")}</Badge>
                  <span>{t("admin.roles.users", { count: role.user_count })}</span>
                </div>
                {renderPermissionSummary(role)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const renderDatabaseSection = () => (
    <section className="content-card admin-panel-section">
      <div className="section-header">
        <div className="admin-section-heading">
          <span className="admin-section-icon"><DatabaseBackup aria-hidden="true" /></span>
          <div>
            <h4>{t("admin.tabs.database.title")}</h4>
          </div>
        </div>
      </div>
      <div className="admin-database-grid">
        <article className="admin-database-card">
          <div className="admin-database-card-copy">
            <span className="admin-database-card-icon"><Download aria-hidden="true" /></span>
            <div>
              <strong>{t("admin.database.exportTitle")}</strong>
              <p>{t("admin.database.exportCopy")}</p>
            </div>
          </div>
          <Button
            disabled={!canManageDatabase || databaseBusy !== null}
            leadingIcon={<Download aria-hidden="true" />}
            onClick={() => void handleExportDatabase()}
            variant="secondary"
          >
            {databaseBusy === "export" ? t("common.loading") : t("admin.database.exportJson")}
          </Button>
        </article>
        <article className="admin-database-card">
          <div className="admin-database-card-copy">
            <span className="admin-database-card-icon"><FileUp aria-hidden="true" /></span>
            <div>
              <strong>{t("admin.database.importTitle")}</strong>
              <p>{t("admin.database.importCopy")}</p>
            </div>
          </div>
          <label className={`ui-button ui-button-secondary ui-button-md admin-database-upload${!canManageDatabase || databaseBusy !== null ? " admin-database-upload-disabled" : ""}`}>
            <FileUp aria-hidden="true" />
            <span>{databaseBusy === "import" ? t("common.loading") : t("admin.database.importJson")}</span>
            <input
              accept="application/json,.json"
              aria-label={t("admin.database.importInput")}
              disabled={!canManageDatabase || databaseBusy !== null}
              onChange={(event) => void handleImportDatabase(event)}
              type="file"
            />
          </label>
        </article>
      </div>
      <p className="admin-database-note">{t("admin.database.backupNote")}</p>
    </section>
  );

  return (
    <div className="route-page admin-page">
      <div className="admin-page-header">
        <div>
          <p className="eyebrow route-eyebrow">{t("admin.eyebrow")}</p>
          <h1>{t("admin.title")}</h1>
        </div>
        <Button leadingIcon={<RefreshCw aria-hidden="true" />} onClick={refreshCurrentTab} variant="secondary">
          {t("common.refresh")}
        </Button>
      </div>

      <div className="admin-summary-strip">
        {summaryCards.map((card) => (
          <article className="admin-summary-card" key={card.label}>
            <span className="admin-summary-icon">{card.icon}</span>
            <div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </div>
          </article>
        ))}
      </div>

      <SegmentedControl
        ariaLabel={t("admin.tabs.aria")}
        items={tabItems}
        onChange={(value) => setTab(value as AdminTabKey)}
        value={tab}
      />

      {errorMessage ? <p className="admin-panel-state admin-panel-state-error">{errorMessage}</p> : null}

      {tab === "users" ? renderUsersSection() : null}
      {tab === "sessions" ? renderSessionsSection() : null}
      {tab === "roles" ? renderRolesSection() : null}
      {tab === "general" ? renderGeneralSection() : null}
      {tab === "database" ? renderDatabaseSection() : null}

      {renderRoleDetailsDialog()}
      <Dialog
        closeLabel={t("common.close")}
        contentClassName="admin-role-dialog"
        footer={(
          <div className="admin-role-dialog-footer">
            <label className="admin-role-footer-toggle">
              <input
                aria-label={t("admin.roles.enableToggle")}
                checked={roleForm.is_active}
                onChange={(event) => setRoleForm((current) => ({ ...current, is_active: event.target.checked }))}
                type="checkbox"
              />
              <span>{t("admin.roles.enableToggle")}</span>
            </label>
            <div className="admin-role-dialog-actions">
              <Button onClick={closeRoleDialog} variant="secondary">{t("common.cancel")}</Button>
              <Button disabled={busyRoleKey !== null} form="admin-role-form" type="submit" variant="primary">
                {roleDialogMode === "create" ? t("admin.roles.create") : t("common.save")}
              </Button>
            </div>
          </div>
        )}
        onOpenChange={(open) => {
          if (!open) {
            closeRoleDialog();
          }
        }}
        open={roleDialogOpen}
        size="lg"
        title={roleDialogMode === "create" ? t("admin.roles.createTitle") : t("admin.roles.editTitle")}
      >
        <form className="admin-role-form" id="admin-role-form" onSubmit={handleSubmitRole}>
          <div className="admin-role-form-grid">
            <FormField label={t("admin.roles.key")}>
              {(id) => (
                <TextInput
                  disabled={roleDialogMode === "edit"}
                  id={id}
                  onChange={(event) => setRoleForm((current) => ({ ...current, key: event.target.value }))}
                  required
                  value={roleForm.key}
                />
              )}
            </FormField>
            <FormField label={t("common.name")}>
              {(id) => (
                <TextInput
                  id={id}
                  onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                  required
                  value={roleForm.name}
                />
              )}
            </FormField>
          </div>
          <FormField label={t("admin.roles.description")}>
            {(id) => (
              <TextareaInput
                id={id}
                onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                value={roleForm.description}
              />
            )}
          </FormField>
          <div className="admin-role-permission-list">
            {getDefinitionGroups().filter((group) => group.permissions.length > 0).map((group) => {
              const allSelected = group.permissions.every((permission) => roleForm.permissions.includes(permission));
              return (
                <section className="admin-permission-picker-group" key={group.key}>
                  <div className="admin-permission-picker-head">
                    <h5>{group.title}</h5>
                    <label className="admin-check-inline">
                      <input
                        aria-label={t("admin.permissions.selectGroup", { group: group.title })}
                        checked={allSelected}
                        onChange={() => handleTogglePermissionGroup(group.permissions)}
                        type="checkbox"
                      />
                      <span>{t("admin.permissions.selectAll")}</span>
                    </label>
                  </div>
                  <div className="admin-permission-picker-items">
                    {group.permissions.map((permission) => (
                      <label className="admin-permission-picker-item" key={permission}>
                        <input
                          checked={roleForm.permissions.includes(permission)}
                          onChange={() => handleToggleRolePermission(permission)}
                          type="checkbox"
                        />
                        <span>
                          <strong>{getPermissionLabel(permission)}</strong>
                          <small>{getPermissionDescription(permission)}</small>
                          <code>{permission}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </form>
      </Dialog>
      <Dialog
        closeLabel={t("common.close")}
        footer={(
          <div className="admin-role-dialog-footer">
            <Button onClick={closeUserRoleDialog} variant="secondary">{t("common.cancel")}</Button>
            <Button disabled={busyUserId !== null} form="admin-user-role-form" type="submit" variant="primary">
              {t("admin.roles.changeConfirm")}
            </Button>
          </div>
        )}
        onOpenChange={(open) => {
          if (!open) {
            closeUserRoleDialog();
          }
        }}
        open={Boolean(userRoleDialogUser)}
        size="sm"
        title={t("admin.roles.changeTitle")}
      >
        <form className="admin-user-role-form" id="admin-user-role-form" onSubmit={handleSubmitUserRole}>
          {userRoleDialogUser ? (
            <p className="admin-user-role-target">
              <strong>{userRoleDialogUser.display_name}</strong>
              <span>{userRoleDialogUser.email}</span>
            </p>
          ) : null}
          <FormField label={t("admin.roles.current")}>
            {(id) => (
              <SelectInput
                aria-label={t("admin.roles.change")}
                id={id}
                onChange={(event) => setUserRoleValue(event.target.value)}
                value={userRoleValue}
              >
                {userRoleOptions.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
        </form>
      </Dialog>
    </div>
  );
}
