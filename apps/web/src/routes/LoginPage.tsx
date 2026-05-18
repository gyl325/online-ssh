import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../features/auth/AuthContext";
import { getApiErrorMessage, getAuthConfig, sendEmailVerificationCode } from "../features/auth/api";
import type { MfaRequiredLoginResponse } from "../features/auth/types";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useToast } from "../features/ui/ToastContext";
import { AuthCodeField, Button, FormField, PasswordInput, SegmentedControl, TextInput } from "../shared/ui";

type AuthMode = "login" | "register";
type LoginMethod = "password" | "email_code";

const defaultLoginForm = {
  identifier: "",
  password: "",
  verification_code: ""
};

const defaultRegisterForm = {
  display_name: "",
  email: "",
  password: "",
  password_confirm: "",
  verification_code: ""
};

export function LoginPage() {
  const auth = useAuth();
  const { t } = usePreferences();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [loginForm, setLoginForm] = useState(defaultLoginForm);
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState<AuthMode | null>(null);
  const [sendCooldowns, setSendCooldowns] = useState<Record<AuthMode, number>>({ login: 0, register: 0 });
  const [error, setError] = useState<string | null>(null);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [emailCodeLength, setEmailCodeLength] = useState(6);
  const [mfaChallenge, setMfaChallenge] = useState<MfaRequiredLoginResponse | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecoveryCode, setMfaRecoveryCode] = useState("");
  const [mfaMode, setMfaMode] = useState<"totp" | "recovery_code">("totp");

  const nextPath = (location.state as { from?: string } | null)?.from || "/dashboard";

  useEffect(() => {
    let disposed = false;

    const loadAuthConfig = async () => {
      try {
        const config = await getAuthConfig();
        if (disposed) {
          return;
        }
        setAllowRegistration(config.allow_registration);
        if (typeof config.email_code_length === "number" && config.email_code_length > 0) {
          setEmailCodeLength(config.email_code_length);
        }
        if (!config.allow_registration) {
          setMode("login");
          setRegisterForm(defaultRegisterForm);
        }
      } catch {
        if (!disposed) {
          setAllowRegistration(true);
        }
      }
    };

    void loadAuthConfig();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (sendCooldowns.login <= 0 && sendCooldowns.register <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setSendCooldowns((current) => ({
        login: Math.max(0, current.login - 1),
        register: Math.max(0, current.register - 1)
      }));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [sendCooldowns.login, sendCooldowns.register]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = loginMethod === "email_code"
        ? await auth.signInWithEmailCode({
          identifier: loginForm.identifier,
          verification_code: loginForm.verification_code
        })
        : await auth.signIn({
          identifier: loginForm.identifier,
          password: loginForm.password
        });
      if ("status" in response && response.status === "mfa_required") {
        setMfaChallenge(response);
        setMfaMode("totp");
        setMfaCode("");
        setMfaRecoveryCode("");
        return;
      }
      navigate(nextPath, { replace: true });
    } catch (submitError) {
      const message = getApiErrorMessage(submitError, t("auth.loginFailed"), t);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mfaChallenge) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await auth.verifyMfa(
        mfaMode === "recovery_code"
          ? {
            mfa_token: mfaChallenge.mfa_token,
            recovery_code: normalizeRecoveryCode(mfaRecoveryCode)
          }
          : {
            mfa_token: mfaChallenge.mfa_token,
            code: mfaCode
          }
      );
      navigate(nextPath, { replace: true });
    } catch (submitError) {
      const message = getApiErrorMessage(submitError, t("auth.mfaVerifyFailed"), t);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (registerForm.password !== registerForm.password_confirm) {
      const message = t("auth.passwordMismatch");
      setError(message);
      toast.error(message);
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      await auth.signUp(registerForm);
      navigate("/dashboard", { replace: true });
    } catch (submitError) {
      const message = getApiErrorMessage(submitError, t("auth.registerFailed"), t);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCode = async (purpose: AuthMode) => {
    setSendingCode(purpose);
    setError(null);
    try {
      await sendEmailVerificationCode(
        purpose === "register"
          ? { email: registerForm.email, purpose }
          : { identifier: loginForm.identifier, purpose }
      );
      setSendCooldowns((current) => ({ ...current, [purpose]: 60 }));
      toast.success(t("auth.verificationCodeSent"));
    } catch (sendError) {
      const message = getApiErrorMessage(sendError, t("auth.verificationCodeSendFailed"), t);
      setError(message);
      toast.error(message);
    } finally {
      setSendingCode(null);
    }
  };

  const authModeItems: Array<{ label: string; value: AuthMode }> = [{ label: t("auth.login"), value: "login" }];
  if (allowRegistration) {
    authModeItems.push({ label: t("auth.register"), value: "register" });
  }
  const loginMethodItems: Array<{ label: string; value: LoginMethod }> = [
    { label: t("auth.passwordLogin"), value: "password" },
    { label: t("auth.emailCodeLogin"), value: "email_code" }
  ];
  const getSendCodeLabel = (purpose: AuthMode) => {
    if (sendingCode === purpose) {
      return t("auth.sendingCode");
    }
    const cooldown = sendCooldowns[purpose];
    return cooldown > 0 ? t("auth.resendInSeconds", { seconds: cooldown }) : t("auth.sendCode");
  };

  return (
    <div className="login-screen">
      <section className="login-card">
        <p className="eyebrow">Auth Entry</p>
        <h1>{mfaChallenge ? t("auth.mfaTitle") : "Online SSH Console"}</h1>

        {mfaChallenge ? (
          <form className="auth-form" onSubmit={handleVerifyMfa}>
            <p className="login-muted-copy">{t("auth.mfaCopy")}</p>
            {mfaMode === "recovery_code" ? (
              <FormField label={t("auth.recoveryCode")}>
                {(id) => (
                  <TextInput
                    autoComplete="one-time-code"
                    id={id}
                    onChange={(event) => setMfaRecoveryCode(normalizeRecoveryCode(event.target.value))}
                    value={mfaRecoveryCode}
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
                    onChange={setMfaCode}
                    translations={{
                      digit: t("auth.verificationCodeDigit"),
                      digitOf: t("auth.verificationCodeDigitOf")
                    }}
                    value={mfaCode}
                  />
                )}
              </AuthCodeField>
            )}
            <div className="login-actions">
              <Button
                className="auth-submit-button"
                disabled={
                  submitting ||
                  (mfaMode === "recovery_code" ? !mfaRecoveryCode.trim() : mfaCode.length !== 6)
                }
                type="submit"
                variant="primary"
              >
                {submitting ? t("auth.mfaVerifying") : t("auth.mfaVerifySubmit")}
              </Button>
              {mfaChallenge.methods.includes("recovery_code") ? (
                <Button
                  onClick={() => {
                    setMfaMode((current) => current === "recovery_code" ? "totp" : "recovery_code");
                    setError(null);
                  }}
                  type="button"
                  variant="secondary"
                >
                  {mfaMode === "recovery_code" ? t("auth.useAuthenticatorCode") : t("auth.useRecoveryCode")}
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  setMfaChallenge(null);
                  setMfaCode("");
                  setMfaRecoveryCode("");
                  setError(null);
                }}
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <>

        <SegmentedControl
          ariaLabel="Auth mode"
          items={authModeItems}
          onChange={(nextMode) => {
            setMode(nextMode);
            setError(null);
            if (nextMode === "login") {
              setRegisterForm(defaultRegisterForm);
            } else {
              setLoginForm(defaultLoginForm);
              setLoginMethod("password");
            }
          }}
          size="md"
          value={mode}
        />

        {!allowRegistration ? <p className="login-muted-copy">{t("auth.registrationDisabled")}</p> : null}

        {mode === "login" || !allowRegistration ? (
          <form className="auth-form" onSubmit={handleLogin}>
            <SegmentedControl
              ariaLabel={t("auth.loginMethod")}
              items={loginMethodItems}
              onChange={(nextMethod) => {
                setLoginMethod(nextMethod);
                setError(null);
                setLoginForm((current) => ({
                  ...current,
                  password: "",
                  verification_code: ""
                }));
              }}
              size="sm"
              value={loginMethod}
            />
            <FormField label={loginMethod === "email_code" ? t("auth.email") : t("auth.loginIdentifier")}>
              {(id) => (
                <TextInput
                  autoComplete={loginMethod === "email_code" ? "email" : "username"}
                  id={id}
                  name="identifier"
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, identifier: event.target.value }))
                  }
                  required
                  type={loginMethod === "email_code" ? "email" : "text"}
                  value={loginForm.identifier}
                />
              )}
            </FormField>

            {loginMethod === "password" ? (
              <FormField label={t("auth.password")}>
                {(id) => (
                  <PasswordInput
                    autoComplete="current-password"
                    hideLabel={t("auth.hidePassword")}
                    id={id}
                    label={t("auth.password")}
                    name="password"
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, password: event.target.value }))
                    }
                    required
                    showLabel={t("auth.showPassword")}
                    value={loginForm.password}
                  />
                )}
              </FormField>
            ) : (
              <AuthCodeField className="auth-code-field-with-send" label={t("auth.verificationCode")}>
                {(id) => (
                  <div className="auth-verification-row">
                    <AuthCodeInput
                      id={id}
                      label={t("auth.verificationCode")}
                      length={emailCodeLength}
                      onChange={(value) => setLoginForm((current) => ({ ...current, verification_code: value }))}
                      translations={{
                        digit: t("auth.verificationCodeDigit"),
                        digitOf: t("auth.verificationCodeDigitOf")
                      }}
                      value={loginForm.verification_code}
                    />
                    <Button
                      className="auth-send-code-button"
                      disabled={
                        sendingCode === "login" ||
                        submitting ||
                        sendCooldowns.login > 0 ||
                        !isValidEmail(loginForm.identifier)
                      }
                      onClick={() => void handleSendCode("login")}
                      type="button"
                      variant="secondary"
                    >
                      {getSendCodeLabel("login")}
                    </Button>
                  </div>
                )}
              </AuthCodeField>
            )}

            <div className="login-actions">
              <Button className="auth-submit-button" disabled={submitting} type="submit" variant="primary">
                {submitting
                  ? t("auth.loginSubmitting")
                  : loginMethod === "email_code"
                    ? t("auth.loginWithCodeSubmit")
                    : t("auth.loginSubmit")}
              </Button>
            </div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <FormField label={t("auth.username")}>
              {(id) => (
                <TextInput
                  autoComplete="name"
                  id={id}
                  name="display_name"
                  // Backend still receives display_name; the product-facing label is Username.
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      display_name: event.target.value
                    }))
                  }
                  required
                  type="text"
                  value={registerForm.display_name}
                />
              )}
            </FormField>

            <FormField label={t("auth.password")}>
              {(id) => (
                <PasswordInput
                  autoComplete="new-password"
                  hideLabel={t("auth.hidePassword")}
                  id={id}
                  label={t("auth.password")}
                  minLength={8}
                  name="password"
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                  showLabel={t("auth.showPassword")}
                  value={registerForm.password}
                />
              )}
            </FormField>

            <FormField label={t("auth.confirmPassword")}>
              {(id) => (
                <PasswordInput
                  autoComplete="new-password"
                  hideLabel={t("auth.hidePassword")}
                  id={id}
                  label={t("auth.confirmPassword")}
                  minLength={8}
                  name="password_confirm"
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, password_confirm: event.target.value }))
                  }
                  required
                  showLabel={t("auth.showPassword")}
                  value={registerForm.password_confirm}
                />
              )}
            </FormField>

            <FormField label={t("auth.email")}>
              {(id) => (
                <TextInput
                  autoComplete="email"
                  id={id}
                  name="email"
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, email: event.target.value }))
                  }
                  required
                  type="email"
                  value={registerForm.email}
                />
              )}
            </FormField>

            <AuthCodeField className="auth-code-field-with-send" label={t("auth.verificationCode")}>
              {(id) => (
                <div className="auth-verification-row">
                  <AuthCodeInput
                    id={id}
                    label={t("auth.verificationCode")}
                    length={emailCodeLength}
                    onChange={(value) => setRegisterForm((current) => ({ ...current, verification_code: value }))}
                    translations={{
                      digit: t("auth.verificationCodeDigit"),
                      digitOf: t("auth.verificationCodeDigitOf")
                    }}
                    value={registerForm.verification_code}
                  />
                  <Button
                    className="auth-send-code-button"
                    disabled={
                      sendingCode === "register" ||
                      submitting ||
                      sendCooldowns.register > 0 ||
                      !isValidEmail(registerForm.email)
                    }
                    onClick={() => void handleSendCode("register")}
                    type="button"
                    variant="secondary"
                  >
                    {getSendCodeLabel("register")}
                  </Button>
                </div>
              )}
            </AuthCodeField>

            <div className="login-actions">
              <Button className="auth-submit-button" disabled={submitting} type="submit" variant="primary">
                {submitting ? t("auth.registerSubmitting") : t("auth.registerSubmit")}
              </Button>
            </div>
          </form>
        )}
          </>
        )}
      </section>
    </div>
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
  const digits = sanitizeCode(value).slice(0, normalizedLength).padEnd(normalizedLength, " ").split("");

  const setCode = (nextDigits: string[], focusIndex?: number) => {
    onChange(nextDigits.join("").replace(/\D/g, "").slice(0, normalizedLength));
    if (typeof focusIndex === "number") {
      window.requestAnimationFrame(() => inputRefs.current[focusIndex]?.focus());
    }
  };

  const handleChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const incoming = sanitizeCode(event.target.value);
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
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < normalizedLength - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
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
      <input name="verification_code" type="hidden" value={sanitizeCode(value).slice(0, normalizedLength)} />
    </div>
  );
}

function sanitizeCode(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeRecoveryCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (compact.length <= 4) {
    return compact;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
