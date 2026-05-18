import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

import { cx } from "./classNames";

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  hideLabel?: string;
  label?: string;
  showLabel?: string;
  wrapperClassName?: string;
};

export function PasswordInput({
  className,
  hideLabel,
  label,
  showLabel,
  wrapperClassName,
  ...props
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const currentShowLabel = showLabel || "Show password";
  const currentHideLabel = hideLabel || "Hide password";

  return (
    <div className={cx("auth-input-group auth-password-field", wrapperClassName)}>
      <input
        {...props}
        aria-label={props["aria-label"] || label}
        className={cx("auth-input-group-control", className)}
        type={revealed ? "text" : "password"}
      />
      <button
        aria-label={revealed ? currentHideLabel : currentShowLabel}
        className="auth-password-toggle"
        onClick={() => setRevealed((current) => !current)}
        type="button"
      >
        {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  );
}
