import { useEffect, useState, type TextareaHTMLAttributes, type InputHTMLAttributes } from "react";

import { usePreferences } from "../../features/preferences/PreferencesContext";
import { PasswordInput } from "./PasswordInput";

const revealDurationMs = 20_000;

type SensitiveInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
};

type SensitiveTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
};

function useTimedReveal() {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) {
      return;
    }

    const timer = window.setTimeout(() => setRevealed(false), revealDurationMs);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  return {
    revealed,
    toggleReveal: () => setRevealed((current) => !current)
  };
}

export function SensitiveInput({ className, label: _label, ...props }: SensitiveInputProps) {
  const { t } = usePreferences();

  return (
    <PasswordInput
      {...props}
      className={className === "ui-input" ? undefined : className}
      hideLabel={t("auth.hidePassword")}
      showLabel={t("auth.showPassword")}
    />
  );
}

export function SensitiveTextarea({ className, label, ...props }: SensitiveTextareaProps) {
  const { revealed, toggleReveal } = useTimedReveal();
  const { t } = usePreferences();

  return (
    <div className="sensitive-textarea-shell">
      <textarea
        {...props}
        className={`${className || ""} ${revealed ? "" : "sensitive-textarea-hidden"}`.trim()}
      />
      <div className="sensitive-textarea-actions">
        <button className="sensitive-toggle" onClick={toggleReveal} type="button">
          {revealed ? t("common.hide") : label || t("common.show")}
        </button>
        {!revealed ? <span className="nav-hint">{t("common.sensitiveHint")}</span> : null}
      </div>
    </div>
  );
}
