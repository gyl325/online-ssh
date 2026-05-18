import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { setupBootstrap } from "../features/bootstrap/api";
import type { BootstrapSetupInput } from "../features/bootstrap/types";
import { getApiErrorMessage } from "../features/auth/api";
import { usePreferences } from "../features/preferences/PreferencesContext";
import { useToast } from "../features/ui/ToastContext";
import { Button, FormField, PasswordInput, TextInput } from "../shared/ui";

const defaultForm: BootstrapSetupInput = {
  display_name: "",
  email: "",
  password: "",
  password_confirm: "",
  setup_token: ""
};

type SetupPageProps = {
  onSetupComplete: () => void;
  setupTokenRequired?: boolean;
};

export function SetupPage({ onSetupComplete, setupTokenRequired = false }: SetupPageProps) {
  const { t } = usePreferences();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.password !== form.password_confirm) {
      const message = t("auth.passwordMismatch");
      setError(message);
      toast.error(message);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await setupBootstrap(form);
      onSetupComplete();
      navigate("/dashboard", { replace: true });
    } catch (submitError) {
      const message = getApiErrorMessage(submitError, t("setup.createFailed"), t);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <section className="login-card">
        <p className="eyebrow">{t("setup.eyebrow")}</p>
        <h1>{t("setup.title")}</h1>
        <p className="login-muted-copy">{t("setup.copy")}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <FormField label={t("auth.username")}>
            {(id) => (
              <TextInput
                autoComplete="name"
                id={id}
                name="display_name"
                onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                required
                type="text"
                value={form.display_name}
              />
            )}
          </FormField>

          <FormField label={t("auth.email")}>
            {(id) => (
              <TextInput
                autoComplete="email"
                id={id}
                name="email"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
                type="email"
                value={form.email}
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
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                required
                showLabel={t("auth.showPassword")}
                value={form.password}
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
                onChange={(event) => setForm((current) => ({ ...current, password_confirm: event.target.value }))}
                required
                showLabel={t("auth.showPassword")}
                value={form.password_confirm}
              />
            )}
          </FormField>

          {setupTokenRequired ? (
            <FormField label={t("setup.token")}>
              {(id) => (
                <PasswordInput
                  autoComplete="one-time-code"
                  hideLabel={t("auth.hidePassword")}
                  id={id}
                  label={t("setup.token")}
                  name="setup_token"
                  onChange={(event) => setForm((current) => ({ ...current, setup_token: event.target.value }))}
                  required
                  showLabel={t("auth.showPassword")}
                  value={form.setup_token ?? ""}
                />
              )}
            </FormField>
          ) : null}

          {error ? <p className="ui-field-error" role="alert">{error}</p> : null}

          <div className="login-actions">
            <Button className="auth-submit-button" disabled={submitting} type="submit" variant="primary">
              {submitting ? t("setup.creating") : t("setup.createAdmin")}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
