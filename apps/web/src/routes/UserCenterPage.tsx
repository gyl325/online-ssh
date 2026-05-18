import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { Check, Copy, KeyRound, Mail, Palette, Pencil, Plus, Shield, Trash2, UserRound } from "lucide-react";

import {
  changeAccountEmail,
  changeAccountPassword,
  confirmMfaSetup,
  deleteAccount,
  disableMfa,
  getMfaStatus,
  regenerateMfaRecoveryCodes,
  sendAccountEmailCode,
  setupMfa
} from "../features/account/api";
import type { MfaStatusResponse, SetupMfaResponse } from "../features/account/types";
import { getApiErrorMessage } from "../features/auth/api";
import { useAuth } from "../features/auth/AuthContext";
import { usePreferences, type AppLanguage, type AppTheme } from "../features/preferences/PreferencesContext";
import {
  buildTerminalHighlightRules,
  builtinTerminalHighlightRules,
  scanTerminalLine,
  transparentTerminalHighlightBackground,
  validateTerminalHighlightRule,
  type TerminalHighlightCustomRule,
  type TerminalHighlightMatchType
} from "../features/terminal/highlighting";
import { terminalFontFamily, terminalThemeFor, terminalThemeOptions, type TerminalThemePreference } from "../features/terminal/theme";
import { useConfirmDialog } from "../features/ui/ConfirmDialogContext";
import { useToast } from "../features/ui/ToastContext";
import { copyTextToClipboard } from "../shared/lib/clipboard";
import { formatDateTime } from "../shared/lib/date";
import { AuthCodeField, Badge, Button, Dialog, FormField, IconButton, PasswordInput, SegmentedControl, SelectInput, StepProgress, TextInput } from "../shared/ui";

type UserCenterTabKey = "account" | "appearance" | "security";
type MfaSetupStep = "password" | "scan" | "code" | "recovery";
type MfaManagementAction = "regenerate" | "disable";
type MfaVerificationMethod = "totp" | "recovery_code";

const userCenterTabs: Array<{ icon: ReactNode; key: UserCenterTabKey; labelKey: string }> = [
  { key: "account", icon: <UserRound aria-hidden="true" />, labelKey: "profile.tabs.account" },
  { key: "appearance", icon: <Palette aria-hidden="true" />, labelKey: "profile.tabs.appearance" },
  { key: "security", icon: <Shield aria-hidden="true" />, labelKey: "profile.tabs.security" }
];

const emptyHighlightDraft: TerminalHighlightCustomRule = {
  id: "",
  name: "",
  enabled: true,
  matchType: "keyword",
  pattern: "",
  caseSensitive: false,
  foregroundColor: "#ffffff",
  backgroundColor: transparentTerminalHighlightBackground,
  priority: 10
};

function colorPickerValue(color: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000";
}

function HighlightColorControl({
  allowTransparent = false,
  ariaLabel,
  color,
  label,
  onChange,
  transparentLabel,
  transparentText
}: {
  allowTransparent?: boolean;
  ariaLabel: string;
  color: string;
  label: string;
  onChange: (color: string) => void;
  transparentLabel?: string;
  transparentText?: string;
}) {
  const isTransparent = color === transparentTerminalHighlightBackground;

  return (
    <div className="user-center-color-control">
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={isTransparent ? "user-center-color-swatch user-center-color-swatch-transparent" : "user-center-color-swatch"}
        style={isTransparent ? undefined : { backgroundColor: color }}
      />
      <input
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        type="color"
        value={colorPickerValue(color)}
      />
      {allowTransparent ? (
        <button
          aria-label={transparentLabel}
          aria-pressed={isTransparent}
          className="user-center-transparent-color-button"
          onClick={() => onChange(transparentTerminalHighlightBackground)}
          type="button"
        >
          {transparentText}
        </button>
      ) : null}
    </div>
  );
}

function formatUserCenterDateTime(value: string | null | undefined, locale: string, emptyFallback = "--") {
  return formatDateTime(value, locale, value || emptyFallback);
}

function formatMfaLastUsed(value: string | null | undefined, locale: string, t: (key: string) => string) {
  return value ? formatUserCenterDateTime(value, locale) : t("profile.mfa.neverUsed");
}

function loginMethodLabel(method: string | undefined | null, t: (key: string) => string) {
  if (!method) {
    return "--";
  }
  const key = `profile.account.loginMethod.${method}`;
  const translated = t(key);
  return translated === key ? method : translated;
}

function normalizeRecoveryCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (compact.length <= 4) {
    return compact;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function SecretInput({
  autoComplete,
  hideLabel,
  label,
  onChange,
  showLabel,
  value
}: {
  autoComplete: string;
  hideLabel: string;
  label: string;
  onChange: (value: string) => void;
  showLabel: string;
  value: string;
}) {
  return (
    <FormField label={label}>
      {(id) => (
        <PasswordInput
          autoComplete={autoComplete}
          hideLabel={hideLabel}
          id={id}
          label={label}
          onChange={(event) => onChange(event.target.value)}
          showLabel={showLabel}
          value={value}
        />
      )}
    </FormField>
  );
}

type AuthCodeInputProps = {
  id: string;
  label: string;
  length: number;
  onChange: (value: string) => void;
  translations: {
    digit: string;
    digitOf: string;
  };
  value: string;
};

function AuthCodeInput({ id, label, length, onChange, translations, value }: AuthCodeInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const fieldId = useId();
  const normalizedLength = Math.max(1, Math.min(length, 8));
  const digits = value.replace(/\D/g, "").slice(0, normalizedLength).padEnd(normalizedLength, " ").split("");

  const setCode = (nextDigits: string[], focusIndex?: number) => {
    onChange(nextDigits.join("").replace(/\D/g, "").slice(0, normalizedLength));
    if (typeof focusIndex === "number") {
      window.requestAnimationFrame(() => inputRefs.current[focusIndex]?.focus());
    }
  };

  const handleChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const incoming = event.target.value.replace(/\D/g, "");
    const nextDigits = digits.map((digit) => (digit === " " ? "" : digit));
    if (incoming.length > 1) {
      incoming.slice(0, normalizedLength - index).split("").forEach((digit, offset) => {
        nextDigits[index + offset] = digit;
      });
      setCode(nextDigits, Math.min(normalizedLength - 1, index + incoming.length));
      return;
    }
    nextDigits[index] = incoming;
    setCode(nextDigits, incoming ? Math.min(normalizedLength - 1, index + 1) : index);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index].trim() && index > 0) {
      event.preventDefault();
      const nextDigits = digits.map((digit) => (digit === " " ? "" : digit));
      nextDigits[index - 1] = "";
      setCode(nextDigits, index - 1);
    }
  };

  return (
    <div
      aria-label={label}
      className="auth-code-input"
      role="group"
      style={{ "--auth-code-length": normalizedLength } as CSSProperties & Record<string, number>}
    >
      {Array.from({ length: normalizedLength }, (_, index) => (
        <input
          aria-label={`${translations.digit} ${index + 1}`}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          className="auth-code-digit"
          id={index === 0 ? id : undefined}
          inputMode="numeric"
          key={`${fieldId}-${index}`}
          maxLength={normalizedLength}
          onChange={(event) => handleChange(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          pattern="[0-9]*"
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          required
          title={translations.digitOf.replace("{{index}}", String(index + 1)).replace("{{total}}", String(normalizedLength))}
          type="text"
          value={digits[index].trim()}
        />
      ))}
    </div>
  );
}

function renderPreviewLine(text: string, rules: ReturnType<typeof buildTerminalHighlightRules>["rules"]) {
  const matches = scanTerminalLine(text, rules);
  const chunks: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (match.start > cursor) {
      chunks.push(<span key={`text-${index}-${cursor}`}>{text.slice(cursor, match.start)}</span>);
    }
    chunks.push(
      <span
        className="user-center-terminal-preview-highlight"
        key={`match-${match.ruleId}-${match.start}-${match.end}`}
        style={{
          backgroundColor: match.backgroundColor,
          color: match.foregroundColor
        }}
      >
        {text.slice(match.start, match.end)}
      </span>
    );
    cursor = match.end;
  });

  if (cursor < text.length) {
    chunks.push(<span key={`text-tail-${cursor}`}>{text.slice(cursor)}</span>);
  }

  return chunks.length > 0 ? chunks : text;
}

export function UserCenterPage() {
  const auth = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const {
    language,
    setLanguage,
    theme,
    setTheme,
    effectiveTheme,
    terminalFontSize,
    setTerminalFontSize,
    terminalHighlightPreferences,
    setTerminalHighlightPreferences,
    terminalTheme,
    setTerminalTheme,
    t
  } = usePreferences();
  const [tab, setTab] = useState<UserCenterTabKey>("account");
  const [fontSizeInput, setFontSizeInput] = useState(String(terminalFontSize));
  const [highlightDraft, setHighlightDraft] = useState<TerminalHighlightCustomRule>(emptyHighlightDraft);
  const [highlightDraftOpen, setHighlightDraftOpen] = useState(false);
  const [editingHighlightRuleId, setEditingHighlightRuleId] = useState<string | null>(null);
  const [highlightRulesDialogOpen, setHighlightRulesDialogOpen] = useState(false);
  const [passwordStep, setPasswordStep] = useState(0);
  const [emailStep, setEmailStep] = useState(0);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [emailForm, setEmailForm] = useState({
    currentEmailCode: "",
    newEmail: "",
    newEmailCode: ""
  });
  const [deletePassword, setDeletePassword] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatusResponse | null>(null);
  const [mfaSetup, setMfaSetup] = useState<SetupMfaResponse | null>(null);
  const [mfaSetupDialogOpen, setMfaSetupDialogOpen] = useState(false);
  const [mfaRecoveryDialogOpen, setMfaRecoveryDialogOpen] = useState(false);
  const [mfaSetupStep, setMfaSetupStep] = useState<MfaSetupStep>("password");
  const [mfaSetupPassword, setMfaSetupPassword] = useState("");
  const [mfaSetupCode, setMfaSetupCode] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [mfaCopiedTarget, setMfaCopiedTarget] = useState<"secret" | "recovery" | null>(null);
  const [mfaManagementAction, setMfaManagementAction] = useState<MfaManagementAction | null>(null);
  const [mfaVerificationMethod, setMfaVerificationMethod] = useState<MfaVerificationMethod>("totp");
  const [mfaVerificationForm, setMfaVerificationForm] = useState({
    password: "",
    code: "",
    recoveryCode: ""
  });

  useEffect(() => {
    setFontSizeInput(String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    let disposed = false;
    const loadMfaStatus = async () => {
      try {
        const status = await getMfaStatus();
        if (!disposed) {
          setMfaStatus(status);
        }
      } catch {
        if (!disposed) {
          setMfaStatus({ enabled: false, recovery_code_count: 0 });
        }
      }
    };
    void loadMfaStatus();
    return () => {
      disposed = true;
    };
  }, []);

  const user = auth.user;
  const session = auth.session;
  const previewTheme = terminalThemeFor(effectiveTheme, terminalTheme);
  const previewHighlightRules = useMemo(
    () => buildTerminalHighlightRules(terminalHighlightPreferences).rules,
    [terminalHighlightPreferences]
  );
  const previewLines = useMemo(
    () => [
      `${t("profile.appearance.previewPrompt")} ${t("profile.appearance.previewCommand")}`,
      t("profile.appearance.previewError"),
      t("profile.appearance.previewWarning"),
      t("profile.appearance.previewSuccess")
    ],
    [t]
  );
  const tabItems = userCenterTabs.map((item) => ({
    label: (
      <span className="user-center-tab-label">
        {item.icon}
        {t(item.labelKey)}
      </span>
    ),
    value: item.key
  }));
  const mfaSetupSteps = [
    { title: t("profile.mfa.stepPassword"), description: t("profile.mfa.stepPasswordCopy") },
    { title: t("profile.mfa.stepScan"), description: t("profile.mfa.stepScanCopy") },
    { title: t("profile.mfa.stepCode"), description: t("profile.mfa.stepCodeCopy") },
    { title: t("profile.mfa.stepRecovery"), description: t("profile.mfa.stepRecoveryCopy") }
  ];
  const mfaSetupStepIndex = {
    password: 0,
    scan: 1,
    code: 2,
    recovery: 3
  }[mfaSetupStep];
  const mfaVerificationMethodItems: Array<{ label: string; value: MfaVerificationMethod }> = [
    { label: t("profile.mfa.methodTotp"), value: "totp" },
    { label: t("profile.mfa.methodRecoveryCode"), value: "recovery_code" }
  ];
  const accountSummary = useMemo(() => [
    { label: t("profile.account.displayName"), value: user?.display_name || "--" },
    { label: t("profile.account.email"), value: user?.email || "--" },
    { label: t("profile.account.status"), value: user?.status || "--" },
    { label: t("profile.account.authType"), value: user?.auth_type || "--" },
    { label: t("profile.account.createdAt"), value: formatUserCenterDateTime(user?.created_at, language) }
  ], [language, t, user]);
  const sessionSummary = useMemo(() => [
    { label: t("profile.account.sessionDevice"), value: session?.device_label || t("common.unknown") },
    { label: t("profile.account.sessionIP"), value: session?.client_ip || t("common.unknown") },
    { label: t("profile.account.sessionMethod"), value: loginMethodLabel(session?.login_method, t) },
    { label: t("profile.account.sessionLastSeen"), value: formatUserCenterDateTime(session?.last_seen_at, language) },
    { label: t("profile.account.sessionExpires"), value: formatUserCenterDateTime(session?.expires_at, language) }
  ], [language, session, t]);

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setFontSizeInput(nextValue);
    if (nextValue.trim() === "") {
      return;
    }
    const nextNumber = Number(nextValue);
    if (Number.isFinite(nextNumber)) {
      setTerminalFontSize(nextNumber);
    }
  };

  const updateHighlightPreferences = (nextPreferences: typeof terminalHighlightPreferences) => {
    setTerminalHighlightPreferences(nextPreferences);
  };

  const handleHighlightEnabledChange = (enabled: boolean) => {
    updateHighlightPreferences({
      ...terminalHighlightPreferences,
      enabled
    });
  };

  const handleBuiltinHighlightRuleChange = (
    ruleId: string,
    patch: { enabled?: boolean; foregroundColor?: string; backgroundColor?: string; priority?: number }
  ) => {
    updateHighlightPreferences({
      ...terminalHighlightPreferences,
      builtinRules: {
        ...terminalHighlightPreferences.builtinRules,
        [ruleId]: {
          ...terminalHighlightPreferences.builtinRules[ruleId],
          ...patch
        }
      }
    });
  };

  const openNewHighlightRuleForm = () => {
    setHighlightDraft({ ...emptyHighlightDraft });
    setEditingHighlightRuleId(null);
    setHighlightDraftOpen(true);
  };

  const openEditHighlightRuleForm = (rule: TerminalHighlightCustomRule) => {
    setHighlightDraft({ ...rule });
    setEditingHighlightRuleId(rule.id);
    setHighlightDraftOpen(true);
  };

  const handleHighlightDraftChange = <Key extends keyof TerminalHighlightCustomRule>(
    key: Key,
    value: TerminalHighlightCustomRule[Key]
  ) => {
    setHighlightDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleSaveHighlightRule = () => {
    const draft: TerminalHighlightCustomRule = {
      ...highlightDraft,
      id: editingHighlightRuleId || highlightDraft.id || `custom-${Date.now().toString(36)}`,
      name: highlightDraft.name.trim(),
      pattern: highlightDraft.pattern.trim(),
      priority: Number.isFinite(Number(highlightDraft.priority)) ? Math.round(Number(highlightDraft.priority)) : 10
    };
    const issues = validateTerminalHighlightRule(draft);
    if (!draft.name || issues.some((issue) => issue.code !== "COMPLEX_REGEX")) {
      toast.error(t("profile.appearance.highlightRuleInvalid"));
      return;
    }
    if (issues.some((issue) => issue.code === "COMPLEX_REGEX")) {
      toast.error(t("profile.appearance.highlightRuleComplex"));
      return;
    }

    const customRules = editingHighlightRuleId
      ? terminalHighlightPreferences.customRules.map((rule) => (rule.id === editingHighlightRuleId ? draft : rule))
      : [...terminalHighlightPreferences.customRules, draft];

    updateHighlightPreferences({
      ...terminalHighlightPreferences,
      customRules
    });
    setHighlightDraft({ ...emptyHighlightDraft });
    setEditingHighlightRuleId(null);
    setHighlightDraftOpen(false);
  };

  const handleDeleteHighlightRule = (ruleId: string) => {
    updateHighlightPreferences({
      ...terminalHighlightPreferences,
      customRules: terminalHighlightPreferences.customRules.filter((rule) => rule.id !== ruleId)
    });
    if (editingHighlightRuleId === ruleId) {
      setHighlightDraft({ ...emptyHighlightDraft });
      setEditingHighlightRuleId(null);
      setHighlightDraftOpen(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error(t("profile.security.passwordMismatch"));
      return;
    }
    if (passwordForm.newPassword === passwordForm.currentPassword) {
      toast.error(t("profile.security.passwordSameAsCurrent"));
      return;
    }
    setBusyAction("password");
    try {
      await changeAccountPassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordStep(0);
      toast.success(t("profile.security.passwordSaved"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.security.passwordFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendCurrentEmailCode = async () => {
    setBusyAction("current-email-code");
    try {
      await sendAccountEmailCode({ stage: "current" });
      toast.success(t("profile.security.emailCodeSent"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.security.emailFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendNewEmailCode = async () => {
    setBusyAction("new-email-code");
    try {
      await sendAccountEmailCode({ stage: "new", email: emailForm.newEmail });
      toast.success(t("profile.security.emailCodeSent"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.security.emailFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction("email");
    try {
      await changeAccountEmail({
        current_email_code: emailForm.currentEmailCode,
        new_email: emailForm.newEmail,
        new_email_code: emailForm.newEmailCode
      });
      setEmailForm({ currentEmailCode: "", newEmail: "", newEmailCode: "" });
      await auth.refreshSession();
      toast.success(t("profile.security.emailChanged"));
      setEmailStep(0);
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.security.emailFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deletePassword.trim()) {
      return;
    }
    const confirmed = await confirmDialog.requestConfirmation({
      title: t("profile.account.deleteConfirmTitle"),
      message: t("profile.account.deleteConfirmMessage"),
      confirmLabel: t("profile.account.deleteConfirm"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setBusyAction("delete");
    try {
      await deleteAccount({ current_password: deletePassword });
      toast.success(t("profile.account.deleteSuccess"));
      await auth.signOut();
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.account.deleteFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const reloadMfaStatus = async () => {
    const status = await getMfaStatus();
    setMfaStatus(status);
  };

  const resetMfaSetupDialog = () => {
    setMfaSetup(null);
    setMfaSetupPassword("");
    setMfaSetupCode("");
    setMfaRecoveryCodes([]);
    setMfaCopiedTarget(null);
    setMfaSetupStep("password");
  };

  const handleMfaSetupDialogOpenChange = (open: boolean) => {
    if (!open && mfaSetupStep === "recovery") {
      return;
    }
    setMfaSetupDialogOpen(open);
    if (!open) {
      resetMfaSetupDialog();
    }
  };

  const handleOpenMfaSetup = () => {
    resetMfaSetupDialog();
    setMfaSetupDialogOpen(true);
  };

  const handleCopyMfaValue = async (target: "secret" | "recovery", value: string) => {
    if (!value) {
      return;
    }
    try {
      const copied = await copyTextToClipboard(value);
      if (!copied) {
        throw new Error("clipboard unavailable");
      }
      setMfaCopiedTarget(target);
      window.setTimeout(() => setMfaCopiedTarget((current) => current === target ? null : current), 1800);
      toast.success(target === "secret" ? t("profile.mfa.secretCopied") : t("profile.mfa.recoveryCopied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  const handleStartMfaSetup = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!mfaSetupPassword.trim()) {
      toast.error(t("profile.mfa.passwordRequired"));
      return;
    }
    setBusyAction("mfa-setup");
    try {
      const setup = await setupMfa({ password: mfaSetupPassword });
      setMfaSetup(setup);
      setMfaSetupCode("");
      setMfaRecoveryCodes([]);
      setMfaSetupStep("scan");
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.mfa.setupFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmMfaSetup = async () => {
    setBusyAction("mfa-confirm");
    try {
      const result = await confirmMfaSetup({ code: mfaSetupCode });
      setMfaRecoveryCodes(result.recovery_codes);
      setMfaSetupStep("recovery");
      await reloadMfaStatus();
      toast.success(t("profile.mfa.enabled"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.mfa.confirmFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRecoveryCodesSaved = () => {
    resetMfaSetupDialog();
    setMfaSetupDialogOpen(false);
    setMfaRecoveryDialogOpen(false);
    void reloadMfaStatus();
  };

  const mfaVerificationPayload = () => ({
    password: mfaVerificationForm.password,
    ...(mfaVerificationMethod === "recovery_code"
      ? { recovery_code: normalizeRecoveryCode(mfaVerificationForm.recoveryCode) }
      : { code: mfaVerificationForm.code })
  });

  const resetMfaManagementDialog = () => {
    setMfaManagementAction(null);
    setMfaVerificationMethod("totp");
    setMfaVerificationForm({ password: "", code: "", recoveryCode: "" });
  };

  const openMfaManagementDialog = (action: MfaManagementAction) => {
    setMfaManagementAction(action);
    setMfaVerificationMethod("totp");
    setMfaVerificationForm({ password: "", code: "", recoveryCode: "" });
  };

  const mfaManagementSubmitDisabled =
    !mfaVerificationForm.password.trim() ||
    (mfaVerificationMethod === "recovery_code"
      ? !mfaVerificationForm.recoveryCode.trim()
      : mfaVerificationForm.code.length !== 6);

  const handleRegenerateMfaRecoveryCodes = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!mfaVerificationForm.password.trim()) {
      toast.error(t("profile.mfa.passwordRequired"));
      return;
    }
    setBusyAction("mfa-regenerate");
    try {
      const result = await regenerateMfaRecoveryCodes(mfaVerificationPayload());
      setMfaRecoveryCodes(result.recovery_codes);
      setMfaCopiedTarget(null);
      setMfaRecoveryDialogOpen(true);
      resetMfaManagementDialog();
      await reloadMfaStatus();
      toast.success(t("profile.mfa.recoveryRegenerated"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.mfa.regenerateFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisableMfa = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!mfaVerificationForm.password.trim()) {
      toast.error(t("profile.mfa.passwordRequired"));
      return;
    }
    setBusyAction("mfa-disable");
    try {
      await disableMfa(mfaVerificationPayload());
      setMfaSetup(null);
      setMfaRecoveryCodes([]);
      setMfaSetupCode("");
      resetMfaManagementDialog();
      await reloadMfaStatus();
      toast.success(t("profile.mfa.disabled"));
    } catch (error) {
      toast.error(getApiErrorMessage(error, t("profile.mfa.disableFailed"), t));
    } finally {
      setBusyAction(null);
    }
  };

  const renderAccount = () => (
    <section className="user-center-section">
      <article className="user-center-card">
        <div className="user-center-card-heading">
          <span className="user-center-card-icon"><UserRound aria-hidden="true" /></span>
          <div>
            <h2>{t("profile.account.title")}</h2>
            <p>{t("profile.account.copy")}</p>
          </div>
        </div>
        <dl className="user-center-info-grid">
          {accountSummary.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </article>

      <article className="user-center-card">
        <div className="user-center-card-heading">
          <span className="user-center-card-icon"><Shield aria-hidden="true" /></span>
          <div>
            <h2>{t("profile.account.sessionTitle")}</h2>
            <p>{t("profile.account.sessionCopy")}</p>
          </div>
        </div>
        <dl className="user-center-info-grid">
          {sessionSummary.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </article>

      <form aria-label={t("profile.account.deleteTitle")} className="user-center-card user-center-danger-card" onSubmit={handleDeleteAccount}>
        <div className="user-center-card-heading">
          <span className="user-center-card-icon user-center-card-icon-danger"><Trash2 aria-hidden="true" /></span>
          <div>
            <h2>{t("profile.account.deleteTitle")}</h2>
            <p>{t("profile.account.deleteCopy")}</p>
          </div>
        </div>
        <div className="user-center-form-row">
          <SecretInput
            autoComplete="current-password"
            hideLabel={t("auth.hidePassword")}
            label={t("profile.account.deletePassword")}
            showLabel={t("auth.showPassword")}
            onChange={setDeletePassword}
            value={deletePassword}
          />
          <Button disabled={busyAction === "delete" || !deletePassword.trim()} type="submit" variant="danger">
            {busyAction === "delete" ? t("common.deleting") : t("profile.account.deleteConfirm")}
          </Button>
        </div>
      </form>
    </section>
  );

  const renderHighlightRulesDialog = () => (
    <Dialog
      closeLabel={t("common.close")}
      description={t("profile.appearance.highlightCopy")}
      onOpenChange={(open) => setHighlightRulesDialogOpen(open)}
      open={highlightRulesDialogOpen}
      size="lg"
      title={t("profile.appearance.highlightRulesDialogTitle")}
    >
      <div className="user-center-highlight-dialog">
        <section className="user-center-highlight-section" aria-label={t("profile.appearance.builtinRules")}>
          <div className="user-center-highlight-section-heading">
            <h3>{t("profile.appearance.builtinRules")}</h3>
            <span>{t("profile.appearance.builtinRulesHint")}</span>
          </div>
          <div className="user-center-highlight-rule-list">
            {builtinTerminalHighlightRules.map((rule) => {
              const override = terminalHighlightPreferences.builtinRules[rule.id] || {};
              const enabled = override.enabled ?? rule.enabled;
              const foregroundColor = override.foregroundColor || rule.foregroundColor;
              const backgroundColor = override.backgroundColor || rule.backgroundColor;
              const patternLabel = rule.matchType === "regex" ? "regex" : rule.pattern.replaceAll("\n", ", ");
              const patternTitle = rule.matchType === "regex" ? rule.pattern : patternLabel;
              return (
                <div className="user-center-highlight-rule-row" key={rule.id}>
                  <label className="user-center-inline-toggle user-center-highlight-rule-toggle">
                    <input
                      checked={enabled}
                      onChange={(event) => handleBuiltinHighlightRuleChange(rule.id, { enabled: event.target.checked })}
                      type="checkbox"
                    />
                    <span>{rule.name}</span>
                  </label>
                  <span className="user-center-highlight-pattern" title={patternTitle}>{patternLabel}</span>
                  <HighlightColorControl
                    ariaLabel={`${rule.name} ${t("profile.appearance.foregroundColor")}`}
                    color={foregroundColor}
                    label={t("profile.appearance.foregroundColor")}
                    onChange={(color) => handleBuiltinHighlightRuleChange(rule.id, { foregroundColor: color })}
                  />
                  <HighlightColorControl
                    allowTransparent
                    ariaLabel={`${rule.name} ${t("profile.appearance.backgroundColor")}`}
                    color={backgroundColor}
                    label={t("profile.appearance.backgroundColor")}
                    onChange={(color) => handleBuiltinHighlightRuleChange(rule.id, { backgroundColor: color })}
                    transparentLabel={`${rule.name} ${t("profile.appearance.backgroundColor")}${t("profile.appearance.setTransparentSuffix")}`}
                    transparentText={t("profile.appearance.transparentColor")}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="user-center-highlight-section" aria-label={t("profile.appearance.customRules")}>
          <div className="user-center-highlight-section-heading">
            <h3>{t("profile.appearance.customRules")}</h3>
            <Button className="user-center-highlight-add-rule-button" leadingIcon={<Plus aria-hidden="true" />} onClick={openNewHighlightRuleForm} size="sm" type="button" variant="secondary">
              {t("profile.appearance.addHighlightRule")}
            </Button>
          </div>

          {terminalHighlightPreferences.customRules.length > 0 ? (
            <div className="user-center-highlight-rule-list">
              {terminalHighlightPreferences.customRules.map((rule) => (
                <div className="user-center-highlight-rule-row" key={rule.id}>
                  <label className="user-center-inline-toggle user-center-highlight-rule-toggle">
                    <input
                      checked={rule.enabled}
                      onChange={(event) =>
                        updateHighlightPreferences({
                          ...terminalHighlightPreferences,
                          customRules: terminalHighlightPreferences.customRules.map((currentRule) =>
                            currentRule.id === rule.id ? { ...currentRule, enabled: event.target.checked } : currentRule
                          )
                        })
                      }
                      type="checkbox"
                    />
                    <span>{rule.name}</span>
                  </label>
                  <span className="user-center-highlight-pattern" title={rule.pattern}>{rule.pattern}</span>
                  <span className="user-center-highlight-priority">{t("profile.appearance.priorityValue", { priority: rule.priority })}</span>
                  <div className="user-center-highlight-actions">
                    <Button onClick={() => openEditHighlightRuleForm(rule)} size="sm" type="button" variant="secondary">
                      {t("common.edit")}
                    </Button>
                    <Button
                      aria-label={t("profile.appearance.deleteHighlightRule", { name: rule.name })}
                      onClick={() => handleDeleteHighlightRule(rule.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="user-center-highlight-empty">{t("profile.appearance.customRulesEmpty")}</p>
          )}

          {highlightDraftOpen ? (
            <div className="user-center-highlight-form" role="group" aria-label={t("profile.appearance.highlightRuleForm")}>
              <div className="user-center-highlight-primary-fields">
                <FormField label={t("profile.appearance.ruleName")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      onChange={(event) => handleHighlightDraftChange("name", event.target.value)}
                      value={highlightDraft.name}
                    />
                  )}
                </FormField>
                <FormField label={t("profile.appearance.matchType")}>
                  {(id) => (
                    <SelectInput
                      aria-label={t("profile.appearance.matchType")}
                      id={id}
                      onChange={(event) => handleHighlightDraftChange("matchType", event.target.value as TerminalHighlightMatchType)}
                      value={highlightDraft.matchType}
                    >
                      <option value="keyword">keyword</option>
                      <option value="regex">regex</option>
                    </SelectInput>
                  )}
                </FormField>
                <FormField label={t("profile.appearance.pattern")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      onChange={(event) => handleHighlightDraftChange("pattern", event.target.value)}
                      value={highlightDraft.pattern}
                    />
                  )}
                </FormField>
                <FormField label={t("profile.appearance.priority")}>
                  {(id) => (
                    <TextInput
                      aria-label={t("profile.appearance.priority")}
                      id={id}
                      onChange={(event) => handleHighlightDraftChange("priority", Number(event.target.value))}
                      type="number"
                      value={highlightDraft.priority}
                    />
                  )}
                </FormField>
              </div>
              <p className="user-center-highlight-pattern-help">{t("profile.appearance.patternHint")}</p>
              <div className="user-center-highlight-secondary-fields">
                <label className="user-center-inline-toggle">
                  <input
                    checked={highlightDraft.enabled}
                    onChange={(event) => handleHighlightDraftChange("enabled", event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("profile.appearance.ruleEnabled")}</span>
                </label>
                <label className="user-center-inline-toggle">
                  <input
                    checked={highlightDraft.caseSensitive}
                    onChange={(event) => handleHighlightDraftChange("caseSensitive", event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("profile.appearance.caseSensitive")}</span>
                </label>
                <HighlightColorControl
                  ariaLabel={t("profile.appearance.foregroundColor")}
                  color={highlightDraft.foregroundColor}
                  label={t("profile.appearance.foregroundColor")}
                  onChange={(color) => handleHighlightDraftChange("foregroundColor", color)}
                />
                <HighlightColorControl
                  allowTransparent
                  ariaLabel={t("profile.appearance.backgroundColor")}
                  color={highlightDraft.backgroundColor}
                  label={t("profile.appearance.backgroundColor")}
                  onChange={(color) => handleHighlightDraftChange("backgroundColor", color)}
                  transparentLabel={`${t("profile.appearance.backgroundColor")}${t("profile.appearance.setTransparentSuffix")}`}
                  transparentText={t("profile.appearance.transparentColor")}
                />
              </div>
              <div className="user-center-card-actions user-center-highlight-form-actions">
                <Button
                  onClick={() => {
                    setHighlightDraftOpen(false);
                    setEditingHighlightRuleId(null);
                    setHighlightDraft({ ...emptyHighlightDraft });
                  }}
                  type="button"
                  variant="secondary"
                >
                  {t("common.cancel")}
                </Button>
                <Button onClick={handleSaveHighlightRule} type="button" variant="primary">
                  {t("profile.appearance.saveHighlightRule")}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Dialog>
  );

  const renderAppearance = () => (
    <section className="user-center-section">
      <article className="user-center-card">
        <div className="user-center-card-heading">
          <span className="user-center-card-icon"><Palette aria-hidden="true" /></span>
          <div>
            <h2>{t("profile.appearance.title")}</h2>
            <p>{t("profile.appearance.copy")}</p>
          </div>
        </div>
        <div className="user-center-preference-grid">
          <div className="user-center-preference-item">
            <span>{t("preferences.language")}</span>
            <SegmentedControl
              ariaLabel={t("preferences.language")}
              items={[
                { label: t("preferences.language.zh"), value: "zh-CN" },
                { label: t("preferences.language.en"), value: "en-US" }
              ]}
              onChange={(value) => setLanguage(value as AppLanguage)}
              value={language}
            />
          </div>
          <div className="user-center-preference-item">
            <span>{t("preferences.theme")}</span>
            <SegmentedControl
              ariaLabel={t("preferences.theme")}
              items={[
                { label: t("preferences.theme.system"), value: "system" },
                { label: t("preferences.theme.dark"), value: "dark" },
                { label: t("preferences.theme.light"), value: "light" }
              ]}
              onChange={(value) => setTheme(value as AppTheme)}
              value={theme}
            />
          </div>
          <FormField label={t("preferences.terminalFontSize")}>
            {(id) => (
              <div className="user-center-number-control">
                <TextInput
                  id={id}
                  inputMode="numeric"
                  max={22}
                  min={10}
                  onChange={handleFontSizeChange}
                  type="number"
                  value={fontSizeInput}
                />
                <span>{t("preferences.terminalFontSizeUnit")}</span>
              </div>
            )}
          </FormField>
          <FormField label={t("preferences.terminalTheme")}>
            {(id) => (
              <SelectInput
                aria-label={t("preferences.terminalTheme")}
                id={id}
                onChange={(event) => setTerminalTheme(event.target.value as TerminalThemePreference)}
                value={terminalTheme}
              >
                {terminalThemeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <div className="user-center-preference-item user-center-highlight-preference">
            <span>{t("profile.appearance.highlightTitle")}</span>
            <div className="user-center-highlight-compact-row">
              <label className="user-center-inline-toggle">
                <input
                  aria-label={t("profile.appearance.highlightEnabled")}
                  checked={terminalHighlightPreferences.enabled}
                  onChange={(event) => handleHighlightEnabledChange(event.target.checked)}
                  type="checkbox"
                />
                <span>{t("profile.appearance.highlightEnabled")}</span>
              </label>
              <IconButton label={t("profile.appearance.configureHighlightRules")} onClick={() => setHighlightRulesDialogOpen(true)} variant="neutral">
                <Pencil aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          <div className="user-center-terminal-preview-panel">
            <div className="user-center-terminal-preview-heading">{t("profile.appearance.sampleTerminalTitle")}</div>
            <div
              aria-label={t("profile.appearance.previewLabel")}
              className="user-center-terminal-preview"
              role="region"
              style={{
                backgroundColor: previewTheme.background,
                color: previewTheme.foreground,
                fontFamily: terminalFontFamily,
                fontSize: `${terminalFontSize}px`
              }}
            >
              {previewLines.map((line, index) => (
                <div
                  className="user-center-terminal-preview-line"
                  key={line}
                  style={index === 0 ? { color: previewTheme.green } : { color: previewTheme.cyan }}
                >
                  {renderPreviewLine(line, previewHighlightRules)}
                </div>
              ))}
            </div>
            <p className="user-center-terminal-view-note">
              {t("profile.appearance.terminalViewCopy")}
            </p>
          </div>
        </div>
      </article>
      {renderHighlightRulesDialog()}
    </section>
  );

  const renderMfaRecoveryCodesPanel = () => (
    <div className="user-center-mfa-recovery-panel">
      <p>{t("profile.mfa.recoveryCopy")}</p>
      <div className="user-center-mfa-recovery-list">
        {mfaRecoveryCodes.map((code) => <code key={code}>{code}</code>)}
      </div>
      <div className="user-center-card-actions">
        <Button
          leadingIcon={mfaCopiedTarget === "recovery" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          onClick={() => void handleCopyMfaValue("recovery", mfaRecoveryCodes.join("\n"))}
          type="button"
          variant="secondary"
        >
          {t("profile.mfa.copyRecoveryCodes")}
        </Button>
        <Button onClick={handleRecoveryCodesSaved} type="button" variant="primary">
          {t("profile.mfa.recoverySaved")}
        </Button>
      </div>
    </div>
  );

  const renderMfaSetupDialog = () => (
    <Dialog
      closeLabel={t("common.close")}
      description={t("profile.mfa.setupDialogCopy")}
      onOpenChange={handleMfaSetupDialogOpenChange}
      open={mfaSetupDialogOpen}
      size="lg"
      title={t("profile.mfa.setupDialogTitle")}
    >
      <div className="user-center-mfa-dialog">
        <StepProgress
          activeIndex={mfaSetupStepIndex}
          ariaLabel={t("profile.mfa.setupProgress")}
          items={mfaSetupSteps}
        />

        {mfaSetupStep === "password" ? (
          <form className="user-center-mfa-step-panel" onSubmit={handleStartMfaSetup}>
            <SecretInput
              autoComplete="current-password"
              hideLabel={t("auth.hidePassword")}
              label={t("profile.security.currentPassword")}
              showLabel={t("auth.showPassword")}
              onChange={setMfaSetupPassword}
              value={mfaSetupPassword}
            />
            <div className="user-center-card-actions">
              <Button disabled={busyAction === "mfa-setup" || !mfaSetupPassword.trim()} type="submit" variant="primary">
                {busyAction === "mfa-setup" ? t("common.loading") : t("common.continue")}
              </Button>
            </div>
          </form>
        ) : null}

        {mfaSetupStep === "scan" && mfaSetup ? (
          <div className="user-center-mfa-step-panel">
            <div className="user-center-mfa-setup-layout">
              <img alt={t("profile.mfa.qrAlt")} className="user-center-mfa-qr" src={mfaSetup.qr_code} />
              <div className="user-center-mfa-secret-panel">
                <span>{t("profile.mfa.manualSecret")}</span>
                <div className="user-center-mfa-copy-row">
                  <code>{mfaSetup.manual_secret}</code>
                  <IconButton
                    label={t("profile.mfa.copySecret")}
                    onClick={() => void handleCopyMfaValue("secret", mfaSetup.manual_secret)}
                    variant="neutral"
                  >
                    {mfaCopiedTarget === "secret" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </IconButton>
                </div>
              </div>
            </div>
            <div className="user-center-card-actions">
              <Button onClick={() => setMfaSetupStep("code")} type="button" variant="primary">
                {t("common.next")}
              </Button>
            </div>
          </div>
        ) : null}

        {mfaSetupStep === "code" ? (
          <div className="user-center-mfa-step-panel">
            <AuthCodeField label={t("auth.verificationCode")}>
              {(id) => (
                <AuthCodeInput
                  id={id}
                  label={t("auth.verificationCode")}
                  length={6}
                  onChange={setMfaSetupCode}
                  translations={{
                    digit: t("auth.verificationCodeDigit"),
                    digitOf: t("auth.verificationCodeDigitOf")
                  }}
                  value={mfaSetupCode}
                />
              )}
            </AuthCodeField>
            <div className="user-center-card-actions">
              <Button onClick={() => setMfaSetupStep("scan")} type="button" variant="secondary">
                {t("common.back")}
              </Button>
              <Button
                disabled={busyAction === "mfa-confirm" || mfaSetupCode.length !== 6}
                onClick={handleConfirmMfaSetup}
                type="button"
                variant="primary"
              >
                {t("profile.mfa.confirmEnable")}
              </Button>
            </div>
          </div>
        ) : null}

        {mfaSetupStep === "recovery" ? (
          <div className="user-center-mfa-step-panel">
            {renderMfaRecoveryCodesPanel()}
          </div>
        ) : null}
      </div>
    </Dialog>
  );

  const renderMfaRecoveryCodesDialog = () => (
    <Dialog
      closeLabel={t("common.close")}
      description={t("profile.mfa.recoveryCopy")}
      onOpenChange={(open) => {
        if (!open) {
          return;
        }
        setMfaRecoveryDialogOpen(open);
      }}
      open={mfaRecoveryDialogOpen}
      size="lg"
      title={t("profile.mfa.recoveryTitle")}
    >
      <div className="user-center-mfa-step-panel">
        {renderMfaRecoveryCodesPanel()}
      </div>
    </Dialog>
  );

  const renderMfaManagementDialog = () => {
    const isRegenerate = mfaManagementAction === "regenerate";
    return (
      <Dialog
        closeLabel={t("common.close")}
        description={isRegenerate ? t("profile.mfa.regenerateDialogCopy") : t("profile.mfa.disableDialogCopy")}
        onOpenChange={(open) => {
          if (!open) {
            resetMfaManagementDialog();
          }
        }}
        open={mfaManagementAction !== null}
        size="md"
        title={isRegenerate ? t("profile.mfa.regenerateRecoveryCodes") : t("profile.mfa.disable")}
      >
        <form
          className="user-center-mfa-action-dialog"
          onSubmit={isRegenerate ? handleRegenerateMfaRecoveryCodes : handleDisableMfa}
        >
          <SecretInput
            autoComplete="current-password"
            hideLabel={t("auth.hidePassword")}
            label={t("profile.security.currentPassword")}
            showLabel={t("auth.showPassword")}
            onChange={(value) => setMfaVerificationForm((current) => ({ ...current, password: value }))}
            value={mfaVerificationForm.password}
          />
          <SegmentedControl
            ariaLabel={t("profile.mfa.verificationMethod")}
            items={mfaVerificationMethodItems}
            onChange={(value) => {
              setMfaVerificationMethod(value);
              setMfaVerificationForm((current) => ({ ...current, code: "", recoveryCode: "" }));
            }}
            size="sm"
            value={mfaVerificationMethod}
          />
          {mfaVerificationMethod === "recovery_code" ? (
            <FormField label={t("auth.recoveryCode")}>
              {(id) => (
                <TextInput
                  id={id}
                  onChange={(event) =>
                    setMfaVerificationForm((current) => ({
                      ...current,
                      recoveryCode: normalizeRecoveryCode(event.target.value)
                    }))
                  }
                  value={mfaVerificationForm.recoveryCode}
                />
              )}
            </FormField>
          ) : (
            <AuthCodeField label={t("auth.verificationCode")}>
              {(id) => (
                <AuthCodeInput
                  id={id}
                  label={t("auth.verificationCode")}
                  length={6}
                  onChange={(value) => setMfaVerificationForm((current) => ({ ...current, code: value }))}
                  translations={{
                    digit: t("auth.verificationCodeDigit"),
                    digitOf: t("auth.verificationCodeDigitOf")
                  }}
                  value={mfaVerificationForm.code}
                />
              )}
            </AuthCodeField>
          )}
          <div className="user-center-card-actions">
            <Button onClick={resetMfaManagementDialog} type="button" variant="secondary">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                mfaManagementSubmitDisabled ||
                busyAction === "mfa-regenerate" ||
                busyAction === "mfa-disable"
              }
              type="submit"
              variant={isRegenerate ? "primary" : "danger"}
            >
              {isRegenerate ? t("profile.mfa.regenerateRecoveryCodes") : t("profile.mfa.disable")}
            </Button>
          </div>
        </form>
      </Dialog>
    );
  };

  const renderMfaCard = () => (
    <article aria-label={t("profile.mfa.title")} className="user-center-card user-center-mfa-card" role="region">
      <div className="user-center-mfa-card-top">
        <div className="user-center-card-heading">
          <span className="user-center-card-icon"><Shield aria-hidden="true" /></span>
          <div>
            <div className="user-center-mfa-title-row">
              <h2>{t("profile.mfa.title")}</h2>
              <Badge tone={mfaStatus?.enabled ? "success" : "neutral"}>
                {mfaStatus?.enabled ? t("profile.mfa.enabledStatus") : t("profile.mfa.disabledStatus")}
              </Badge>
            </div>
            <p>{t("profile.mfa.copy")}</p>
          </div>
        </div>
        {!mfaStatus?.enabled ? (
          <Button disabled={busyAction === "mfa-setup"} onClick={handleOpenMfaSetup} type="button" variant="primary">
            {t("profile.mfa.enable")}
          </Button>
        ) : null}
      </div>

      {mfaStatus?.enabled ? (
        <div className="user-center-mfa-enabled-layout">
          <dl className="user-center-mfa-summary">
            <div>
              <dt>{t("profile.mfa.lastUsedLabel")}</dt>
              <dd>{formatMfaLastUsed(mfaStatus.last_used_at, language, t)}</dd>
            </div>
            <div>
              <dt>{t("profile.mfa.recoveryCodeCount")}</dt>
              <dd>{t("profile.mfa.recoveryCodeCountValue", { count: mfaStatus.recovery_code_count })}</dd>
            </div>
          </dl>
          <div className="user-center-mfa-management">
            <div className="user-center-card-actions user-center-mfa-enabled-actions">
              <Button disabled={busyAction === "mfa-regenerate"} onClick={() => openMfaManagementDialog("regenerate")} type="button" variant="secondary">
                {t("profile.mfa.regenerateRecoveryCodes")}
              </Button>
              <Button disabled={busyAction === "mfa-disable"} onClick={() => openMfaManagementDialog("disable")} type="button" variant="danger">
                {t("profile.mfa.disable")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {renderMfaSetupDialog()}
      {renderMfaRecoveryCodesDialog()}
      {renderMfaManagementDialog()}
    </article>
  );

  const renderSecurity = () => (
    <section className="user-center-section">
      {renderMfaCard()}
      <form aria-label={t("profile.security.passwordTitle")} className="user-center-card" onSubmit={handlePasswordSubmit} role="region">
        <div className="user-center-card-heading">
          <span className="user-center-card-icon"><KeyRound aria-hidden="true" /></span>
          <div>
            <h2>{t("profile.security.passwordTitle")}</h2>
            <p>{t("profile.security.passwordCopy")}</p>
          </div>
        </div>
        <StepProgress
          activeIndex={passwordStep}
          ariaLabel={t("profile.security.passwordTitle")}
          items={[
            { title: t("profile.security.passwordStepCurrentTitle"), description: t("profile.security.passwordStepCurrentDescription") },
            { title: t("profile.security.passwordStepNewTitle"), description: t("profile.security.passwordStepNewDescription") }
          ]}
        />
        {passwordStep === 0 ? (
          <div className="user-center-security-grid">
            <SecretInput
              autoComplete="current-password"
              hideLabel={t("auth.hidePassword")}
              label={t("profile.security.currentPassword")}
              showLabel={t("auth.showPassword")}
              onChange={(value) => setPasswordForm((current) => ({ ...current, currentPassword: value }))}
              value={passwordForm.currentPassword}
            />
          </div>
        ) : (
          <div className="user-center-security-grid">
            <SecretInput
              autoComplete="new-password"
              hideLabel={t("auth.hidePassword")}
              label={t("profile.security.newPassword")}
              showLabel={t("auth.showPassword")}
              onChange={(value) => setPasswordForm((current) => ({ ...current, newPassword: value }))}
              value={passwordForm.newPassword}
            />
            <SecretInput
              autoComplete="new-password"
              hideLabel={t("auth.hidePassword")}
              label={t("profile.security.confirmPassword")}
              showLabel={t("auth.showPassword")}
              onChange={(value) => setPasswordForm((current) => ({ ...current, confirmPassword: value }))}
              value={passwordForm.confirmPassword}
            />
          </div>
        )}
        <div className="user-center-card-actions">
          {passwordStep === 0 ? (
            <Button onClick={() => setPasswordStep(1)} type="button" variant="primary">
              {t("common.nextStep")}
            </Button>
          ) : (
            <>
              <Button onClick={() => setPasswordStep(0)} type="button" variant="secondary">
                {t("common.cancel")}
              </Button>
              <Button disabled={busyAction === "password"} type="submit" variant="primary">
                {busyAction === "password" ? t("common.saving") : t("profile.security.savePassword")}
              </Button>
            </>
          )}
        </div>
      </form>

      <form aria-label={t("profile.security.emailTitle")} className="user-center-card" onSubmit={handleEmailSubmit} role="region">
        <div className="user-center-card-heading">
          <span className="user-center-card-icon"><Mail aria-hidden="true" /></span>
          <div>
            <h2>{t("profile.security.emailTitle")}</h2>
            <p>{t("profile.security.emailCopy")}</p>
          </div>
        </div>
        <StepProgress
          activeIndex={emailStep}
          ariaLabel={t("profile.security.emailTitle")}
          items={[
            { title: t("profile.security.emailStepCurrentTitle"), description: t("profile.security.emailStepCurrentDescription") },
            { title: t("profile.security.emailStepNewTitle"), description: t("profile.security.emailStepNewDescription") }
          ]}
        />
        <div className="user-center-email-flow">
          {emailStep === 0 ? (
            <div className="user-center-code-row">
              <FormField label={t("profile.security.oldEmailCode")}>
                {(id) => (
                  <TextInput
                    autoComplete="one-time-code"
                    id={id}
                    inputMode="numeric"
                    onChange={(event) => setEmailForm((current) => ({ ...current, currentEmailCode: event.target.value }))}
                    value={emailForm.currentEmailCode}
                  />
                )}
              </FormField>
              <Button disabled={busyAction === "current-email-code"} onClick={handleSendCurrentEmailCode} variant="secondary">
                {t("profile.security.sendOldCode")}
              </Button>
            </div>
          ) : (
            <>
              <div className="user-center-code-row user-center-code-row-wide">
                <FormField label={t("profile.security.newEmail")}>
                  {(id) => (
                    <TextInput
                      autoComplete="email"
                      id={id}
                      onChange={(event) => setEmailForm((current) => ({ ...current, newEmail: event.target.value }))}
                      type="email"
                      value={emailForm.newEmail}
                    />
                  )}
                </FormField>
                <Button disabled={busyAction === "new-email-code"} onClick={handleSendNewEmailCode} variant="secondary">
                  {t("profile.security.sendNewCode")}
                </Button>
              </div>
              <FormField label={t("profile.security.newEmailCode")}>
                {(id) => (
                  <TextInput
                    autoComplete="one-time-code"
                    id={id}
                    inputMode="numeric"
                    onChange={(event) => setEmailForm((current) => ({ ...current, newEmailCode: event.target.value }))}
                    value={emailForm.newEmailCode}
                  />
                )}
              </FormField>
            </>
          )}
        </div>
        <div className="user-center-card-actions">
          {emailStep === 0 ? (
            <Button onClick={() => setEmailStep(1)} type="button" variant="primary">
              {t("common.nextStep")}
            </Button>
          ) : (
            <>
              <Button onClick={() => setEmailStep(0)} type="button" variant="secondary">
                {t("common.cancel")}
              </Button>
              <Button disabled={busyAction === "email"} type="submit" variant="primary">
                {busyAction === "email" ? t("common.saving") : t("profile.security.changeEmail")}
              </Button>
            </>
          )}
        </div>
      </form>
    </section>
  );

  return (
    <div className="route-page user-center-page">
      <div className="admin-page-header user-center-header">
        <div>
          <p className="eyebrow route-eyebrow">{t("profile.eyebrow")}</p>
          <h1>{t("profile.title")}</h1>
          <p className="route-copy">{t("profile.copy")}</p>
        </div>
        {user?.role ? <Badge tone={user.role === "admin" ? "info" : "neutral"}>{user.role}</Badge> : null}
      </div>

      <SegmentedControl
        ariaLabel={t("profile.tabs.aria")}
        items={tabItems}
        onChange={(value) => setTab(value as UserCenterTabKey)}
        value={tab}
      />

      {tab === "account" ? renderAccount() : null}
      {tab === "appearance" ? renderAppearance() : null}
      {tab === "security" ? renderSecurity() : null}
    </div>
  );
}
